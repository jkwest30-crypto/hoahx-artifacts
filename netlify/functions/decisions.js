// Shared, server-side store for the HOAhx Decision Register.
// Backed by Netlify Blobs (site-wide store "hoahx-decisions"); no external database.
//
//   GET  /api/decisions          -> { "<id>": { v, n, code, updatedAt }, ... }   (live marks and notes only)
//   GET  /api/decisions?full=1   -> every record, including cleared ones and each record's history
//   POST /api/decisions          { id, v, n, code?, key? } -> saves that one decision and returns it
//
// Storage model (one blob per decision, under "items/<id>"):
//   { v: "keep"|"change"|"discuss"|"", n: "note text", code: "Q-FIN-8", updatedAt: ISO,
//     history: [ { v, n, at }, ... ] }   // the states this record held before, oldest first
//
// Why one blob per decision: two owners saving different items at the same moment can
// never overwrite each other (the earlier single-blob design read and rewrote the whole
// register on every save). Why history and no deletes: clearing a mark or emptying a note
// leaves a record with an empty v/n and the previous states in `history`, so nothing an
// owner wrote is ever gone; the page only shows live records.
//
// The legacy single blob ("register", written by the first version of this function) is
// read and merged beneath the per-item records but never rewritten.
//
// If DECISION_EDIT_KEY is set on the Netlify site, every request (read and write) must carry
// it: the `x-edit-key` header, or `key` in a POST body (for keep-alive saves that cannot set
// headers). Leave it unset and anyone with the URL can read and save.

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-decisions';
const PREFIX = 'items/';
const LEGACY_KEY = 'register';
const HISTORY_MAX = 40;
const NOTE_MAX = 20000;
const ID_RE = /^[A-Za-z][A-Za-z0-9-]{1,31}$/;
const MARKS = ['', 'keep', 'change', 'discuss'];

function json(body, status) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function openStore() {
  // Zero-config auto-injection (siteID/token from the Netlify runtime) is supposed to work
  // inside a function handler, but is known to fail on some sites. Fall back to explicit
  // config using the auto-provided SITE_ID plus a personal access token set as
  // NETLIFY_BLOBS_TOKEN when that happens.
  if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(STORE_NAME);
}

function headerKey(event) {
  const h = event.headers || {};
  return h['x-edit-key'] || h['X-Edit-Key'] || '';
}

function isLive(rec) {
  return !!(rec && (rec.v || (rec.n && String(rec.n).trim())));
}

function publicView(rec) {
  const out = {};
  if (rec.v) out.v = rec.v;
  if (rec.n) out.n = rec.n;
  if (rec.code) out.code = rec.code;
  if (rec.updatedAt) out.updatedAt = rec.updatedAt;
  return out;
}

async function readAll(store) {
  const all = {};
  const legacy = (await store.get(LEGACY_KEY, { type: 'json' })) || {};
  for (const [id, rec] of Object.entries(legacy)) {
    if (rec && typeof rec === 'object') all[id] = Object.assign({ legacy: true }, rec);
  }
  const listed = await store.list({ prefix: PREFIX });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  blobs.forEach((b, i) => {
    if (recs[i] && typeof recs[i] === 'object') all[b.key.slice(PREFIX.length)] = recs[i];
  });
  return all;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({}, 200);

  try {
    let payload = null;
    if (event.httpMethod === 'POST') {
      try {
        payload = JSON.parse(event.body || '{}');
      } catch (e) {
        return json({ error: 'invalid json body' }, 400);
      }
    }

    if (EDIT_KEY) {
      const key = headerKey(event) || (payload && typeof payload.key === 'string' ? payload.key : '');
      if (key !== EDIT_KEY) return json({ error: 'unauthorized' }, 401);
    }

    const store = openStore();

    if (event.httpMethod === 'GET') {
      const all = await readAll(store);
      const full = (event.queryStringParameters || {}).full === '1';
      if (full) return json(all, 200);
      const live = {};
      for (const [id, rec] of Object.entries(all)) if (isLive(rec)) live[id] = publicView(rec);
      return json(live, 200);
    }

    if (event.httpMethod === 'POST') {
      const id = payload.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) return json({ error: 'missing or invalid id' }, 400);
      const v = payload.v == null ? '' : String(payload.v);
      if (MARKS.indexOf(v) === -1) return json({ error: 'invalid mark' }, 400);
      const n = payload.n == null ? '' : String(payload.n);
      if (n.length > NOTE_MAX) return json({ error: 'note too long' }, 400);
      const code = typeof payload.code === 'string' ? payload.code.slice(0, 32) : '';

      const key = PREFIX + id;
      const prev = (await store.get(key, { type: 'json' })) || null;
      const prevV = prev ? prev.v || '' : '';
      const prevN = prev ? prev.n || '' : '';

      if (prev && prevV === v && prevN === n) {
        // Nothing changed; do not touch the record or its history.
        return json({ ok: true, id, unchanged: true, record: isLive(prev) ? publicView(prev) : null }, 200);
      }
      if (!prev && !v && !n.trim()) {
        // Nothing to clear.
        return json({ ok: true, id, unchanged: true, record: null }, 200);
      }

      const history = prev ? (Array.isArray(prev.history) ? prev.history.slice() : []) : [];
      if (prev) history.push({ v: prevV, n: prevN, at: prev.updatedAt || null });
      const rec = {
        v,
        n,
        code: code || (prev && prev.code) || '',
        updatedAt: new Date().toISOString(),
        history: history.slice(-HISTORY_MAX),
      };
      await store.setJSON(key, rec);
      return json({ ok: true, id, record: isLive(rec) ? publicView(rec) : null }, 200);
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('decisions function error', e);
    return json({ error: 'internal error', message: e && e.message }, 500);
  }
};
