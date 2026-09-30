// Shared store for the video review: Jacob's sign-off page (/videos/review, not linked from anywhere)
// and the owners' page (/videos, and the "Videos to review" section on /answers).
// Backed by Netlify Blobs (site-wide store "hoahx-video-review"). History kept on every status;
// notes are never deleted. The one thing that is deleted is a full-size screenshot, and only after
// the pull has copied it to Drive and checked the copy (action "moved", Jacob's passphrase).
//
// Two sides, two gates:
//   owners  DECISION_EDIT_KEY, if it is set, like every other store on this site
//   jacob   VIDEO_REVIEW_KEY, always required. Unset means Jacob's side is closed.
//
//   GET  /api/videos                          owners' statuses and the owners' notes (previews only)
//   GET  /api/videos?side=jacob               + Jacob's sign-offs and notes, where each full-size copy is
//   GET  /api/videos?side=jacob&image=V05-N004-1   one full-size screenshot { ref, i, type, data (base64) }
//   POST /api/videos { action, ... }
//     status  { side, vid, status, commit, by? }        owners: '' | 'approved' | 'wrong'; jacob: '' | 'approved' | 'fix'
//     note    { side, vid, text, commit, by, images: [{ preview, w, h }] }  -> the note, with its ref
//     image   { side, ref, i, data }                    the full-size copy of one screenshot, after its note
//     moved   { ref, i, drive: { id, name } }           jacob only: the copy is in Drive and checked; drop the full size
//     watched { item, who, watched }                    owners: who has watched one product video (the list on
//                                                        /answers and /hub). item "f07" is feature video 07,
//                                                        "sA1" the film of screen A1; who is Dan, Rustin or Tenyson.
//   GET answers also carry  watched: { f07: { Dan: at, Tenyson: at }, ... }  (only the ones watched now)
//
// A note's ref ("V05-N004") is numbered per video across both sides and never reused.

const { getStore } = require('@netlify/blobs');

const OWNER_KEY = process.env.DECISION_EDIT_KEY || '';
const JACOB_KEY = process.env.VIDEO_REVIEW_KEY || '';
const STORE_NAME = 'hoahx-video-review';
const VID_RE = /^\d{2}$/;
const REF_RE = /^V(\d{2})-N(\d{3})$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const STATUSES = { owners: ['', 'approved', 'wrong'], jacob: ['', 'approved', 'fix'] };
const TEXT_MAX = 4000;
const BY_MAX = 60;
const IMAGES_MAX = 6;
const PREVIEW_MAX = 90 * 1024;          // characters of a data: URL, about 65 KB of JPEG
const FULL_MAX = 4 * 1024 * 1024;       // characters of base64, about 3 MB of JPEG (the request limit is 6 MB)
const HISTORY_MAX = 40;
const ITEM_RE = /^(f\d{2}|s[A-Z]\d{1,2})$/;
const WATCHERS = ['Dan', 'Rustin', 'Tenyson'];

function json(body, status) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function openStore() {
  if (process.env.SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN });
  }
  return getStore(STORE_NAME);
}

function keysFrom(event, payload) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  const pick = (name, body) => h[name] || h[name.replace(/(^|-)([a-z])/g, (m, d, c) => d + c.toUpperCase())] || (payload && typeof payload[body] === 'string' ? payload[body] : '') || q[body] || '';
  return { owner: pick('x-edit-key', 'key'), jacob: pick('x-review-key', 'reviewKey') };
}

/** Which side a request may act as. Pure. */
function allowedSides(keys, env) {
  const ownerKey = env.ownerKey || '';
  const jacobKey = env.jacobKey || '';
  const sides = new Set();
  const jacob = !!jacobKey && keys.jacob === jacobKey;
  if (jacob) sides.add('jacob');
  if (!ownerKey || keys.owner === ownerKey || jacob) sides.add('owners');
  return sides;
}

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** The status a POST asks to save, or why it is refused. Pure. */
function validateStatus(p) {
  const side = p.side === 'jacob' ? 'jacob' : p.side === 'owners' ? 'owners' : null;
  if (!side) return { error: 'invalid side' };
  if (!VID_RE.test(String(p.vid || ''))) return { error: 'invalid vid' };
  const status = p.status == null ? '' : String(p.status);
  if (!STATUSES[side].includes(status)) return { error: 'invalid status' };
  if (!COMMIT_RE.test(String(p.commit || ''))) return { error: 'invalid commit' };
  return { side, vid: p.vid, status, commit: p.commit, by: clean(p.by, BY_MAX) };
}

