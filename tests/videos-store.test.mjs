// The video review store, on the in-memory stand-in for Netlify Blobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, '..', 'scripts', 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const FN = path.join(here, '..', 'netlify', 'functions', 'videos.js');
const stub = require('@netlify/blobs');

function open({ jacobKey = 'jk', ownerKey = '' } = {}) {
  stub.__stores.clear();
  process.env.VIDEO_REVIEW_KEY = jacobKey; process.env.DECISION_EDIT_KEY = ownerKey;
  delete require.cache[require.resolve(FN)];
  const { handler } = require(FN);
  const call = async (method, { query = {}, body, headers = {} } = {}) => {
    const res = await handler({ httpMethod: method, headers, queryStringParameters: query, body: body ? JSON.stringify(body) : undefined });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return { call, J: { 'x-review-key': jacobKey } };
}
const PREVIEW = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const FULL = '/9j/4AAQSkZJRgABAQAAAQABAAD';

test('owners can answer and leave a note; they never see Jacob\'s side', async () => {
  const { call, J } = open();
  assert.equal((await call('POST', { body: { action: 'status', side: 'owners', vid: '01', status: 'approved', commit: 'aaaaaaa', by: 'Rustin' } })).status, 200);
  const n = await call('POST', { body: { action: 'note', side: 'owners', vid: '02', commit: 'aaaaaaa', by: 'Dan', text: 'At 0:31 the caption covers the tab.', images: [{ preview: PREVIEW, w: 1600, h: 900 }] } });
  assert.equal(n.status, 200);
  assert.equal(n.body.ref, 'V02-N001');
  await call('POST', { headers: J, body: { action: 'note', side: 'jacob', vid: '02', commit: 'aaaaaaa', text: 'Mine' } });
  await call('POST', { headers: J, body: { action: 'status', side: 'jacob', vid: '02', status: 'fix', commit: 'aaaaaaa' } });
  const pub = (await call('GET')).body;
  assert.equal(pub.owners['01'].status, 'approved');
  assert.equal(pub.jacob, undefined);
  assert.deepEqual(pub.notes.map((x) => x.ref), ['V02-N001']);
  const mine = (await call('GET', { query: { side: 'jacob' }, headers: J })).body;
  assert.deepEqual(mine.notes.map((x) => x.ref), ['V02-N001', 'V02-N002']);
  assert.equal(mine.jacob['02'].status, 'fix');
});

test('Jacob\'s side needs his passphrase, and is closed when none is set', async () => {
  let { call } = open();
  assert.equal((await call('GET', { query: { side: 'jacob' } })).status, 401);
  assert.equal((await call('POST', { body: { action: 'status', side: 'jacob', vid: '01', status: 'approved', commit: 'aaaaaaa' } })).status, 401);
  ({ call } = open({ jacobKey: '' }));
  const r = await call('GET', { query: { side: 'jacob' }, headers: { 'x-review-key': '' } });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /VIDEO_REVIEW_KEY/);
});

test('the owners\' passphrase gates their side when it is set', async () => {
  const { call, J } = open({ ownerKey: 'ok' });
  assert.equal((await call('GET')).status, 401);
  assert.equal((await call('GET', { headers: { 'x-edit-key': 'ok' } })).status, 200);
  assert.equal((await call('GET', { headers: J })).status, 200);
});

test('validation: side, status, commit, name, screenshots', async () => {
  const { call } = open();
  const bad = async (body) => (await call('POST', { body: { action: 'note', side: 'owners', vid: '01', commit: 'aaaaaaa', by: 'Dan', text: 'x', ...body } })).body.error;
  assert.match(await bad({ by: '' }), /name/);
  assert.match(await bad({ text: '', images: [] }), /words or a screenshot/);
  assert.match(await bad({ vid: '1' }), /vid/);
  assert.match(await bad({ commit: 'nope' }), /commit/);
  assert.match(await bad({ images: [{ preview: 'data:image/png;base64,AAAA', w: 10, h: 10 }] }), /JPEG/);
  assert.match(await bad({ images: Array(7).fill({ preview: PREVIEW, w: 10, h: 10 }) }), /at most 6/);
  const st = await call('POST', { body: { action: 'status', side: 'owners', vid: '01', status: 'fix', commit: 'aaaaaaa' } });
  assert.match(st.body.error, /status/);
});

