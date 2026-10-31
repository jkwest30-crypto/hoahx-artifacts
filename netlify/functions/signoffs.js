// Shared store for What's in the Build (/whats-in-the-build): each reviewer's sign-off and note on
// each numbered line of the owners' Core list. Jacob reads them all at /whats-in-the-build/responses.
// Backed by Netlify Blobs (site-wide store "hoahx-build-signoffs"), one record per line and person
// (line/<line>/<person>), so two people saving at once never overwrite each other. Every change is
// kept in the record's history; removing a sign-off or a note only clears the current value.
//
// If DECISION_EDIT_KEY is set on the site, every request must carry it, like the other stores here.
//
//   GET  /api/signoffs                                  { records: [...] }, without their history
//   POST /api/signoffs { action: 'signoff', line, by, signed }
//   POST /api/signoffs { action: 'note', line, by, text }     empty text removes the note

const { getStore } = require('@netlify/blobs');

const EDIT_KEY = process.env.DECISION_EDIT_KEY || '';
const STORE_NAME = 'hoahx-build-signoffs';
const LINE_RE = /^([1-9]|[12]\d)\.[1-9]\d?$/; // the Core list has 29 areas
const NAME_MAX = 60;
const TEXT_MAX = 4000;
const HISTORY_MAX = 40;

function json(body, status) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function openStore() {
  if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(STORE_NAME);
}

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const personKey = (name) => clean(name, NAME_MAX).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The change a POST asks to save, or why it is refused. Pure. */
function validate(p) {
  if (p.action !== 'signoff' && p.action !== 'note') return { error: 'invalid action' };
  const line = String(p.line || '');
  if (!LINE_RE.test(line)) return { error: 'invalid line' };
  const by = clean(p.by, NAME_MAX);
  const person = personKey(by);
  if (!person) return { error: 'a name is required' };
  if (p.action === 'signoff') {
    if (typeof p.signed !== 'boolean') return { error: 'signed must be true or false' };
    return { action: p.action, line, by, person, signed: p.signed };
  }
  return { action: p.action, line, by, person, text: clean(p.text, TEXT_MAX) };
}

/** The record after a change. Pure, apart from the time it is given. */
function applyChange(rec, a, at) {
  const next = rec || { line: a.line, person: a.person, by: a.by, signed: false, signedAt: '', note: '', noteAt: '', history: [] };
  next.by = a.by;
  if (a.action === 'signoff') { next.signed = a.signed; next.signedAt = a.signed ? at : ''; }
  else { next.note = a.text; next.noteAt = a.text ? at : ''; }
  const entry = a.action === 'signoff' ? { at, by: a.by, signed: a.signed } : { at, by: a.by, note: a.text };
  next.history = [...(next.history || []), entry].slice(-HISTORY_MAX);
  return next;
}

function publicRecord(r) {
  return { line: r.line, person: r.person, by: r.by, signed: !!r.signed, signedAt: r.signedAt || '', note: r.note || '', noteAt: r.noteAt || '' };
}

async function handle(event) {
  const h = event.headers || {};
  if (EDIT_KEY && (h['x-edit-key'] || h['X-Edit-Key'] || '') !== EDIT_KEY) return json({ error: 'unauthorized' }, 401);
  const store = openStore();

  if (event.httpMethod === 'GET') {
    const listed = await store.list({ prefix: 'line/' });
    const blobs = (listed && listed.blobs) || [];
    const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
    return json({ records: recs.filter((r) => r && (r.signed || r.note)).map(publicRecord) }, 200);
  }
  if (event.httpMethod !== 'POST') return json({ error: 'method not allowed' }, 405);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json({ error: 'invalid json body' }, 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid json body' }, 400);
  const a = validate(payload);
  if (a.error) return json({ error: a.error }, 400);
  const key = `line/${a.line}/${a.person}`;
  const rec = applyChange(await store.get(key, { type: 'json' }), a, new Date().toISOString());
  await store.setJSON(key, rec);
  return json({ record: publicRecord(rec) }, 200);
}

exports.validate = validate;
exports.applyChange = applyChange;

exports.handler = async (event) => {
  try {
    return await handle(event);
  } catch (e) {
    return json({ error: 'store unavailable', detail: String((e && e.message) || e) }, 500);
  }
};
