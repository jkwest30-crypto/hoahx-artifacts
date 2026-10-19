// Shared store for the App Store listing review page (/app-review): each owner's Agree or
// Change on the listing questions, which screenshots they want Jacob to provide, and the images
// they upload. Backed by Netlify Blobs (site-wide store "hoahx-app-review"); no other service.
// Nothing is deleted: an answer keeps its history, an upload is replaced only by a newer one.
//
//   GET  /api/app-review                       -> { answers, shots, files }   (no image data)
//   GET  /api/app-review?file=<id>&chunk=<n>   -> { id, chunk, chunks, data (base64) }
//   POST /api/app-review { action, ... }
//     answer      { q: "Q01".."Q10", who, v: "" | "agree" | "change", n }
//     shot        { slot: "iphone-1" | "ipad-3" | "extra", who, v: "" | "jacob" }
//     file-chunk  { id, i, data }                one chunk (up to 2.5 MB of the file, base64)
//     file-done   { id, who, slot, name, type, size, chunks }   finishes an upload (who: an owner, or Jacob)
//
// If DECISION_EDIT_KEY is set on the Netlify site, every request must carry it, like the other stores.

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-app-review';
const OWNERS = ['Tenyson', 'Rustin', 'Dan'];
// Jacob uploads the screenshots he provides; the listing answers and choices stay the owners' own.
const UPLOADERS = OWNERS.concat(['Jacob']);
const Q_RE = /^Q(0[1-9]|10)$/;
const SLOT_RE = /^(iphone-[1-9]|ipad-(1|2|3|6|7)|extra)$/;
const ID_RE = /^[0-9a-f]{16,32}$/;
const TYPES = ['image/png', 'image/jpeg'];
const NOTE_MAX = 4000;
const NAME_MAX = 120;
const CHUNK_MAX = 4 * 1024 * 1024;       // characters of base64 in one request
const CHUNKS_MAX = 10;                   // about 25 MB of image
const HISTORY_MAX = 40;

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** An answer a POST asks to save, or why it is refused. Pure. */
function validateAnswer(p) {
  if (!Q_RE.test(String(p.q || ''))) return { error: 'invalid question' };
  if (!OWNERS.includes(p.who)) return { error: 'invalid name' };
  const v = p.v == null ? '' : String(p.v);
  if (!['', 'agree', 'change'].includes(v)) return { error: 'invalid v' };
  const n = clean(p.n, NOTE_MAX);
  return { q: p.q, who: p.who, v, n: v === 'change' ? n : '' };
}

/** A screenshot choice ("Jacob provides this one") a POST asks to save. Pure. */
function validateShot(p) {
  if (!SLOT_RE.test(String(p.slot || ''))) return { error: 'invalid slot' };
  if (!OWNERS.includes(p.who)) return { error: 'invalid name' };
  const v = p.v == null ? '' : String(p.v);
  if (!['', 'jacob'].includes(v)) return { error: 'invalid v' };
  return { slot: p.slot, who: p.who, v };
}

/** One chunk of an upload. Pure. */
function validateChunk(p) {
  if (!ID_RE.test(String(p.id || ''))) return { error: 'invalid id' };
  const i = Number(p.i);
  if (!Number.isInteger(i) || i < 0 || i >= CHUNKS_MAX) return { error: 'invalid chunk' };
  if (typeof p.data !== 'string' || !p.data || p.data.length > CHUNK_MAX || !/^[A-Za-z0-9+/=]+$/.test(p.data)) return { error: 'invalid data' };
  return { id: p.id, i, data: p.data };
}

/** The end of an upload. Pure. */
function validateDone(p) {
  if (!ID_RE.test(String(p.id || ''))) return { error: 'invalid id' };
  if (!UPLOADERS.includes(p.who)) return { error: 'invalid name' };
  if (!SLOT_RE.test(String(p.slot || ''))) return { error: 'invalid slot' };
  if (!TYPES.includes(p.type)) return { error: 'only PNG or JPEG images' };
  const chunks = Number(p.chunks);
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > CHUNKS_MAX) return { error: 'invalid chunks' };
  const size = Number(p.size);
  if (!Number.isInteger(size) || size < 1 || size > CHUNKS_MAX * 2.6 * 1024 * 1024) return { error: 'invalid size' };
  const name = clean(p.name, NAME_MAX).replace(/[\\/]/g, '_');
  if (!name) return { error: 'invalid name of file' };
  return { id: p.id, who: p.who, slot: p.slot, type: p.type, chunks, size, name };
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

