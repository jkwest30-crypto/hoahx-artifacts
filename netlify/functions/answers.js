// Shared, server-side store for the owners' answers on /answers (HOAhx · Open questions, answered
// by recommendation). Backed by Netlify Blobs (site-wide store "hoahx-answers"); no external
// database. Same shape and rules as picks.js and decisions.js: one blob per recommendation card,
// history kept, nothing ever deleted.
//
//   GET  /api/answers          -> { "<id>": { v, n, code, updatedAt }, ... }   (live marks, notes, the message, the last submission)
//   GET  /api/answers?full=1   -> every record with its history
//   POST /api/answers          { id, v, n, code?, key? } -> saves that one record and returns it
//
//   id: a recommendation card ("A01" … "A23"), "_message" (the owners' closing message), or
//       "_submission" (n = the plain-text summary the page sends when the owners press Send)
//   v:  "agree" when the owners agree with the recommendation, "change" when they want it changed
//       (n then carries what should be different), "" when cleared
//
// If DECISION_EDIT_KEY is set on the Netlify site, every request must carry it (the same
// passphrase as the Decision Register): the `x-edit-key` header, `key` in a POST body, or
// `?key=` on a GET.

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-answers';
const PREFIX = 'items/';
const HISTORY_MAX = 40;
const NOTE_MAX = 20000;
const ID_RE = /^[A-Za-z_][A-Za-z0-9-]{0,31}$/;
const MARKS = ['', 'agree', 'change'];

function json(body, status) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function openStore() {
  if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(STORE_NAME);
}

function requestKey(event, payload) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  return h['x-edit-key'] || h['X-Edit-Key'] || (payload && typeof payload.key === 'string' ? payload.key : '') || q.key || '';
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
  const listed = await store.list({ prefix: PREFIX });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  blobs.forEach((b, i) => { if (recs[i] && typeof recs[i] === 'object') all[b.key.slice(PREFIX.length)] = recs[i]; });
  return all;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({}, 200);
  try {
    let payload = null;
    if (event.httpMethod === 'POST') {
      try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json({ error: 'invalid json body' }, 400); }
    }
    if (EDIT_KEY && requestKey(event, payload) !== EDIT_KEY) return json({ error: 'unauthorized' }, 401);

    const store = openStore();

    if (event.httpMethod === 'GET') {
      const all = await readAll(store);
      if ((event.queryStringParameters || {}).full === '1') return json(all, 200);
      const live = {};
      for (const [id, rec] of Object.entries(all)) if (isLive(rec)) live[id] = publicView(rec);
      return json(live, 200);
    }

    if (event.httpMethod === 'POST') {
      const id = payload.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) return json({ error: 'missing or invalid id' }, 400);
      const v = payload.v == null ? '' : String(payload.v);
      if (!MARKS.includes(v)) return json({ error: 'invalid v' }, 400);
      const n = payload.n == null ? '' : String(payload.n).slice(0, NOTE_MAX);
      const code = payload.code == null ? '' : String(payload.code).slice(0, 40);
      const key = PREFIX + id;
      const prev = (await store.get(key, { type: 'json' })) || null;
      const now = new Date().toISOString();
      const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
      if (prev && (prev.v !== v || (prev.n || '') !== n)) {
        history.push({ v: prev.v || '', n: prev.n || '', at: prev.updatedAt || now });
        while (history.length > HISTORY_MAX) history.shift();
      }
      const rec = { v, n, code: code || (prev && prev.code) || '', updatedAt: now, history };
      await store.setJSON(key, rec);
      return json(Object.assign({ id }, publicView(rec)), 200);
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'store unavailable', detail: String(e && e.message || e) }, 500);
  }
};
