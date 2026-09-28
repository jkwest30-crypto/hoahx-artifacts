// The hub's live list (netlify/functions/hub.js), with Google's answers faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'hub.js');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const file = (id, name, mimeType, more = {}) => ({ id, name, mimeType, modifiedTime: '2026-09-20T10:00:00.000Z', owners: [{ displayName: 'dan' }], ...more });

const DRIVE = {
  top: [file('sec-product', 'Product', FOLDER), file('sec-ux', 'UX', FOLDER), file('links', 'Hub links', SHEET), file('howto', 'How to add to the hub', DOC)],
  'sec-product': [file('grp-pricing', 'Pricing', FOLDER), file('grp-empty', 'Market', FOLDER), file('loose', 'Roadmap.pdf', 'application/pdf')],
  'sec-ux': [],
  'grp-pricing': [
    file('p1', 'Pricing model.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { modifiedTime: '2026-09-27T09:00:00.000Z', description: 'Prices  by community size.' }),
    file('p2', 'Plans', DOC, { owners: [{ displayName: 'jkwest30' }] }),
    file('s1', 'Competitor prices', SHORTCUT, { shortcutDetails: { targetId: 'far-away', targetMimeType: SHEET } }),
  ],
  'grp-empty': [],
};
const CSV = [
  'Section,Group,Title,Link,Description',
  'product,pricing,Public price page,https://hoahx.com/pricing,"What a visitor sees, today"',
  'UX,Inspiration,Mercury,https://mercury.com,',
  'Marketing,Ads,Campaign board,https://example.com/board,',
  'Product,Pricing,No link here,notalink,',
  ',,,,',
].join('\r\n');

function open({ env = { HUB_DRIVE_FOLDER: 'top', HUB_GOOGLE_EMAIL: 'hub@example.iam.gserviceaccount.com', HUB_GOOGLE_KEY: privateKey.replace(/\n/g, '\\n') }, drive = DRIVE, csv = CSV, fail = null } = {}) {
  for (const k of ['HUB_DRIVE_FOLDER', 'HUB_GOOGLE_EMAIL', 'HUB_GOOGLE_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const answer = (status, body, text) => ({ ok: status < 300, status, json: async () => body, text: async () => text });
    if (fail && fail(String(url))) return answer(403, { error: 'no' }, 'no');
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return answer(200, { access_token: 'tok' });
    const u = new URL(url);
    if (u.pathname.endsWith('/export')) return answer(200, null, csv);
    const parent = /^'([^']+)' in parents/.exec(u.searchParams.get('q'))[1];
    return answer(200, { files: drive[parent] || [] });
  };
  delete require.cache[require.resolve(FN)];
  const fn = require(FN);
  const get = async (method = 'GET') => {
    const res = await fn.handler({ httpMethod: method, headers: {}, queryStringParameters: {} });
    return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
  };
  return { fn, get, calls };
}

test('without its three settings the list says so and asks Google nothing', async () => {
  const { get, calls } = open({ env: { HUB_DRIVE_FOLDER: 'top' } });
  const res = await get();
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { configured: false });
  assert.equal(calls.length, 0);
});

test('folders become sections and groups, files become rows', async () => {
  const { get } = open();
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sections.map((s) => s.name), ['Product', 'UX']);
  const product = res.body.sections[0];
  assert.equal(product.folder, 'https://drive.google.com/drive/folders/sec-product');
  assert.deepEqual(product.groups.map((g) => g.name), ['Pricing', 'Market', 'Other']);
  const pricing = product.groups[0];
  assert.deepEqual(pricing.rows[0], { k: 'sheet', t: 'Pricing model', d: 'Prices by community size.', href: 'https://drive.google.com/file/d/p1/view', by: 'Dan', date: '2026-09-27' });
  assert.deepEqual(pricing.rows.find((r) => r.t === 'Plans'), { k: 'doc', t: 'Plans', d: '', href: 'https://docs.google.com/document/d/p2/edit', by: 'Jacob', date: '2026-09-20' });
  assert.deepEqual(product.groups[1].rows, [], 'an empty folder is an empty group, so the page shows where a document will go');
  assert.deepEqual(product.groups[2].rows.map((r) => [r.k, r.t]), [['pdf', 'Roadmap']], 'a file beside the group folders lands in Other');
});