async function readPrefix(store, prefix) {
  const out = {};
  const listed = await store.list({ prefix });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  blobs.forEach((b, i) => { if (recs[i] && typeof recs[i] === 'object') out[b.key.slice(prefix.length)] = recs[i]; });
  return out;
}

exports.validateAnswer = validateAnswer;
exports.validateShot = validateShot;
exports.validateChunk = validateChunk;
exports.validateDone = validateDone;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({}, 200);
  try {
    let payload = null;
    if (event.httpMethod === 'POST') {
      try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json({ error: 'invalid json body' }, 400); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid json body' }, 400);
    }
    if (EDIT_KEY && requestKey(event, payload) !== EDIT_KEY) return json({ error: 'unauthorized' }, 401);
    const store = openStore();
    const now = new Date().toISOString();

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      if (q.file) {
        if (!ID_RE.test(q.file)) return json({ error: 'invalid id' }, 400);
        const meta = await store.get('files/' + q.file + '/meta', { type: 'json' });
        if (!meta) return json({ error: 'no such file' }, 404);
        const i = Number(q.chunk || 0);
        if (!Number.isInteger(i) || i < 0 || i >= meta.chunks) return json({ error: 'invalid chunk' }, 400);
        const data = await store.get('files/' + q.file + '/c' + i, { type: 'text' });
        if (!data) return json({ error: 'chunk missing' }, 404);
        return json({ id: q.file, chunk: i, chunks: meta.chunks, data }, 200);
      }
      const [answers, shots, files] = await Promise.all([readPrefix(store, 'answers/'), readPrefix(store, 'shots/'), readFiles(store)]);
      return json({ answers, shots, files }, 200);
    }

    if (event.httpMethod === 'POST') {
      const action = payload.action;
      if (action === 'answer' || action === 'shot') {
        const asked = action === 'answer' ? validateAnswer(payload) : validateShot(payload);
        if (asked.error) return json({ error: asked.error }, 400);
        const key = action === 'answer' ? `answers/${asked.q}.${asked.who}` : `shots/${asked.slot}.${asked.who}`;
        const prev = (await store.get(key, { type: 'json' })) || null;
        const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
        if (prev && (prev.v !== asked.v || (prev.n || '') !== (asked.n || ''))) {
          history.push({ v: prev.v || '', n: prev.n || '', at: prev.updatedAt || now });
          while (history.length > HISTORY_MAX) history.shift();
        }
        const rec = Object.assign({}, asked, { updatedAt: now, history });
        await store.setJSON(key, rec);
        return json(rec, 200);
      }
      if (action === 'file-chunk') {
        const c = validateChunk(payload);
        if (c.error) return json({ error: c.error }, 400);
        await store.set('files/' + c.id + '/c' + c.i, c.data);
        return json({ id: c.id, i: c.i }, 200);
      }
      if (action === 'file-done') {
        const d = validateDone(payload);
        if (d.error) return json({ error: d.error }, 400);
        for (let i = 0; i < d.chunks; i++) {
          if (!(await store.get('files/' + d.id + '/c' + i, { type: 'text' }))) return json({ error: 'chunk ' + i + ' did not arrive; send the image again' }, 400);
        }
        const meta = { id: d.id, who: d.who, slot: d.slot, name: d.name, type: d.type, size: d.size, chunks: d.chunks, at: now };
        await store.setJSON('files/' + d.id + '/meta', meta);
        return json(meta, 200);
      }
      return json({ error: 'unknown action' }, 400);
    }
    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'store unavailable', detail: String(e && e.message || e) }, 500);
  }
};

async function readFiles(store) {
  const listed = await store.list({ prefix: 'files/' });
  const metas = ((listed && listed.blobs) || []).filter((b) => b.key.endsWith('/meta'));
  const recs = await Promise.all(metas.map((b) => store.get(b.key, { type: 'json' })));
  return recs.filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