test('a full-size screenshot: uploaded by its side, fetched by Jacob, dropped only when moved', async () => {
  const { call, J } = open();
  const n = (await call('POST', { body: { action: 'note', side: 'owners', vid: '05', commit: 'aaaaaaa', by: 'Dan', text: '', images: [{ preview: PREVIEW, w: 1600, h: 900 }] } })).body;
  assert.equal((await call('POST', { body: { action: 'image', ref: n.ref, i: 1, data: 'not-a-jpeg' } })).status, 400);
  const up = await call('POST', { body: { action: 'image', ref: n.ref, i: 1, data: FULL } });
  assert.equal(up.body.images[0].full, true);
  assert.equal((await call('GET', { query: { side: 'jacob', image: `${n.ref}-1` } })).status, 401);
  const got = await call('GET', { query: { side: 'jacob', image: `${n.ref}-1` }, headers: J });
  assert.equal(got.body.data, FULL);
  assert.equal((await call('POST', { body: { action: 'moved', ref: n.ref, i: 1, drive: { id: '1abcdefghijk', name: 'x.jpg' } } })).status, 401);
  const mv = await call('POST', { headers: J, body: { action: 'moved', ref: n.ref, i: 1, drive: { id: '1abcdefghijk', name: 'V05-N001-1.jpg' } } });
  assert.equal(mv.body.images[0].drive.id, '1abcdefghijk');
  assert.equal(mv.body.images[0].full, false);
  assert.ok(mv.body.images[0].preview, 'the preview stays');
  assert.equal((await call('GET', { query: { side: 'jacob', image: `${n.ref}-1` }, headers: J })).status, 404);
  assert.equal((await call('POST', { body: { action: 'image', ref: n.ref, i: 1, data: FULL } })).status, 409);
});

test('note numbers: per video, across both sides, never reused', async () => {
  const { call, J } = open();
  const note = (side, vid, headers) => call('POST', { headers, body: { action: 'note', side, vid, commit: 'aaaaaaa', by: 'Dan', text: 't' } });
  assert.equal((await note('owners', '03')).body.ref, 'V03-N001');
  assert.equal((await note('jacob', '03', J)).body.ref, 'V03-N002');
  assert.equal((await note('owners', '04')).body.ref, 'V04-N001');
});

test('watched: each person ticks a product video on their own record; unticking takes it off', async () => {
  const { call } = open();
  const tick = (item, who, watched) => call('POST', { body: { action: 'watched', item, who, watched } });
  assert.equal((await tick('f07', 'Dan', true)).status, 200);
  assert.equal((await tick('f07', 'Tenyson', true)).status, 200);
  assert.equal((await tick('sA1', 'Rustin', true)).status, 200);
  let pub = (await call('GET')).body;
  assert.deepEqual(Object.keys(pub.watched.f07).sort(), ['Dan', 'Tenyson']);
  assert.deepEqual(Object.keys(pub.watched.sA1), ['Rustin']);
  await tick('f07', 'Dan', false);
  pub = (await call('GET')).body;
  assert.deepEqual(Object.keys(pub.watched.f07), ['Tenyson']);
  const rec = await stub.getStore('hoahx-video-review').get('watched/f07/Dan', { type: 'json' });
  assert.equal(rec.watched, false);
  assert.equal(rec.history.at(-1).watched, true);
});

test('watched: validation and the owners\' passphrase', async () => {
  let { call } = open();
  const bad = async (body) => (await call('POST', { body: { action: 'watched', item: 'f07', who: 'Dan', watched: true, ...body } })).body.error;
  assert.match(await bad({ item: '7' }), /item/);
  assert.match(await bad({ item: 'sa1' }), /item/);
  assert.match(await bad({ who: 'Jacob' }), /Dan, Rustin or Tenyson/);
  assert.match(await bad({ watched: 'yes' }), /true or false/);
  ({ call } = open({ ownerKey: 'ok' }));
  assert.equal((await call('POST', { body: { action: 'watched', item: 'f07', who: 'Dan', watched: true } })).status, 401);
  assert.equal((await call('POST', { headers: { 'x-edit-key': 'ok' }, body: { action: 'watched', item: 'f07', who: 'Dan', watched: true } })).status, 200);
});
