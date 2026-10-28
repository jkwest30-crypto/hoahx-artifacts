// Shared, server-side store for the hands-on checks on /qa (HOAhx · Hands-on checks). Backed by
// Netlify Blobs (site-wide store "hoahx-qa"); no external database. Same pattern as answers.js:
// one blob per record, history kept, nothing ever deleted.
//
// The passphrase is QA_KEY in the site's environment variables, and it is optional
// (Jacob, 2026-10-09: no passphrase for now):
//   QA_KEY unset -> the page is open: anyone with the link reads and records runs, results,
//                   submissions and screenshots. The test accounts' sign-in details are the one
//                   thing never served without a key (403 { error: 'passphrase not set' }), and
//                   cannot be uploaded: testers get them from the contractor packet instead.
//   QA_KEY set   -> every request except GET ?status=1 must carry it: the `x-edit-key` header,
//                   `key` in a POST body, or `?key=` on a GET. Compared in constant time.
//
//   GET  /api/qa?status=1         -> { keySet }
//   GET  /api/qa?runs=1           -> { runs: [ run header, ... ] }            newest first
//   GET  /api/qa?run=<id>         -> { run, results: { "QA-001": {...} }, submission }
//   GET  /api/qa?full=1           -> every run, result, submission and screenshot record with its
//                                    history (screenshot records without the image), for the pull
//   GET  /api/qa?accounts=1       -> { accounts, uploadedAt }                 the sign-in details
//   GET  /api/qa?shot=<id>        -> { id, run, card, mime, bytes, data }     data is base64
//
//   POST /api/qa { kind: 'run', run: { id, env, build, seedReset, tester, device, scope } }
//   POST /api/qa { kind: 'result', run, card, outcome, notes, shots: [ids], tester }
//   POST /api/qa { kind: 'shot', run, card, mime, data }                      -> { id }
//   POST /api/qa { kind: 'submission', run, text }
//   POST /api/qa { kind: 'accounts', accounts: { ... } }                      the publish script's upload
//
// A screenshot is returned as base64 inside JSON, not as a binary body: that form works the same
// on Netlify Functions (v1 handler) and in the local stand-in (scripts/dev-register.mjs), and the
// page can fetch it with the passphrase in a header rather than in an image URL.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'hoahx-qa';
const P = { run: 'run/', result: 'result/', shot: 'shot/', submission: 'submission/', accounts: 'accounts/current' };
const HISTORY_MAX = 40;
const NOTE_MAX = 8000;
const TEXT_MAX = 60000;
const FIELD_MAX = 200;
const SHOTS_PER_RESULT = 5;
const SHOT_MAX_BYTES = Math.floor(2.5 * 1024 * 1024);
const ACCOUNTS_MAX = 200000;

const RUN_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const CARD_RE = /^QA-\d{3}$/;
const SHOT_RE = /^[a-f0-9]{24}$/;
const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;
const OUTCOMES = ['', 'pass', 'fail', 'blocked', 'not-provable'];
const NEEDS_NOTES = ['fail', 'blocked', 'not-provable'];
const SCOPES = ['all', 'feature', 'milestone'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

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

// Constant time whatever the lengths: compare fixed-length digests.
function keyMatches(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b) && String(given || '').length > 0;
}

const str = (v, max) => (v == null ? '' : String(v)).slice(0, max || FIELD_MAX);

async function readPrefix(store, prefix) {
  const out = {};
  const listed = await store.list({ prefix });
  const blobs = (listed && listed.blobs) || [];
  const recs = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  blobs.forEach((b, i) => { if (recs[i] && typeof recs[i] === 'object') out[b.key.slice(prefix.length)] = recs[i]; });
  return out;
}

function pushHistory(prev, fields, now) {
  const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
  if (prev) {
    const snap = { at: prev.updatedAt || now };
    fields.forEach((f) => { snap[f] = prev[f]; });
    history.push(snap);
    while (history.length > HISTORY_MAX) history.shift();
  }
  return history;
}
const changed = (prev, next, fields) => !prev || fields.some((f) => JSON.stringify(prev[f]) !== JSON.stringify(next[f]));
const withoutHistory = (rec) => { if (!rec) return rec; const o = Object.assign({}, rec); delete o.history; return o; };

function magicMatches(buf, mime) {
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === 'image/png') return buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  return false;
}

