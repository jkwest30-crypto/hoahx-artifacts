// The What's in the Build sign-off store, on the in-memory stand-in for Netlify Blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, '..', 'scripts', 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'signoffs.js');
const stub = require('@netlify/blobs');

function open({ ownerKey = '' } = {}) {
  stub.__stores.clear();
  process.env.DECISION_EDIT_KEY = ownerKey;
  delete require.cache[require.resolve(FN)];
  const { handler } = require(FN);
  return async (method, { body, headers = {} } = {}) => {
    const res = await handler({ httpMethod: method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
}

test('two people sign off the same line; each keeps their own record', async () => {
  const call = open();
  assert.equal((await call('POST', { body: { action: 'signoff', line: '1.1', by: 'Rustin', signed: true } })).status, 200);
  assert.equal((await call('POST', { body: { action: 'signoff', line: '1.1', by: 'Dan', signed: true } })).status, 200);
  const { records } = (await call('GET')).body;
  assert.deepEqual(records.map((r) => r.by).sort(), ['Dan', 'Rustin']);
  assert.ok(records.every((r) => r.signed && r.signedAt));
});

test('a sign-off and a note live on one record, and each can be taken back', async () => {
  const call = open();
  await call('POST', { body: { action: 'signoff', line: '17.8', by: 'Dan', signed: true } });
  await call('POST', { body: { action: 'note', line: '17.8', by: 'Dan', text: '  Check the wording  ' } });
  let [r] = (await call('GET')).body.records;
  assert.equal(r.note, 'Check the wording');
  assert.equal(r.signed, true);
  await call('POST', { body: { action: 'signoff', line: '17.8', by: 'Dan', signed: false } });
  [r] = (await call('GET')).body.records;
  assert.equal(r.signed, false);
  assert.equal(r.signedAt, '');
  assert.equal(r.note, 'Check the wording');
  await call('POST', { body: { action: 'note', line: '17.8', by: 'Dan', text: '' } });
  assert.deepEqual((await call('GET')).body.records, []);
});

test('the history survives a take-back, and the reply never carries it', async () => {
  const call = open();
  await call('POST', { body: { action: 'note', line: '2.3', by: 'Rustin', text: 'First' } });
  const res = await call('POST', { body: { action: 'note', line: '2.3', by: 'Rustin', text: '' } });
  assert.equal(res.body.record.history, undefined);
  const saved = JSON.parse(stub.__stores.get('hoahx-build-signoffs').get('line/2.3/rustin'));
  assert.deepEqual(saved.history.map((h) => h.note), ['First', '']);
});

test('the same name in another case is the same person', async () => {
  const call = open();
  await call('POST', { body: { action: 'signoff', line: '1.2', by: 'Rustin', signed: true } });
  await call('POST', { body: { action: 'signoff', line: '1.2', by: 'rustin ', signed: false } });
  assert.deepEqual((await call('GET')).body.records, []);
});

test('bad requests are refused and save nothing', async () => {
  const call = open();
  for (const [body, error] of [
    [{ action: 'signoff', line: '30.1', by: 'Dan', signed: true }, 'invalid line'],
    [{ action: 'signoff', line: '1.1/x', by: 'Dan', signed: true }, 'invalid line'],
    [{ action: 'signoff', line: '1.1', by: '  ', signed: true }, 'a name is required'],
    [{ action: 'signoff', line: '1.1', by: 'Dan', signed: 'yes' }, 'signed must be true or false'],
    [{ action: 'delete', line: '1.1', by: 'Dan' }, 'invalid action'],
  ]) {
    const r = await call('POST', { body });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, error);
  }
  assert.deepEqual((await call('GET')).body.records, []);
});

test('the owners\' passphrase gates reading and writing when it is set', async () => {
  const call = open({ ownerKey: 'ok' });
  assert.equal((await call('GET')).status, 401);
  assert.equal((await call('POST', { body: { action: 'signoff', line: '1.1', by: 'Dan', signed: true } })).status, 401);
  assert.equal((await call('GET', { headers: { 'x-edit-key': 'ok' } })).status, 200);
});
