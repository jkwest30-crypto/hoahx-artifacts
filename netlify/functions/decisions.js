// Shared, server-side store for the Decision Register.
// Backed by Netlify Blobs — no external database needed.
//
// GET  /api/decisions            -> { "<id>": { v: "keep"|"change"|"discuss", n: "note text", updatedAt }, ... }
// POST /api/decisions  { id, v, n } -> merges this one decision into the shared store and returns it
//
// If the DECISION_EDIT_KEY environment variable is set on the Netlify site,
// POST requests must include a matching `x-edit-key` header or they are rejected
// with 401. Leave it unset to allow anyone with the URL to save (not recommended
// for a public repo hosting real business decisions).

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-decisions';
const BLOB_KEY = 'register';

function json(body, status, extraHeaders) {
  return {
    statusCode: status,
    headers: Object.assign(
      {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-edit-key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Cache-Control': 'no-store',
      },
      extraHeaders || {}
    ),
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({}, 200);

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    const data = (await store.get(BLOB_KEY, { type: 'json' })) || {};
    return json(data, 200);
  }

  if (event.httpMethod === 'POST') {
    if (EDIT_KEY) {
      const key = event.headers['x-edit-key'] || event.headers['X-Edit-Key'];
      if (key !== EDIT_KEY) return json({ error: 'unauthorized' }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return json({ error: 'invalid json body' }, 400);
    }

    const { id, v, n } = payload;
    if (!id || typeof id !== 'string') return json({ error: 'missing id' }, 400);

    const data = (await store.get(BLOB_KEY, { type: 'json' })) || {};
    const rec = {};
    if (v) rec.v = String(v);
    if (n && String(n).trim()) rec.n = String(n);

    if (!rec.v && !rec.n) {
      delete data[id];
    } else {
      rec.updatedAt = new Date().toISOString();
      data[id] = rec;
    }

    await store.setJSON(BLOB_KEY, data);
    return json({ ok: true, id, record: data[id] || null }, 200);
  }

  return json({ error: 'method not allowed' }, 405);
};