/** The note a POST asks to save, or why it is refused. Pure. */
function validateNote(p) {
  const side = p.side === 'jacob' ? 'jacob' : p.side === 'owners' ? 'owners' : null;
  if (!side) return { error: 'invalid side' };
  if (!VID_RE.test(String(p.vid || ''))) return { error: 'invalid vid' };
  if (!COMMIT_RE.test(String(p.commit || ''))) return { error: 'invalid commit' };
  const text = clean(p.text, TEXT_MAX);
  const images = Array.isArray(p.images) ? p.images : [];
  if (images.length > IMAGES_MAX) return { error: `at most ${IMAGES_MAX} screenshots on one note` };
  const out = [];
  for (const [k, im] of images.entries()) {
    const preview = String((im && im.preview) || '');
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview)) return { error: `screenshot ${k + 1}: preview must be a JPEG data URL` };
    if (preview.length > PREVIEW_MAX) return { error: `screenshot ${k + 1}: preview too large` };
    const w = Math.round(+im.w), h = Math.round(+im.h);
    if (!(w > 0 && h > 0 && w <= 4000 && h <= 8000)) return { error: `screenshot ${k + 1}: invalid size` };
    out.push({ i: k + 1, preview, w, h, full: false, drive: null });
  }
  if (!text && !out.length) return { error: 'a note needs words or a screenshot' };
  const by = clean(p.by, BY_MAX);
  if (side === 'owners' && !by) return { error: 'a note needs a name' };
  return { side, vid: p.vid, text, commit: p.commit, by: side === 'jacob' ? 'Jacob' : by, images: out };
}

/** A "watched" mark a POST asks to save, or why it is refused. Pure. */
function validateWatched(p) {
  const item = String(p.item || '');
  if (!ITEM_RE.test(item)) return { error: 'invalid item' };
  if (!WATCHERS.includes(p.who)) return { error: 'who must be Dan, Rustin or Tenyson' };
  if (typeof p.watched !== 'boolean') return { error: 'watched must be true or false' };
  return { item, who: p.who, watched: p.watched };
}

function publicNote(n) {
  return {
    ref: n.ref, vid: n.vid, side: n.side, by: n.by, at: n.at, commit: n.commit, text: n.text,
    images: (n.images || []).map((im) => ({ i: im.i, preview: im.preview, w: im.w, h: im.h, full: !!im.full, drive: im.drive || null })),
  };
}

async function readPrefix(store, prefix) {
  const listed = await store.list({ prefix });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  const out = {};
  blobs.forEach((b, i) => { if (recs[i] && typeof recs[i] === 'object') out[b.key.slice(prefix.length)] = recs[i]; });
  return out;
}

async function nextNumber(store, vid) {
  const listed = await store.list({ prefix: `note/${vid}/` });
  let max = 0;
  for (const b of (listed && listed.blobs) || []) max = Math.max(max, +b.key.split('/').pop() || 0);
  return max + 1;
}