test('a shortcut opens the document it points at, and claims no owner or date', async () => {
  const { get } = open();
  const row = (await get()).body.sections[0].groups[0].rows.find((r) => r.t === 'Competitor prices');
  assert.deepEqual(row, { k: 'sheet', t: 'Competitor prices', d: '', href: 'https://docs.google.com/spreadsheets/d/far-away/edit' });
});

test('the hub\'s own files beside the section folders are never listed', async () => {
  const { get } = open();
  const text = JSON.stringify((await get()).body.sections);
  assert.ok(!text.includes('How to add to the hub'));
  assert.ok(!text.includes('/spreadsheets/d/links/'));
});

test('the links sheet adds web addresses, makes a new group, and reports what it could not place', async () => {
  const { get } = open();
  const body = (await get()).body;
  const pricing = body.sections[0].groups[0];
  assert.deepEqual(pricing.rows.find((r) => r.t === 'Public price page'), { k: 'page', t: 'Public price page', d: 'What a visitor sees, today', href: 'https://hoahx.com/pricing' });
  const ux = body.sections[1];
  assert.deepEqual(ux.groups, [{ name: 'Inspiration', folder: null, rows: [{ k: 'page', t: 'Mercury', d: '', href: 'https://mercury.com' }] }]);
  assert.equal(body.skipped.length, 2);
  assert.match(body.skipped.find((s) => s.line === 5).why, /https:\/\//);
  assert.match(body.skipped.find((s) => s.line === null).why, /"Marketing", which is not a folder/);
});

test('a sheet without its column names is refused whole, with the reason', () => {
  const { fn } = open();
  const read = fn.readLinks('Name,URL\nPrices,https://hoahx.com/pricing\n');
  assert.deepEqual(read.links, []);
  assert.match(read.skipped[0].why, /missing: section, group, title, link/);
});

test('a link that is not https never reaches the page', () => {
  const { fn } = open();
  for (const bad of ['http://hoahx.com', 'javascript:alert(1)', 'https://hoahx.com/a b', 'hoahx.com']) {
    const read = fn.readLinks(`Section,Group,Title,Link\nProduct,Pricing,X,${bad}\n`);
    assert.deepEqual(read.links, [], bad);
    assert.equal(read.skipped.length, 1, bad);
  }
});

test('cells with commas, quotes and line breaks are read whole', () => {
  const { fn } = open();
  assert.deepEqual(fn.parseCsv('a,"b, c","d ""e"""\r\n"two\nlines",,z'), [['a', 'b, c', 'd "e"'], ['two\nlines', '', 'z']]);
});

test('kinds by file type', () => {
  const { fn } = open();
  assert.equal(fn.kindOf('application/vnd.google-apps.presentation'), 'slides');
  assert.equal(fn.kindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'doc');
  assert.equal(fn.kindOf('video/mp4'), 'video');
  assert.equal(fn.kindOf('image/png'), 'file');
  assert.equal(fn.kindOf(FOLDER), 'folder');
});

test('the list is kept for five minutes, so a busy page does not ask Google each time', async () => {
  const { get, calls } = open();
  await get();
  const first = calls.length;
  assert.ok(first > 0);
  const again = await get();
  assert.equal(calls.length, first);
  assert.equal(again.headers['Cache-Control'], 'public, max-age=60');
});

test('when Google refuses, the answer says so and carries neither the key nor Google\'s words', async () => {
  const { get } = open({ fail: (url) => url.includes('/drive/v3/files') });
  const res = await get();
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'The Drive folder could not be read');
  assert.match(res.body.detail, /Google answered 403/);
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE KEY'));
});

test('a key that is not a key is named as the problem', async () => {
  const { get } = open({ env: { HUB_DRIVE_FOLDER: 'top', HUB_GOOGLE_EMAIL: 'hub@example.iam.gserviceaccount.com', HUB_GOOGLE_KEY: 'pasted the wrong thing' } });
  const res = await get();
  assert.equal(res.status, 502);
  assert.match(res.body.detail, /HUB_GOOGLE_KEY is not a private key/);
});

test('nothing but a read is accepted', async () => {
  const { get } = open();
  assert.equal((await get('POST')).status, 405);
});

test('the account is asked for read-only access and nothing more', async () => {
  const { get, calls } = open();
  await get();
  const assertion = /assertion=([^&]+)/.exec(calls[0].init.body)[1];
  const claim = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.ok(calls.every((c) => !c.init.method || c.url.startsWith('https://oauth2.googleapis.com/token')), 'every call to Drive is a GET');
});