// ── writes ────────────────────────────────────────────────────────────────
async function saveRun(store, input) {
  const r = input && typeof input === 'object' ? input : {};
  const id = str(r.id, 64);
  if (!RUN_RE.test(id)) return json({ error: 'run id must be YYYY-MM-DD-<short-name>' }, 400);
  const env = str(r.env, 32);
  if (!SLUG_RE.test(env)) return json({ error: 'invalid env' }, 400);
  const scopeIn = r.scope && typeof r.scope === 'object' ? r.scope : { type: 'all' };
  const scope = { type: str(scopeIn.type, 16), value: str(scopeIn.value, 40) };
  if (!SCOPES.includes(scope.type)) return json({ error: 'invalid scope' }, 400);
  if (scope.type === 'all') scope.value = '';
  else if (!scope.value) return json({ error: 'scope needs a value' }, 400);
  const tester = str(r.tester).trim();
  if (!tester) return json({ error: 'a run needs the tester\'s name' }, 400);
  const key = P.run + id;
  const prev = await store.get(key, { type: 'json' });
  const now = new Date().toISOString();
  const next = {
    id, date: id.slice(0, 10), env, build: str(r.build, 40).trim(), seedReset: str(r.seedReset).trim(),
    tester, device: str(r.device).trim(), scope,
  };
  const FIELDS = ['env', 'build', 'seedReset', 'tester', 'device', 'scope'];
  if (prev && !changed(prev, next, FIELDS)) return json({ run: withoutHistory(prev) }, 200);
  const rec = Object.assign(next, {
    createdAt: (prev && prev.createdAt) || now, updatedAt: now,
    history: pushHistory(prev, FIELDS, now),
  });
  await store.setJSON(key, rec);
  return json({ run: withoutHistory(rec) }, 200);
}

async function saveResult(store, p) {
  const run = str(p.run, 64), card = str(p.card, 16);
  if (!RUN_RE.test(run)) return json({ error: 'invalid run' }, 400);
  if (!CARD_RE.test(card)) return json({ error: 'card must be QA-###' }, 400);
  const outcome = p.outcome == null ? '' : String(p.outcome);
  if (!OUTCOMES.includes(outcome)) return json({ error: 'invalid outcome' }, 400);
  const notes = str(p.notes, NOTE_MAX);
  if (NEEDS_NOTES.includes(outcome) && !notes.trim()) return json({ error: 'notes are required for ' + outcome }, 400);
  const shots = Array.isArray(p.shots) ? p.shots.map(String) : [];
  if (shots.length > SHOTS_PER_RESULT) return json({ error: 'at most ' + SHOTS_PER_RESULT + ' screenshots per result' }, 400);
  if (new Set(shots).size !== shots.length || shots.some((s) => !SHOT_RE.test(s))) return json({ error: 'invalid screenshot ids' }, 400);
  if (!(await store.get(P.run + run, { type: 'json' }))) return json({ error: 'run not found' }, 404);
  const metas = await Promise.all(shots.map((s) => store.get(P.shot + s, { type: 'json' })));
  if (metas.some((m, i) => !m || m.run !== run || m.card !== card)) return json({ error: 'a screenshot does not belong to this run and card' }, 400);
  const key = P.result + run + '/' + card;
  const prev = await store.get(key, { type: 'json' });
  const now = new Date().toISOString();
  const next = { run, card, outcome, notes, shots, tester: str(p.tester).trim() };
  const FIELDS = ['outcome', 'notes', 'shots', 'tester'];
  if (prev && !changed(prev, next, FIELDS)) return json({ result: withoutHistory(prev) }, 200);
  const rec = Object.assign(next, { updatedAt: now, history: pushHistory(prev, FIELDS, now) });
  await store.setJSON(key, rec);
  return json({ result: withoutHistory(rec) }, 200);
}

