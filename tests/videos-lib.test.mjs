// The video review's publish rules, guards and file names. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnersData, findForbidden, guardOwnersData, noteRef, planPublish, readManifest, screenshotName, signoffState, verifyCopy,
} from '../scripts/videos-lib.mjs';

const vid = (id, commit, extra = {}) => ({ id, slug: `${id}-x`, title: `Video ${id}`, file: `${id}-x--homeowner--desktop.mp4`, role: 'homeowner', companionOf: null, length: '0:50', about: 'Sam pays his dues.', recordedAt: '2026-09-28T10:00:00Z', commit, driveId: `drive${id}${commit}`, ...extra });
const manifest = (...v) => ({ schema: 1, videos: v });
const url = (id) => `https://drive.google.com/file/d/${id}/view`;

test('manifest: two-digit ids, required fields, sorted', () => {
  const { videos, problems } = readManifest(manifest(vid('02', 'aaaaaaa'), vid('01', 'bbbbbbb')));
  assert.deepEqual(problems, []);
  assert.deepEqual(videos.map((v) => v.id), ['01', '02']);
  assert.match(readManifest(manifest({ id: '1', title: 't' })).problems[0], /two digits/);
  assert.match(readManifest(manifest(vid('01', 'aaaaaaa', { about: '' }))).problems.join(), /about/);
  assert.match(readManifest({}).problems[0], /schema/);
});

test('sign-off: an approval is of one recording', () => {
  const v = vid('01', 'aaaaaaa');
  assert.equal(signoffState(v, null), 'open');
  assert.equal(signoffState(v, { status: 'approved', commit: 'aaaaaaa' }), 'approved');
  assert.equal(signoffState(v, { status: 'approved', commit: 'ccccccc' }), 'open');
  assert.equal(signoffState(v, { status: 'fix', commit: 'aaaaaaa' }), 'fix');
});

test('publish: only approved recordings reach the owners, as a copy', () => {
  const vs = readManifest(manifest(vid('01', 'aaaaaaa'), vid('02', 'aaaaaaa'))).videos;
  const plan = planPublish(vs, { '01': { status: 'approved', commit: 'aaaaaaa' }, '02': { status: 'fix', commit: 'aaaaaaa' } }, null);
  assert.deepEqual(plan.entries.map((e) => e.id), ['01']);
  assert.deepEqual(plan.copies, [{ id: '01', file: vs[0].file, fromId: 'drive01aaaaaaa', commit: 'aaaaaaa' }]);
  assert.match(plan.changes[0], /01 Video 01: added/);
});

test('publish: a new recording waits for Jacob; the owners keep theirs, marked', () => {
  const prev = { updated: '2026-09-27', waiting: 0, videos: [{ id: '01', title: 'Video 01', commit: 'aaaaaaa', driveUrl: url('shared01'), updateComing: false }] };
  const vs = readManifest(manifest(vid('01', 'bbbbbbb'))).videos;
  const plan = planPublish(vs, { '01': { status: 'approved', commit: 'aaaaaaa' } }, prev);
  assert.equal(plan.copies.length, 0);
  assert.equal(plan.entries[0].commit, 'aaaaaaa');
  assert.equal(plan.entries[0].driveUrl, url('shared01'));
  assert.equal(plan.entries[0].updateComing, true);
});

test('publish: approving the new recording copies it over the same file', () => {
  const prev = { videos: [{ id: '01', title: 'Video 01', commit: 'aaaaaaa', driveUrl: url('shared01'), updateComing: true }] };
  const vs = readManifest(manifest(vid('01', 'bbbbbbb'))).videos;
  const plan = planPublish(vs, { '01': { status: 'approved', commit: 'bbbbbbb' } }, prev);
  assert.equal(plan.copies.length, 1);
  assert.equal(plan.entries[0].commit, 'bbbbbbb');
  assert.equal(plan.entries[0].updateComing, false);
  assert.match(plan.changes[0], /new recording bbbbbbb replaces aaaaaaa/);
});