async function handle(event) {
  let payload = null;
  if (event.httpMethod === 'POST') {
    try { payload = JSON.parse(event.body || '{}'); } catch (e) { return json({ error: 'invalid json body' }, 400); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid json body' }, 400);
  }
  const sides = allowedSides(keysFrom(event, payload), { ownerKey: OWNER_KEY, jacobKey: JACOB_KEY });
  const q = event.queryStringParameters || {};
  const store = openStore();

  if (event.httpMethod === 'GET') {
    const wantJacob = q.side === 'jacob';
    if (wantJacob && !sides.has('jacob')) return json({ error: JACOB_KEY ? 'unauthorized' : 'VIDEO_REVIEW_KEY is not set on the site' }, 401);
    if (!sides.has('owners')) return json({ error: 'unauthorized' }, 401);
    if (wantJacob && q.image) {
      const m = /^(V\d{2}-N\d{3})-(\d)$/.exec(q.image);
      if (!m) return json({ error: 'invalid image' }, 400);
      const data = await store.get(`img/${q.image}`);
      if (!data) return json({ error: 'not in the store' }, 404);
      return json({ ref: m[1], i: +m[2], type: 'image/jpeg', data }, 200);
    }
    const owners = await readPrefix(store, 'owners/');
    const notesRaw = await readPrefix(store, 'note/');
    const notes = Object.values(notesRaw).filter((n) => wantJacob || n.side === 'owners').map(publicNote)
      .sort((a, b) => a.ref.localeCompare(b.ref));
    const ownersOut = {};
    for (const [vid, r] of Object.entries(owners)) ownersOut[vid] = { status: r.status, commit: r.commit, by: r.by, at: r.at };
    // One record per video and person, so two people ticking the same video at once never overwrite each other.
    const watchedRaw = await readPrefix(store, 'watched/');
    const watched = {};
    for (const [k, r] of Object.entries(watchedRaw)) {
      const [item, who] = k.split('/');
      if (!r.watched || !ITEM_RE.test(item) || !WATCHERS.includes(who)) continue;
      (watched[item] = watched[item] || {})[who] = r.at;
    }
    const body = { owners: ownersOut, notes, watched };
    if (wantJacob) {
      const jacob = await readPrefix(store, 'jacob/');
      body.jacob = {};
      for (const [vid, r] of Object.entries(jacob)) body.jacob[vid] = { status: r.status, commit: r.commit, at: r.at };
    }
    return json(body, 200);
  }

  if (event.httpMethod !== 'POST') return json({ error: 'method not allowed' }, 405);
  const action = payload.action;
  const now = new Date().toISOString();
  const need = (side) => (sides.has(side) ? null : json({ error: side === 'jacob' && !JACOB_KEY ? 'VIDEO_REVIEW_KEY is not set on the site' : 'unauthorized' }, 401));

  if (action === 'status') {
    const a = validateStatus(payload);
    if (a.error) return json({ error: a.error }, 400);
    const denied = need(a.side); if (denied) return denied;
    const key = `${a.side}/${a.vid}`;
    const prev = await store.get(key, { type: 'json' });
    const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
    if (prev) { history.push({ status: prev.status, commit: prev.commit, by: prev.by || '', at: prev.at }); while (history.length > HISTORY_MAX) history.shift(); }
    const rec = { status: a.status, commit: a.commit, by: a.by, at: now, history };
    await store.setJSON(key, rec);
    return json({ vid: a.vid, side: a.side, status: rec.status, commit: rec.commit, by: rec.by, at: now }, 200);
  }

  if (action === 'watched') {
    const a = validateWatched(payload);
    if (a.error) return json({ error: a.error }, 400);
    const denied = need('owners'); if (denied) return denied;
    const key = `watched/${a.item}/${a.who}`;
    const prev = await store.get(key, { type: 'json' });
    const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
    if (prev) { history.push({ watched: prev.watched, at: prev.at }); while (history.length > HISTORY_MAX) history.shift(); }
    await store.setJSON(key, { watched: a.watched, at: now, history });
    return json({ item: a.item, who: a.who, watched: a.watched, at: now }, 200);
  }

  if (action === 'note') {
    const a = validateNote(payload);
    if (a.error) return json({ error: a.error }, 400);
    const denied = need(a.side); if (denied) return denied;
    // Two notes at once could pick the same number: take the next free one.
    let n = await nextNumber(store, a.vid);
    while (await store.get(`note/${a.vid}/${String(n).padStart(3, '0')}`)) n += 1;
    const ref = `V${a.vid}-N${String(n).padStart(3, '0')}`;
    const note = { ref, vid: a.vid, n, side: a.side, by: a.by, at: now, commit: a.commit, text: a.text, images: a.images };
    await store.setJSON(`note/${a.vid}/${String(n).padStart(3, '0')}`, note);
    return json(publicNote(note), 200);
  }

  if (action === 'image' || action === 'moved') {
    const m = REF_RE.exec(String(payload.ref || ''));
    const i = +payload.i;
    if (!m || !(i >= 1 && i <= IMAGES_MAX)) return json({ error: 'invalid ref or image number' }, 400);
    const key = `note/${m[1]}/${m[2]}`;
    const note = await store.get(key, { type: 'json' });
    if (!note) return json({ error: 'no such note' }, 404);
    const im = (note.images || []).find((x) => x.i === i);
    if (!im) return json({ error: 'no such screenshot on that note' }, 404);

    if (action === 'image') {
      const denied = need(note.side); if (denied) return denied;
      if (im.drive) return json({ error: 'already moved to Drive' }, 409);
      const data = String(payload.data || '');
      if (!/^[A-Za-z0-9+/=]+$/.test(data) || !data.startsWith('/9j/')) return json({ error: 'full size must be a base64 JPEG' }, 400);
      if (data.length > FULL_MAX) return json({ error: 'full size too large' }, 413);
      await store.set(`img/${note.ref}-${i}`, data);
      im.full = true;
      await store.setJSON(key, note);
      return json(publicNote(note), 200);
    }

    const denied = need('jacob'); if (denied) return denied;
    const d = payload.drive || {};
    if (!/^[\w-]{10,}$/.test(String(d.id || '')) || !d.name) return json({ error: 'invalid drive location' }, 400);
    im.drive = { id: String(d.id), name: clean(d.name, 200), at: now };
    im.full = false;
    await store.setJSON(key, note);
    await store.delete(`img/${note.ref}-${i}`);
    return json(publicNote(note), 200);
  }

  return json({ error: 'unknown action' }, 400);
}

exports.validateStatus = validateStatus;
exports.validateNote = validateNote;
exports.validateWatched = validateWatched;
exports.allowedSides = allowedSides;

exports.handler = async (event) => {
  try {
    return await handle(event);
  } catch (e) {
    return json({ error: 'store unavailable', detail: String((e && e.message) || e) }, 500);
  }
};