async function saveShot(store, p) {
  const run = str(p.run, 64), card = str(p.card, 16), mime = str(p.mime, 32);
  if (!RUN_RE.test(run)) return json({ error: 'invalid run' }, 400);
  if (!CARD_RE.test(card)) return json({ error: 'card must be QA-###' }, 400);
  if (!MIMES.includes(mime)) return json({ error: 'a screenshot must be JPEG, PNG or WebP' }, 400);
  const data = typeof p.data === 'string' ? p.data.replace(/^data:[^,]*,/, '') : '';
  if (!data || data.length > Math.ceil(SHOT_MAX_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return json({ error: 'invalid or oversized image data' }, 400);
  const buf = Buffer.from(data, 'base64');
  if (buf.length > SHOT_MAX_BYTES) return json({ error: 'a screenshot may be at most 2.5 MB' }, 413);
  if (!magicMatches(buf, mime)) return json({ error: 'the file is not a ' + mime.slice(6).toUpperCase() + ' image' }, 400);
  if (!(await store.get(P.run + run, { type: 'json' }))) return json({ error: 'run not found' }, 404);
  const id = crypto.randomBytes(12).toString('hex');
  const rec = { id, run, card, mime, bytes: buf.length, data: buf.toString('base64'), createdAt: new Date().toISOString() };
  await store.setJSON(P.shot + id, rec);
  return json({ id, bytes: buf.length }, 200);
}

async function saveSubmission(store, p) {
  const run = str(p.run, 64);
  if (!RUN_RE.test(run)) return json({ error: 'invalid run' }, 400);
  const text = str(p.text, TEXT_MAX);
  if (!text.trim()) return json({ error: 'nothing to send' }, 400);
  if (!(await store.get(P.run + run, { type: 'json' }))) return json({ error: 'run not found' }, 404);
  const key = P.submission + run;
  const prev = await store.get(key, { type: 'json' });
  const now = new Date().toISOString();
  const rec = { run, text, updatedAt: now, history: pushHistory(prev, ['text'], now) };
  await store.setJSON(key, rec);
  return json({ submission: withoutHistory(rec) }, 200);
}

async function saveAccounts(store, p) {
  const a = p.accounts;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return json({ error: 'accounts must be an object' }, 400);
  if (typeof a.password !== 'string' || !Array.isArray(a.accounts) || !a.accounts.length) return json({ error: 'accounts needs a password and an accounts list' }, 400);
  if (a.accounts.some((x) => !x || typeof x.handle !== 'string' || typeof x.email !== 'string')) return json({ error: 'every account needs a handle and an email' }, 400);
  const body = JSON.stringify(a);
  if (body.length > ACCOUNTS_MAX) return json({ error: 'accounts too large' }, 413);
  const prev = await store.get(P.accounts, { type: 'json' });
  const now = new Date().toISOString();
  // The previous sign-in details are not kept (they would only be old passwords); the history
  // records when each upload happened and what it was generated from.
  const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
  if (prev) { history.push({ at: prev.uploadedAt, generated: prev.accounts && prev.accounts.generated || '' }); while (history.length > HISTORY_MAX) history.shift(); }
  await store.setJSON(P.accounts, { accounts: a, uploadedAt: now, history });
  return json({ ok: true, uploadedAt: now, count: a.accounts.length }, 200);
}

// ── handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json({}, 200);
  const QA_KEY = process.env.QA_KEY || '';
  const q = event.queryStringParameters || {};
  try {
    if (event.httpMethod === 'GET' && q.status === '1') return json({ keySet: !!QA_KEY }, 200);

    let payload = null;
    if (event.httpMethod === 'POST') {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}');
      try { payload = JSON.parse(raw || '{}'); } catch (e) { return json({ error: 'invalid json body' }, 400); }
      if (!payload || typeof payload !== 'object') return json({ error: 'invalid json body' }, 400);
    } else if (event.httpMethod !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }

    if (!QA_KEY) {
      // Open mode: everything works without a passphrase except the test accounts' sign-in
      // details, which never sit behind a public link.
      const isAccounts = q.accounts === '1' || (payload && payload.kind === 'accounts');
      if (isAccounts) return json({ error: 'passphrase not set' }, 403);
    } else if (!keyMatches(requestKey(event, payload), QA_KEY)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const store = openStore();

    if (event.httpMethod === 'GET') {
      if (q.runs === '1') {
        const runs = Object.values(await readPrefix(store, P.run)).map(withoutHistory);
        runs.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
        return json({ runs }, 200);
      }
      if (q.run) {
        if (!RUN_RE.test(q.run)) return json({ error: 'invalid run' }, 400);
        const run = await store.get(P.run + q.run, { type: 'json' });
        if (!run) return json({ error: 'run not found' }, 404);
        const raw = await readPrefix(store, P.result + q.run + '/');
        const results = {};
        Object.entries(raw).forEach(([card, rec]) => { results[card] = withoutHistory(rec); });
        const sub = await store.get(P.submission + q.run, { type: 'json' });
        return json({ run: withoutHistory(run), results, submission: sub ? withoutHistory(sub) : null }, 200);
      }
      if (q.full === '1') {
        const runs = await readPrefix(store, P.run);
        const flat = await readPrefix(store, P.result);
        const results = {};
        Object.entries(flat).forEach(([k, rec]) => { const [run, card] = k.split('/'); (results[run] = results[run] || {})[card] = rec; });
        const submissions = await readPrefix(store, P.submission);
        const shotsRaw = await readPrefix(store, P.shot);
        const shots = {};
        Object.entries(shotsRaw).forEach(([id, rec]) => { const o = Object.assign({}, rec); delete o.data; shots[id] = o; });
        return json({ runs, results, submissions, shots }, 200);
      }
      if (q.accounts === '1') {
        const rec = await store.get(P.accounts, { type: 'json' });
        if (!rec) return json({ error: 'no sign-in details uploaded yet' }, 404);
        return json({ accounts: rec.accounts, uploadedAt: rec.uploadedAt }, 200);
      }
      if (q.shot) {
        if (!SHOT_RE.test(q.shot)) return json({ error: 'invalid screenshot id' }, 400);
        const rec = await store.get(P.shot + q.shot, { type: 'json' });
        if (!rec) return json({ error: 'screenshot not found' }, 404);
        return json({ id: rec.id, run: rec.run, card: rec.card, mime: rec.mime, bytes: rec.bytes, data: rec.data }, 200);
      }
      return json({ error: 'unknown request' }, 400);
    }

    switch (payload.kind) {
      case 'run': return await saveRun(store, payload.run);
      case 'result': return await saveResult(store, payload);
      case 'shot': return await saveShot(store, payload);
      case 'submission': return await saveSubmission(store, payload);
      case 'accounts': return await saveAccounts(store, payload);
      default: return json({ error: 'unknown kind' }, 400);
    }
  } catch (e) {
    return json({ error: 'store unavailable', detail: String(e && e.message || e) }, 500);
  }
};
