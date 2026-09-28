// The shared store's validation and rules, on the in-memory stand-in for Netlify Blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, '..', 'scripts', 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'answers.js');
const stub = require('@netlify/blobs');

/** A fresh copy of the function on an empty store, with or without the passphrase set. */
function open(key) {
  stub.__stores.clear();
  delete require.cache[require.resolve(FN)];
  if (key) process.env.DECISION_EDIT_KEY = key; else delete process.env.DECISION_EDIT_KEY;
  const fn = require(FN);
  delete process.env.DECISION_EDIT_KEY;
  const call = async (method, { body, query, headers } = {}) => {
    const res = await fn.handler({ httpMethod: method, headers: headers || {}, body: body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body), queryStringParameters: query || {} });
    return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) };
  };
  return { fn, get: (o) => call('GET', o), post: (body, o) => call('POST', Object.assign({ body }, o)), call };
}

test('validation: a question takes Agree, Change or Discuss, or nothing', () => {
  const { fn } = open();
  for (const v of ['agree', 'change', 'discuss', '']) assert.equal(fn.validate({ id: 'A01-1', v }).v, v);
  for (const v of ['yes', 'keep', 'Agree', 'no']) assert.deepEqual(fn.validate({ id: 'A01-1', v }), { error: 'invalid v' });
  assert.equal(fn.validate({ id: 'A28-12', v: 'discuss' }).id, 'A28-12');
});

test('validation: a screen takes Signed off, Change or Discuss; Agree is not a screen answer', () => {
  const { fn } = open();
  for (const v of ['yes', 'change', 'discuss', '']) assert.equal(fn.validate({ id: 'S-B2', v }).v, v);
  assert.deepEqual(fn.validate({ id: 'S-B2', v: 'agree' }), { error: 'invalid v' });
});

test('validation: a card-level id from the earlier page is still accepted, without Discuss', () => {
  const { fn } = open();
  assert.equal(fn.validate({ id: 'A01', v: 'change' }).v, 'change');
  assert.deepEqual(fn.validate({ id: 'A01', v: 'discuss' }), { error: 'invalid v' });
  assert.equal(fn.validate({ id: '_submission', v: 'agree', n: 'summary' }).n, 'summary');
});

test('validation: the id, the note and the name are bounded', () => {
  const { fn } = open();
  for (const id of [undefined, '', 7, '../x', 'A01 1', 'x'.repeat(40), '-A01']) assert.deepEqual(fn.validate({ id, v: '' }), { error: 'missing or invalid id' });
  for (const p of [null, [], 'x', 3]) assert.deepEqual(fn.validate(p), { error: 'invalid json body' });
  assert.equal(fn.validate({ id: 'A01-1', v: 'change', n: 'x'.repeat(30000) }).n.length, 20000);
  assert.equal(fn.validate({ id: 'S-A1', v: 'yes', by: '  Rustin\u0007 ' + 'x'.repeat(100) }).by.length, 60);
  assert.equal(fn.validate({ id: 'S-A1', v: 'yes', by: ' Dan\n' }).by, 'Dan');
});

test('store: an answer is saved, read back, and shared', async () => {
  const s = open();
  const saved = await s.post({ id: 'A01-3', v: 'change', n: 'Off by default.' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.id, 'A01-3');
  await s.post({ id: 'S-B2', v: 'discuss', n: 'Working days?', by: 'Rustin' });
  const live = (await s.get()).json;
  assert.deepEqual(Object.keys(live).sort(), ['A01-3', 'S-B2']);
  assert.equal(live['A01-3'].v, 'change');
  assert.equal(live['A01-3'].n, 'Off by default.');
  assert.equal(live['S-B2'].by, 'Rustin');
  assert.equal(live['A01-3'].history, undefined, 'the live view carries no history');
});

test('store: a refused answer saves nothing', async () => {
  const s = open();
  assert.equal((await s.post({ id: 'A01-1', v: 'yes' })).status, 400);
  assert.equal((await s.post({ id: 'S-A1', v: 'agree' })).status, 400);
  assert.equal((await s.post('{not json')).status, 400);
  assert.deepEqual((await s.get({ query: { full: '1' } })).json, {});
});

test('store: every earlier answer is kept, and clearing deletes nothing', async () => {
  const s = open();
  await s.post({ id: 'A02-1', v: 'agree' });
  await s.post({ id: 'A02-1', v: 'discuss', n: 'On the next call.' });
  await s.post({ id: 'A02-1', v: '' });
  assert.deepEqual((await s.get()).json, {}, 'a cleared answer is not a live answer');
  const full = (await s.get({ query: { full: '1' } })).json['A02-1'];
  assert.equal(full.v, '');
  assert.deepEqual(full.history.map((h) => [h.v, h.n]), [['agree', ''], ['discuss', 'On the next call.']]);
});

test('store: saving the same answer twice adds no history', async () => {
  const s = open();
  await s.post({ id: 'A02-2', v: 'agree' });
  await s.post({ id: 'A02-2', v: 'agree' });
  assert.deepEqual((await s.get({ query: { full: '1' } })).json['A02-2'].history, []);
});

test('store: history is capped at forty', async () => {
  const s = open();
  for (let i = 0; i < 45; i += 1) await s.post({ id: 'A03-1', v: 'change', n: 'draft ' + i });
  const full = (await s.get({ query: { full: '1' } })).json['A03-1'];
  assert.equal(full.history.length, 40);
  assert.equal(full.n, 'draft 44');
  assert.equal(full.history[39].n, 'draft 43');
});

test('passphrase: with none set, no request is refused', async () => {
  const s = open();
  assert.equal((await s.get()).status, 200);
});

test('passphrase: when set, every request must carry it', async () => {
  const s = open('owners-only');
  assert.equal((await s.get()).status, 401);
  assert.equal((await s.post({ id: 'A01-1', v: 'agree' })).status, 401);
  assert.equal((await s.post({ id: 'A01-1', v: 'agree', key: 'wrong' })).status, 401);
  assert.equal((await s.post({ id: 'A01-1', v: 'agree', key: 'owners-only' })).status, 200);
  assert.equal((await s.get({ headers: { 'x-edit-key': 'owners-only' } })).status, 200);
  assert.equal((await s.get({ query: { key: 'owners-only' } })).json['A01-1'].v, 'agree');
});

test('other origins: the test site and a local server may read and save; nobody else', async () => {
  const s = open('owners-only');
  for (const origin of ['https://hoahx-staging.web.app', 'https://hoahx-staging.firebaseapp.com', 'http://localhost:5185', 'http://127.0.0.1:8789']) {
    const res = await s.get({ headers: { origin } });
    assert.equal(res.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(res.status, 401, 'a refusal carries the headers too, so the other page can ask for the passphrase');
  }
  for (const origin of ['https://example.com', 'https://hoahx-staging.web.app.evil.test', 'http://localhost', '']) {
    assert.equal((await s.get({ headers: { origin } })).headers['Access-Control-Allow-Origin'], undefined);
  }
  assert.equal((await s.call('OPTIONS', { headers: { origin: 'https://hoahx-staging.web.app' } })).status, 200);
});

test('anything but GET, POST and OPTIONS is refused', async () => {
  const s = open();
  assert.equal((await s.call('DELETE')).status, 405);
  assert.equal((await s.call('PUT', { body: { id: 'A01-1', v: 'agree' } })).status, 405);
});
