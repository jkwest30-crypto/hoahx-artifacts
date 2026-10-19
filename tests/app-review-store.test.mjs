// The App Store listing review store, on the in-memory stand-in for Netlify Blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, '..', 'scripts', 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'appreview.js');
const stub = require('@netlify/blobs');

function open(ownerKey = '') {
  stub.__stores.clear();
  process.env.DECISION_EDIT_KEY = ownerKey;
  delete require.cache[require.resolve(FN)];
  const { handler } = require(FN);
  return async (method, { query = {}, body, headers = {} } = {}) => {
    const res = await handler({ httpMethod: method, headers, queryStringParameters: query, body: body ? JSON.stringify(body) : undefined });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
}
const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2';

test('an owner agrees, another changes with words; the history is kept', async () => {
  const call = open();
  assert.equal((await call('POST', { body: { action: 'answer', q: 'Q01', who: 'Tenyson', v: 'agree' } })).status, 200);
  await call('POST', { body: { action: 'answer', q: 'Q01', who: 'Dan', v: 'change', n: 'Productivity' } });
  await call('POST', { body: { action: 'answer', q: 'Q01', who: 'Dan', v: 'change', n: 'Productivity, then Lifestyle' } });
  const s = (await call('GET')).body;
  assert.equal(s.answers['Q01.Tenyson'].v, 'agree');
  assert.equal(s.answers['Q01.Dan'].n, 'Productivity, then Lifestyle');
  assert.equal(s.answers['Q01.Dan'].history.length, 1);
});

test('bad answers are refused', async () => {
  const call = open();
  for (const b of [{ q: 'Q11', who: 'Dan', v: 'agree' }, { q: 'Q01', who: 'Eve', v: 'agree' }, { q: 'Q01', who: 'Dan', v: 'discuss' }]) {
    assert.equal((await call('POST', { body: { action: 'answer', ...b } })).status, 400);
  }
});

test('"Jacob provides this one" is saved per owner and can be cleared', async () => {
  const call = open();
  await call('POST', { body: { action: 'shot', slot: 'iphone-3', who: 'Rustin', v: 'jacob' } });
  assert.equal((await call('GET')).body.shots['iphone-3.Rustin'].v, 'jacob');
  assert.equal((await call('POST', { body: { action: 'shot', slot: 'ipad-4', who: 'Rustin', v: 'jacob' } })).status, 400);
  await call('POST', { body: { action: 'shot', slot: 'iphone-3', who: 'Rustin', v: '' } });
  assert.equal((await call('GET')).body.shots['iphone-3.Rustin'].v, '');
});

test('the iPad slots follow the shot list (1, 2, 3, 6, 7)', async () => {
  const call = open();
  for (const slot of ['ipad-1', 'ipad-2', 'ipad-3', 'ipad-6', 'ipad-7']) {
    assert.equal((await call('POST', { body: { action: 'shot', slot, who: 'Dan', v: 'jacob' } })).status, 200);
  }
  for (const slot of ['ipad-5', 'ipad-9']) {
    assert.equal((await call('POST', { body: { action: 'shot', slot, who: 'Dan', v: 'jacob' } })).status, 400);
  }
});

test('an upload round-trips in chunks', async () => {
  const call = open();
  const a = Buffer.from('PNGDATA-ONE').toString('base64');
  const b = Buffer.from('PNGDATA-TWO').toString('base64');
  assert.equal((await call('POST', { body: { action: 'file-done', id: ID, who: 'Dan', slot: 'extra', name: 'a.png', type: 'image/png', size: 22, chunks: 2 } })).status, 400, 'not finished before its chunks arrive');
  await call('POST', { body: { action: 'file-chunk', id: ID, i: 0, data: a } });
  await call('POST', { body: { action: 'file-chunk', id: ID, i: 1, data: b } });
  const done = await call('POST', { body: { action: 'file-done', id: ID, who: 'Dan', slot: 'extra', name: 'a.png', type: 'image/png', size: 22, chunks: 2 } });
  assert.equal(done.status, 200);
  const list = (await call('GET')).body.files;
  assert.equal(list.length, 1);
  assert.equal(list[0].slot, 'extra');
  const c1 = await call('GET', { query: { file: ID, chunk: '1' } });
  assert.equal(Buffer.from(c1.body.data, 'base64').toString(), 'PNGDATA-TWO');
});

test('Jacob may upload, but never answers or chooses for an owner', async () => {
  const call = open();
  await call('POST', { body: { action: 'file-chunk', id: ID, i: 0, data: 'QQ==' } });
  assert.equal((await call('POST', { body: { action: 'file-done', id: ID, who: 'Jacob', slot: 'iphone-1', name: 'a.png', type: 'image/png', size: 1, chunks: 1 } })).status, 200);
  assert.equal((await call('GET')).body.files[0].who, 'Jacob');
  assert.equal((await call('POST', { body: { action: 'answer', q: 'Q01', who: 'Jacob', v: 'agree' } })).status, 400);
  assert.equal((await call('POST', { body: { action: 'shot', slot: 'iphone-1', who: 'Jacob', v: 'jacob' } })).status, 400);
  assert.equal((await call('POST', { body: { action: 'file-done', id: ID, who: 'Eve', slot: 'extra', name: 'a.png', type: 'image/png', size: 1, chunks: 1 } })).status, 400);
});

test('only PNG or JPEG, and a real slot', async () => {
  const call = open();
  await call('POST', { body: { action: 'file-chunk', id: ID, i: 0, data: 'QQ==' } });
  assert.equal((await call('POST', { body: { action: 'file-done', id: ID, who: 'Dan', slot: 'extra', name: 'a.exe', type: 'application/x-msdownload', size: 1, chunks: 1 } })).status, 400);
  assert.equal((await call('POST', { body: { action: 'file-done', id: ID, who: 'Dan', slot: 'ipad-4', name: 'a.png', type: 'image/png', size: 1, chunks: 1 } })).status, 400);
});

test('the passphrase gates every request when one is set', async () => {
  const call = open('secret');
  assert.equal((await call('GET')).status, 401);
  assert.equal((await call('GET', { headers: { 'x-edit-key': 'secret' } })).status, 200);
});
