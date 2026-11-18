// Shared store for Jacob's internal pages that used to live on claude.ai (moved 2026-11-17):
// the Launch List (/launch-list), the run's gate page (/gate) and the sign-off book (/signoff).
// Backed by Netlify Blobs (site-wide store "hoahx-pagestore"). The pages talk to it through
// go-live/_shared/hx-store.js, which gives them the same `db` / `user` / `assets` calls they made
// on claude.ai; agents use .claude/skills/page-publisher/pagestore.py in the main repo.
//
// No passphrase (Jacob, 2026-11-17: "I don't care if they see it"). Nothing on the owners' pages
// links here, and every answer says noindex.
//
// Records are documents in collections, as on claude.ai. Every overwrite or delete keeps the
// previous version under prev/ (the last PREV_MAX per document), so a bad write can be undone.
//
//   GET    /api/store/<page>/<collection>                    { docs: [{ id, data, updatedAt }] }; updatedAt is the doc's version
//   GET    /api/store/<page>/<collection>?where=<f>&eq=<v>    the same, only docs whose field f == v
//   GET    /api/store/<page>/<collection>/<doc>              { exists, id, data, updatedAt }
//   PUT    /api/store/<page>/<collection>/<doc>  { data }    replace (set)
//          any write may carry ifVersion (the updatedAt it read, or null for "must not exist yet"):
//          a mismatch is refused 409 { error: 'version conflict', current }, as claude.ai's if_version
//   PATCH  /api/store/<page>/<collection>/<doc>  { data }    merge top-level fields (update; the doc must exist)
//   DELETE /api/store/<page>/<collection>/<doc>              delete
//   POST   /api/store/<page>/<collection>        { data }    add with a new id   -> { id }
//   POST   /api/store/<page>/_batch  { ops: [{ op: set|update|delete, collection, doc, data }] }
//   GET    /api/store/<page>/_collections                    { collections: [...] }
//   POST   /api/store/<page>/_assets { name, type, base64 }  -> { id, url }
//   GET    /api/store/<page>/_assets/<id>                    the file itself
//   DELETE /api/store/<page>/_assets/<id>

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'hoahx-pagestore';
const PAGES = ['launch-list', 'gate', 'signoff'];
const COLLECTION_RE = /^[a-z][a-z0-9_]{0,39}$/;
const DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const ASSET_RE = /^[a-f0-9]{32}$/;
const DOC_MAX = 1024 * 1024;          // one document, as JSON
const ASSET_MAX = 4.5 * 1024 * 1024;  // one file (a function body is capped near 6 MB, base64 adds a third)
const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const BATCH_MAX = 200;
const PREV_MAX = 5;

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body, status) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

function openStore() {
  if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(STORE_NAME);
}

/** The path's parts after /api/store/ (or the function's own path). Pure. */
function parts(event) {
  const p = String(event.path || '');
  const m = p.match(/\/(?:api\/store|\.netlify\/functions\/pagestore)\/?(.*)$/);
  return (m ? m[1] : '').split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

const docKey = (page, col, id) => `doc/${page}/${col}/${id}`;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const newId = () => require('crypto').randomBytes(10).toString('hex');

async function readDoc(store, page, col, id) {
  return store.get(docKey(page, col, id), { type: 'json' });
}

async function keepPrevious(store, page, col, id, rec) {
  if (!rec) return;
  const base = `prev/${page}/${col}/${id}/`;
  await store.setJSON(base + new Date().toISOString(), rec);
  const listed = await store.list({ prefix: base });
  const keys = ((listed && listed.blobs) || []).map((b) => b.key).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - PREV_MAX))) await store.delete(k);
}

/** One write, validated. Returns { ok, id } or { error, status }. */
async function write(store, page, op, col, id, data, ifVersion) {
  if (!COLLECTION_RE.test(col || '')) return { error: 'invalid collection', status: 400 };
  if (!DOC_RE.test(id || '')) return { error: 'invalid document id', status: 400 };
  const key = docKey(page, col, id);
  const prev = await store.get(key, { type: 'json' });
  // A pin: the write applies only to the version the writer read (null: only if the doc does not exist yet).
  if (ifVersion !== undefined) {
    const current = prev ? prev.updatedAt : null;
    if (current !== ifVersion) return { error: 'version conflict', status: 409, current };
  }
  if (op === 'delete') {
    if (prev) { await keepPrevious(store, page, col, id, prev); await store.delete(key); }
    return { ok: true, id };
  }
  if (!isPlainObject(data)) return { error: 'data must be an object', status: 400 };
  let next;
  if (op === 'set') next = data;
  else if (op === 'update') {
    if (!prev) return { error: 'no such document', status: 404 };
    next = Object.assign({}, prev.data, data);
  } else return { error: 'invalid op', status: 400 };
  let at = new Date().toISOString();
  if (prev && prev.updatedAt >= at) at = new Date(Date.parse(prev.updatedAt) + 1).toISOString(); // versions always move forward
  const rec = { data: next, updatedAt: at };
  if (JSON.stringify(rec).length > DOC_MAX) return { error: 'document over 1 MB', status: 413 };
  await keepPrevious(store, page, col, id, prev);
  await store.setJSON(key, rec);
  return { ok: true, id, version: rec.updatedAt };
}

