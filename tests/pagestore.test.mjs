// The internal pages' store (Launch List, gate, sign-off book), on the in-memory stand-in for Netlify Blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, '..', 'scripts', 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'pagestore.js');
const stub = require('@netlify/blobs');

function open() {
  stub.__stores.clear();
  delete require.cache[require.resolve(FN)];
  const { handler } = require(FN);
  return async (method, p, body, query) => {
    const res = await handler({ httpMethod: method, path: '/api/store/' + p, headers: {}, body: body ? JSON.stringify(body) : undefined, queryStringParameters: query || {} });
    const parsed = res.isBase64Encoded ? res.body : JSON.parse(res.body);
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };
}

test('set, get, update and delete a document', async () => {
  const call = open();
  assert.equal((await call('PUT', 'gate/gate_replies/2026-11-19', { data: { run: '2026-11-19', sent_count: 1 } })).status, 200);
  let r = await call('GET', 'gate/gate_replies/2026-11-19');
  assert.equal(r.body.exists, true);
  assert.equal(r.body.data.sent_count, 1);
  await call('PATCH', 'gate/gate_replies/2026-11-19', { data: { sent_count: 2 } });
  r = await call('GET', 'gate/gate_replies/2026-11-19');
  assert.deepEqual(r.body.data, { run: '2026-11-19', sent_count: 2 });
  await call('DELETE', 'gate/gate_replies/2026-11-19');
  assert.equal((await call('GET', 'gate/gate_replies/2026-11-19')).body.exists, false);
});

test('an update to a missing document is refused', async () => {
  const call = open();
  assert.equal((await call('PATCH', 'launch-list/items/J-001', { data: { status: 'done' } })).status, 404);
});

test('a collection lists its documents and filters on one field', async () => {
  const call = open();
  await call('PUT', 'signoff/history/a', { data: { markId: 'm1', v: 1 } });
  await call('PUT', 'signoff/history/b', { data: { markId: 'm2', v: 2 } });
  const add = await call('POST', 'signoff/history', { data: { markId: 'm1', v: 3 } });
  assert.match(add.body.id, /^[a-f0-9]{20}$/);
  assert.equal((await call('GET', 'signoff/history')).body.docs.length, 3);
  const m1 = (await call('GET', 'signoff/history', null, { where: 'markId', eq: 'm1' })).body.docs;
  assert.deepEqual(m1.map((d) => d.data.v).sort(), [1, 3]);
});

test('pages are kept apart and an unknown page is refused', async () => {
  const call = open();
  await call('PUT', 'gate/bugs/x', { data: { a: 1 } });
  assert.equal((await call('GET', 'signoff/bugs')).body.docs.length, 0);
  assert.equal((await call('GET', 'process-maps/steps')).status, 404);
  assert.equal((await call('GET', 'approvals/steps')).status, 404);
});

test('bad names and bodies are refused', async () => {
  const call = open();
  assert.equal((await call('PUT', 'gate/Bad-Col/x', { data: {} })).status, 400);
  assert.equal((await call('PUT', 'gate/ok/..', { data: {} })).status, 400);
  assert.equal((await call('PUT', 'gate/ok/x', { data: [1, 2] })).status, 400);
});

test('a batch is checked whole before anything is written', async () => {
  const call = open();
  const bad = await call('POST', 'launch-list/_batch', { ops: [{ op: 'set', collection: 'items', doc: 'J-1', data: { a: 1 } }, { op: 'nope', collection: 'items', doc: 'J-2' }] });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', 'launch-list/items')).body.docs.length, 0);
  const ok = await call('POST', 'launch-list/_batch', { ops: [{ op: 'set', collection: 'items', doc: 'J-1', data: { a: 1 } }, { op: 'set', collection: 'pages', doc: 'all', data: { n: 2 } }] });
  assert.equal(ok.body.results.length, 2);
  assert.deepEqual((await call('GET', 'launch-list/_collections')).body.collections, ['items', 'pages']);
});

test('an overwrite keeps the previous version', async () => {
  const call = open();
  await call('PUT', 'gate/g/r', { data: { v: 1 } });
  await call('PUT', 'gate/g/r', { data: { v: 2 } });
  const store = stub.__stores.get('hoahx-pagestore');
  const prev = [...store.keys()].filter((k) => k.startsWith('prev/gate/g/r/'));
  assert.equal(prev.length, 1);
  assert.equal(JSON.parse(store.get(prev[0])).data.v, 1);
});

test('a screenshot is stored, served and deleted', async () => {
  const call = open();
  const png = Buffer.from('fake-png').toString('base64');
  const up = await call('POST', 'signoff/_assets', { name: 'a.png', type: 'image/png', base64: png });
  assert.equal(up.status, 200);
  assert.equal(up.body.url, '/api/store/signoff/_assets/' + up.body.id);
  const got = await call('GET', 'signoff/_assets/' + up.body.id);
  assert.equal(got.headers['Content-Type'], 'image/png');
  assert.equal(got.body, png);
  assert.equal((await call('POST', 'signoff/_assets', { type: 'text/html', base64: png })).status, 415);
  await call('DELETE', 'signoff/_assets/' + up.body.id);
  assert.equal((await call('GET', 'signoff/_assets/' + up.body.id)).status, 404);
});

test('every answer says noindex', async () => {
  const call = open();
  assert.match((await call('GET', 'gate/x')).headers['X-Robots-Tag'], /noindex/);
});

test('the Process Maps and design approvals pages are never on this site', () => {
  const root = path.join(here, '..');
  const banned = ['WRYBU1D1p351skxVdHJot3', 'Py5FBSB66okf44U6miv2AM', 'HOA HX Process Maps', 'Design branch approvals'];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const dir of ['go-live', 'netlify']) {
    for (const f of walk(path.join(root, dir))) {
      if (!/\.(html|js|json|css|md|mjs)$/.test(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      for (const b of banned) assert.ok(!text.includes(b), `${path.relative(root, f)} names ${b}`);
    }
  }
});

test('a pinned write applies only to the version it read', async () => {
  const call = open();
  const made = await call('PUT', 'launch-list/items/J-9', { data: { title: 'x' }, ifVersion: null });
  assert.equal(made.status, 200);
  assert.equal((await call('PUT', 'launch-list/items/J-9', { data: { title: 'again' }, ifVersion: null })).status, 409);
  const v1 = made.body.version;
  const ok = await call('PATCH', 'launch-list/items/J-9', { data: { status: 'open' }, ifVersion: v1 });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.version > v1);
  const stale = await call('PATCH', 'launch-list/items/J-9', { data: { status: 'done' }, ifVersion: v1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.current, ok.body.version);
  const r = await call('POST', 'launch-list/_batch', { ops: [{ op: 'update', collection: 'items', doc: 'J-9', data: { a: 1 }, ifVersion: v1 }] });
  assert.equal(r.body.results[0].error, 'version conflict');
});
