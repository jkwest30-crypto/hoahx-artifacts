// Shared, server-side store for the owners' answers on the open questions page (served at the
// site root and at /answers). Backed by Netlify Blobs (site-wide store "hoahx-answers"); no
// external database. Same rules as decisions.js: one blob per id, history kept,
// nothing ever deleted.
//
//   GET  /api/answers          -> { "<id>": { v, n, code, by, updatedAt }, ... }   (live marks, notes, the message, the last submission)
//   GET  /api/answers?full=1   -> every record with its history
//   POST /api/answers          { id, v, n, code?, by?, key? } -> saves that one record and returns it
//
//   id: one question ("A01-1" … "A28-1": a card's id, a dash, the question's own permanent
//       number), a screen ("S-D1" … "S-A7"), "_message" (a closing message), or "_submission"
//       (n = the plain-text summary the page sends when the owners press Send).
//       A card-level id ("A01") is what the page saved before it asked per question. It is still
//       accepted, so an old tab left open does not fail, but the page no longer reads it.
//   v:  for a question: "agree", "change" (n carries what it should be instead), "discuss"
//       (n carries what to talk through, if anything), or "" when cleared.
//       for a screen: "yes", "change", "discuss" or "". "agree" is not a screen answer.
//       for a card-level id: "agree", "change" or "".
//   by: who answered, as they typed their name (the screen preview on the test site asks for it;
//       the questions page does not, so an answer given there carries no name).
//
// The screen preview on the test site (https://hoahx-staging.web.app/preview) answers the "S-…"
// records from another origin: CORS is open to that origin and to local dev servers only.
//
// If DECISION_EDIT_KEY is set on the Netlify site, every request must carry it: the `x-edit-key`
// header, `key` in a POST body, or `?key=` on a GET. The same variable gates the other stores
// on this site.

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-answers';
const PREFIX = 'items/';
const HISTORY_MAX = 40;
const NOTE_MAX = 20000;
const ID_RE = /^[A-Za-z_][A-Za-z0-9-]{0,31}$/;
const MARKS = ['', 'agree', 'change'];
const QUESTION_ID_RE = /^A\d{2}-\d{1,2}$/;
const QUESTION_MARKS = ['', 'agree', 'change', 'discuss'];
const SCREEN_ID_RE = /^S-[A-Z]\d{1,2}$/;
const SCREEN_MARKS = ['', 'yes', 'change', 'discuss'];
const BY_MAX = 60;
const CORS_ORIGINS = ['https://hoahx-staging.web.app', 'https://hoahx-staging.firebaseapp.com'];
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;

function corsFor(event) {
  const h = event.headers || {};
  const origin = h.origin || h.Origin || '';
  if (!origin || !(CORS_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-edit-key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// Which answers an id may carry. A question and a screen each have their own three; anything
// else (a card-level id from the earlier page, the message, the submission) keeps the first two.
function marksFor(id) {
  if (SCREEN_ID_RE.test(id)) return SCREEN_MARKS;
  if (QUESTION_ID_RE.test(id)) return QUESTION_MARKS;
  return MARKS;
}

// The record a POST body asks to save, or the reason it is refused. Pure: no store, no clock.
function validate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'invalid json body' };
  const id = payload.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'missing or invalid id' };
  const v = payload.v == null ? '' : String(payload.v);
  if (!marksFor(id).includes(v)) return { error: 'invalid v' };
  const n = payload.n == null ? '' : String(payload.n).slice(0, NOTE_MAX);
  const code = payload.code == null ? '' : String(payload.code).slice(0, 40);
  const by = payload.by == null ? '' : String(payload.by).replace(/[\u0000-\u001f]/g, '').trim().slice(0, BY_MAX);
  return { id, v, n, code, by };
}

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
  if (rec.by) out.by = rec.by;
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

// Every answer, including a refusal, carries the CORS headers for an allowed origin, so the
// preview can read a 401 and ask for the passphrase.
exports.validate = validate;
exports.marksFor = marksFor;

exports.handler = async (event) => {
  const res = await handle(event);
  res.headers = Object.assign({}, res.headers, corsFor(event));
  return res;
};

async function handle(event) {
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
      const asked = validate(payload);
      if (asked.error) return json({ error: asked.error }, 400);
      const { id, v, n, code, by } = asked;
      const key = PREFIX + id;
      const prev = (await store.get(key, { type: 'json' })) || null;
      const now = new Date().toISOString();
      const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
      if (prev && (prev.v !== v || (prev.n || '') !== n)) {
        history.push({ v: prev.v || '', n: prev.n || '', by: prev.by || '', at: prev.updatedAt || now });
        while (history.length > HISTORY_MAX) history.shift();
      }
      const rec = { v, n, by, code: code || (prev && prev.code) || '', updatedAt: now, history };
      await store.setJSON(key, rec);
      return json(Object.assign({ id }, publicView(rec)), 200);
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'store unavailable', detail: String(e && e.message || e) }, 500);
  }
}