test('publish: flagging the recording the owners have takes it off; flagging a newer one does not', () => {
  const prev = { videos: [{ id: '01', title: 'Video 01', commit: 'aaaaaaa', driveUrl: url('s'), updateComing: false }] };
  const same = planPublish(readManifest(manifest(vid('01', 'aaaaaaa'))).videos, { '01': { status: 'fix', commit: 'aaaaaaa' } }, prev);
  assert.equal(same.entries.length, 0);
  const newer = planPublish(readManifest(manifest(vid('01', 'bbbbbbb'))).videos, { '01': { status: 'fix', commit: 'bbbbbbb' } }, prev);
  assert.equal(newer.entries.length, 1);
  assert.equal(newer.entries[0].commit, 'aaaaaaa');
});

test('publish: an unchanged approval keeps the owners\' link and copies nothing', () => {
  const prev = { videos: [{ id: '01', title: 'Old title', commit: 'aaaaaaa', driveUrl: url('s'), updateComing: false }] };
  const plan = planPublish(readManifest(manifest(vid('01', 'aaaaaaa'))).videos, { '01': { status: 'approved', commit: 'aaaaaaa' } }, prev);
  assert.equal(plan.copies.length, 0);
  assert.equal(plan.entries[0].driveUrl, url('s'));
  assert.equal(plan.entries[0].title, 'Video 01');
});

test('owners data: "updated" moves only when something they read changed', () => {
  const e = [{ id: '01', title: 'T', role: 'homeowner', length: '0:50', about: 'A', commit: 'aaaaaaa', recordedAt: 'x', driveUrl: url('s') }];
  const first = buildOwnersData(e, null, '2026-09-28', 3);
  assert.equal(first.updated, '2026-09-28');
  assert.equal(buildOwnersData(e, first, '2026-09-29', 3).updated, '2026-09-28');
  assert.equal(buildOwnersData(e, first, '2026-09-29', 2).updated, '2026-09-29');
});

test('guards: excluded words and internal numbering, and a Drive link on every video', () => {
  for (const w of ['Stripe', 'Claude', 'AI', 'customer', 'register', 'D-141', 'Q-FIN-8', 'emulator']) assert.ok(findForbidden(`It says ${w} here.`).length, w);
  assert.deepEqual(findForbidden('The month, checked against NMI. Sam pays his dues by card.'), []);
  const bad = guardOwnersData({ videos: [{ id: '01', title: 'Uses Stripe', about: 'ok', role: 'board', driveUrl: '' }] });
  assert.equal(bad.length, 2);
});

test('names: a reference, and a screenshot file that starts with it', () => {
  assert.equal(noteRef('05', 4), 'V05-N004');
  const note = { ref: 'V05-N004', side: 'owners', by: 'Rustin Fairbanks', at: '2026-09-28T14:05:00Z', commit: '5dbc711' };
  assert.equal(screenshotName(note, { i: 1 }), 'V05-N004-1_2026-09-28_owner-rustin_5dbc711.jpg');
  assert.equal(screenshotName({ ...note, side: 'jacob', by: 'Jacob' }, { i: 2 }), 'V05-N004-2_2026-09-28_jacob_5dbc711.jpg');
});

test('the Drive copy is checked before the full size leaves the store', () => {
  const local = { size: 100, md5: 'm', width: 1600, height: 900, expectW: 1600, expectH: 900 };
  assert.deepEqual(verifyCopy(local, { size: 100, md5: 'm' }), []);
  assert.deepEqual(verifyCopy(local, null), ['the file is not in Drive']);
  assert.match(verifyCopy(local, { size: 99, md5: 'm' }).join(), /size/);
  assert.match(verifyCopy(local, { size: 100, md5: 'x' }).join(), /md5/);
  assert.match(verifyCopy({ ...local, width: 0, height: 0 }, { size: 100, md5: 'm' }).join(), /does not open/);
  assert.match(verifyCopy({ ...local, width: 800 }, { size: 100, md5: 'm' }).join(), /expected 1600/);
});