async function listCollection(store, page, col) {
  const prefix = `doc/${page}/${col}/`;
  const listed = await store.list({ prefix });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return blobs.map((b, i) => recs[i] && { id: b.key.slice(prefix.length), data: recs[i].data, updatedAt: recs[i].updatedAt }).filter(Boolean);
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
}

async function assets(store, page, method, id, event) {
  if (method === 'POST') {
    let p; try { p = parseBody(event); } catch (e) { return json({ error: 'invalid json body' }, 400); }
    const type = String(p.type || '');
    if (!ASSET_TYPES.includes(type)) return json({ error: 'unsupported_type' }, 415);
    const b64 = String(p.base64 || '');
    if (!b64 || b64.length * 0.75 > ASSET_MAX) return json({ error: 'too_large' }, 413);
    const aid = require('crypto').randomBytes(16).toString('hex');
    await store.setJSON(`asset/${page}/${aid}`, { type, name: String(p.name || '').slice(0, 120), base64: b64, at: new Date().toISOString() });
    return json({ id: aid, url: `/api/store/${page}/_assets/${aid}` }, 200);
  }
  if (!ASSET_RE.test(id || '')) return json({ error: 'invalid asset id' }, 400);
  const key = `asset/${page}/${id}`;
  if (method === 'GET') {
    const a = await store.get(key, { type: 'json' });
    if (!a) return json({ error: 'not found' }, 404);
    return { statusCode: 200, headers: { 'Content-Type': a.type, 'Cache-Control': 'private, max-age=86400', 'X-Robots-Tag': 'noindex' }, body: a.base64, isBase64Encoded: true };
  }
  if (method === 'DELETE') { await store.delete(key); return json({ ok: true }, 200); }
  return json({ error: 'method not allowed' }, 405);
}

async function handle(event) {
  const method = event.httpMethod;
  const [page, col, id, extra] = parts(event);
  if (!PAGES.includes(page)) return json({ error: 'unknown page' }, 404);
  if (extra !== undefined) return json({ error: 'invalid path' }, 400);
  const store = openStore();

  if (col === '_assets') return assets(store, page, method, id, event);

  if (col === '_collections' && method === 'GET') {
    const listed = await store.list({ prefix: `doc/${page}/` });
    const names = new Set(((listed && listed.blobs) || []).map((b) => b.key.split('/')[2]));
    return json({ collections: [...names].sort() }, 200);
  }

  if (col === '_batch') {
    if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
    let p; try { p = parseBody(event); } catch (e) { return json({ error: 'invalid json body' }, 400); }
    const ops = Array.isArray(p.ops) ? p.ops : null;
    if (!ops || !ops.length || ops.length > BATCH_MAX) return json({ error: `ops must be 1 to ${BATCH_MAX} writes` }, 400);
    // Check every op's shape before writing any, so a typo never leaves half a batch.
    for (const o of ops) {
      if (!['set', 'update', 'delete'].includes(o && o.op)) return json({ error: 'invalid op' }, 400);
      if (!COLLECTION_RE.test(o.collection || '') || !DOC_RE.test(o.doc || '')) return json({ error: 'invalid collection or document id' }, 400);
      if (o.op !== 'delete' && !isPlainObject(o.data)) return json({ error: 'data must be an object' }, 400);
      if ('ifVersion' in o && o.ifVersion !== null && typeof o.ifVersion !== 'string') return json({ error: 'ifVersion must be a string or null' }, 400);
    }
    const results = [];
    for (const o of ops) {
      const r = await write(store, page, o.op, o.collection, o.doc, o.data, 'ifVersion' in o ? o.ifVersion : undefined);
      results.push(r.ok ? { ok: true, collection: o.collection, doc: o.doc, version: r.version } : { error: r.error, collection: o.collection, doc: o.doc, current: r.current });
    }
    return json({ results }, 200);
  }

  if (!COLLECTION_RE.test(col || '')) return json({ error: 'invalid collection' }, 400);

  if (method === 'GET') {
    if (id === undefined) {
      let docs = await listCollection(store, page, col);
      const q = event.queryStringParameters || {};
      if (q.where) docs = docs.filter((d) => d.data && String(d.data[q.where]) === String(q.eq));
      return json({ docs }, 200);
    }
    if (!DOC_RE.test(id)) return json({ error: 'invalid document id' }, 400);
    const rec = await readDoc(store, page, col, id);
    return json(rec ? { exists: true, id, data: rec.data, updatedAt: rec.updatedAt } : { exists: false, id }, 200);
  }

  let body = {};
  if (method !== 'DELETE') { try { body = parseBody(event); } catch (e) { return json({ error: 'invalid json body' }, 400); } }

  if (method === 'POST' && id === undefined) {
    const r = await write(store, page, 'set', col, newId(), body.data);
    return r.ok ? json({ id: r.id, version: r.version }, 200) : json({ error: r.error }, r.status);
  }
  const op = { PUT: 'set', PATCH: 'update', DELETE: 'delete' }[method];
  if (!op || id === undefined) return json({ error: 'method not allowed' }, 405);
  const r = await write(store, page, op, col, id, body.data, 'ifVersion' in body ? body.ifVersion : undefined);
  return r.ok ? json({ ok: true, id, version: r.version }, 200) : json({ error: r.error, current: r.current }, r.status);
}

exports.handler = async (event) => {
  try { return await handle(event); } catch (e) { return json({ error: 'store error: ' + (e && e.message ? e.message : 'unknown') }, 500); }
};
exports._test = { parts, PAGES };
