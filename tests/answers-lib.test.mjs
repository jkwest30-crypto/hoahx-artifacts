// The sync's guards and builders, and the pull. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildPublished, buildPull, buildQuestions, buildScreens, checkPublished, checkSource, describeChange,
  driveLink, findForbidden, guardPublished, parseRegister, parseScreensSpec, previewClosure, previewCode,
  resolveVideos, resolveWalkthroughs, screenFingerprint, videoFingerprint, videoNumbers,
} from '../scripts/answers-lib.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const source = () => clone({
  generated: '2026-09-28',
  groups: [{ id: 'money', title: 'Money' }, { id: 'pricing', title: 'Pricing' }],
  cards: [
    { id: 'A01', group: 'money', title: 'How a homeowner pays', why: 'Because.',
      decisions: [{ id: 'D-049', code: 'Q-FIN-8', q: 'Who pays the card cost?' }, { id: 'D-046', code: 'Q-FIN-5', q: 'Are partial payments accepted?' }],
      rec: [{ id: 'A01-1', d: ['D-049'], text: 'The community pays.', videos: [] }, { id: 'A01-2', d: ['D-046'], text: 'Yes, down to one dollar.', videos: ['07'] }] },
    { id: 'A09', group: 'money', title: 'From a notice to a fee', why: 'Because.',
      decisions: [{ id: 'D-062', code: 'Q-VIOL-1', q: 'Is there a waiting period?' }, { id: 'D-064', code: 'Q-VIOL-3', q: 'Is there a published schedule?' }],
      rec: [{ id: 'A09-1', d: ['D-062', 'D-064'], text: 'A published schedule with a waiting period.', videos: [] }] },
    { id: 'A23', group: 'pricing', title: 'Pricing: the loose ends', note: 'Your plans are recorded.', why: 'Because.',
      decisions: [{ id: 'D-059', code: 'Q-BILL-1', q: 'What are the plans? Still open: two points.' }],
      rec: [{ id: 'A23-1', d: ['D-059'], q: 'Where does the top tier end?', text: 'At 500 homes.', videos: [] }, { id: 'A23-2', d: ['D-059'], q: 'Who pays the card cost on the subscription?', text: 'HOAhx does.', videos: [] }] },
  ],
});
const REGISTER = ['### D-046 · Q-FIN-5', '- Answer: pending', '### D-049 · Q-FIN-8', '- Answer: pending (asked Sep 9)', '### D-059 · Q-BILL-1', '- Answer: **Owners\' requirements document**', '### D-062 · Q-VIOL-1', '- Answer: pending', '### D-064 · Q-VIOL-3', '- Answer: pending'].join('\n');
const pendingAll = () => parseRegister(REGISTER).pending;

test('guards: every excluded word is found, as a word', () => {
  for (const w of ['Stripe', 'Claude', 'AI', 'customer', 'as today', 'already handles', 'workshop']) assert.deepEqual(findForbidden(`It says ${w} here.`), [w]);
  assert.deepEqual(findForbidden('We maintain the chair, said the captain. HOAhx is paid by the community.'), []);
});

test('guards: every mark of the internal numbering is found', () => {
  assert.deepEqual(findForbidden('as the register says'), ['register']);
  assert.deepEqual(findForbidden('The Decision Register'), ['Register']);
  assert.deepEqual(findForbidden('a registered owner'), ['register']);
  assert.deepEqual(findForbidden('see D-049 and Q-FIN-8'), ['D-049', 'Q-FIN-8']);
  assert.deepEqual(findForbidden('{"d":["D-062","D-064"]}'), ['D-062', 'D-064']);
  assert.deepEqual(findForbidden('Screen D1, card A01-1, the top tier is 301 to 500 homes.'), []);
});

test('guards: a published file is refused for a forbidden word or a local address', () => {
  assert.throws(() => guardPublished('data.json', '{"note":"recorded (D-059)"}'), /data\.json carries "D-059"/);
  assert.throws(() => guardPublished('screens.json', '{"url":"http://localhost:5173/preview/A1"}'), /local address/);
  assert.doesNotThrow(() => guardPublished('data.json', '{"note":"Your plans are recorded."}'));
});

test('register: pending is read from the Answer line', () => {
  const { all, pending } = parseRegister(REGISTER);
  assert.equal(all.size, 5);
  assert.deepEqual([...pending].sort(), ['D-046', 'D-049', 'D-062', 'D-064']);
});

test('source: a sound source passes and is counted', () => {
  assert.deepEqual(checkSource(source()), { cards: 3, lines: 5, entries: 5 });
});

test('source: every line needs its own permanent id', () => {
  const noId = source(); delete noId.cards[0].rec[0].id;
  assert.throws(() => checkSource(noId), /no permanent id/);
  const twice = source(); twice.cards[1].rec[0].id = 'A01-1';
  assert.throws(() => checkSource(twice), /A01-1 is on card A09/);
  const dup = source(); dup.cards[0].rec[1].id = 'A01-1';
  assert.throws(() => checkSource(dup), /appears twice/);
});

test('source: a line names only entries its card carries, and every entry has a line', () => {
  const foreign = source(); foreign.cards[0].rec[0].d = ['D-062'];
  assert.throws(() => checkSource(foreign), /A01-1 names D-062, which card A01 does not carry/);
  const bare = source(); bare.cards[0].rec.pop();
  assert.throws(() => checkSource(bare), /D-046 has no recommendation line/);
  const two = source(); two.cards[1].decisions[0].id = 'D-049'; two.cards[1].rec[0].d = ['D-049', 'D-064'];
  assert.throws(() => checkSource(two), /D-049 is on two cards/);
});

test('source: two lines on one entry each need a question of their own', () => {
  const s = source(); delete s.cards[2].rec[1].q;
  assert.throws(() => checkSource(s), /A23-2 shares its entry with 1 other line/);
});

test('source: a video is a two-digit number in a list', () => {
  const bad = source(); bad.cards[0].rec[1].videos = ['7'];
  assert.throws(() => checkSource(bad), /video "7" is not a two-digit number/);
  const none = source(); delete none.cards[0].rec[0].videos;
  assert.throws(() => checkSource(none), /"videos" must be a list/);
});

test('questions: what is published carries no internal numbering', () => {
  const q = buildQuestions(source(), { pending: pendingAll(), answeredButOpen: ['D-059'] });
  assert.equal(q.rows, 5);
  assert.deepEqual(q.dropped, []);
  assert.deepEqual(Object.keys(q.cards[0]), ['id', 'group', 'title', 'why', 'rows']);
  assert.deepEqual(Object.keys(q.cards[0].rows[0]), ['id', 'qs', 'rec', 'videos']);
  assert.deepEqual(findForbidden(JSON.stringify(q)), []);
});

test('questions: one recommendation can answer two questions, and each of several takes its own', () => {
  const q = buildQuestions(source(), { pending: pendingAll(), answeredButOpen: ['D-059'] });
  assert.deepEqual(q.cards[1].rows[0].qs, ['Is there a waiting period?', 'Is there a published schedule?']);
  assert.deepEqual(q.cards[2].rows.map((r) => r.qs), [['Where does the top tier end?'], ['Who pays the card cost on the subscription?']]);
  assert.equal(q.cards[2].note, 'Your plans are recorded.');
});

test('questions: an entry that is no longer pending leaves the page', () => {
  const pending = pendingAll(); pending.delete('D-049'); pending.delete('D-062');
  const q = buildQuestions(source(), { pending, answeredButOpen: ['D-059'] });
  assert.deepEqual(q.cards[0].rows.map((r) => r.id), ['A01-2'], 'the id of the line that stays does not move');
  assert.deepEqual(q.cards[1].rows[0].qs, ['Is there a published schedule?'], 'only the question still open is asked');
  assert.deepEqual(q.dropped, [{ id: 'A01-1', why: 'D-049 no longer pending' }]);
});

test('questions: a card with nothing left, and its group, leave the page', () => {
  const pending = pendingAll();
  const q = buildQuestions(source(), { pending, answeredButOpen: [] });
  assert.deepEqual(q.cards.map((c) => c.id), ['A01', 'A09']);
  assert.deepEqual(q.groups.map((g) => g.id), ['money']);
});

test('questions: an answered entry with open points stays until its line is closed', () => {
  const s = source(); s.cards[2].rec[0].closed = '2026-10-01';
  const q = buildQuestions(s, { pending: pendingAll(), answeredButOpen: ['D-059'] });
  assert.deepEqual(q.cards[2].rows.map((r) => r.id), ['A23-2']);
  assert.deepEqual(q.dropped, [{ id: 'A23-1', why: 'closed 2026-10-01' }]);
});

const SPEC = ['# SCREENS', '## FEATURE A · The community\'s HOAhx subscription (2 screens)', '### Rules already decided', '### A1 · Plans and prices', '- Shows: the tiers', '### A2 · The free trial', '## FEATURE B · Approvals (1 screens)', '### B1 · Asking for a refund'].join('\n');
const screensSource = () => clone({ previewUrl: 'https://hoahx-staging.web.app/preview', features: [
  { id: 'A', title: 'x', screens: [{ id: 'S-A1', code: 'A1', title: 'old', look: 'The plans side by side.', register: 'D-059', stub: 'F-052', videos: [] }, { id: 'S-A2', code: 'A2', title: 'old', look: 'The trial.', register: 'D-174', stub: 'F-053' }] },
  { id: 'B', title: 'x', screens: [{ id: 'S-B1', code: 'B1', title: 'old', look: 'A refund is asked for.', register: 'D-042', stub: 'F-059', videos: ['08', '30'] }] },
] });

test('screens: the spec decides which exist, in which order and under which title', () => {
  const spec = parseScreensSpec(SPEC);
  assert.deepEqual(spec.map((f) => [f.id, f.title, f.screens.map((s) => s.code)]), [['A', "The community's HOAhx subscription", ['A1', 'A2']], ['B', 'Approvals', ['B1']]]);
  const s = buildScreens(screensSource(), spec, ['A1', 'A2', 'B1', 'X0'], 3);
  assert.equal(s.total, 3);
  assert.deepEqual(s.features[1].screens[0], { id: 'S-B1', code: 'B1', title: 'Asking for a refund', what: 'A refund is asked for.', url: 'https://hoahx-staging.web.app/preview/B1', videos: ['08', '30'] });
  assert.deepEqual(findForbidden(JSON.stringify(s)), [], 'the internal mapping stays in the source');
});

test('screens: refused without a description, a preview module, or the expected count', () => {
  const spec = parseScreensSpec(SPEC);
  const blank = screensSource(); blank.features[0].screens[1].look = ' ';
  assert.throws(() => buildScreens(blank, spec, ['A1', 'A2', 'B1'], 3), /A2 \(The free trial\) has no description/);
  assert.throws(() => buildScreens(screensSource(), spec, ['A1', 'B1'], 3), /A2 \(The free trial\) has no preview module/);
  assert.throws(() => buildScreens(screensSource(), spec, ['A1', 'A2', 'B1'], 27), /expected 27 screens, the spec lists 3/);
  const extra = screensSource(); extra.features[1].screens.push({ id: 'S-B9', code: 'B9', look: 'x', register: 'D-042', stub: 'F-099' });
  assert.throws(() => buildScreens(extra, spec, ['A1', 'A2', 'B1'], 3), /describes B9, which the spec does not list/);
  const unmapped = screensSource(); delete unmapped.features[0].screens[0].register;
  assert.throws(() => buildScreens(unmapped, spec, ['A1', 'A2', 'B1'], 3), /needs A1's register entry/);
});

test('screens: a preview module names its screen', () => {
  assert.equal(previewCode("export default definePreview({\n  code: 'B2',\n  title: 'x' })"), 'B2');
  assert.equal(previewCode('export default definePreview({ code: "C7" })'), 'C7');
  assert.equal(previewCode('const postcode: "AB1"'), '');
});

// videos
const scripted = { id: '07-closing-the-month', demoFile: 'scripts/demo-videos/demos/closing.demo.ts', linkedTest: { file: 'tests/ui/treasurer/reporting.spec.ts' }, covers: ['src/pages/ledger/TreasurerReporting.tsx'], lines: { a: 'Closing is offered.' } };
const HASHES = { 'scripts/demo-videos/demos/closing.demo.ts': 'aaa', 'tests/ui/treasurer/reporting.spec.ts': 'bbb', 'src/pages/ledger/TreasurerReporting.tsx': 'ccc' };
const hashOf = (f) => HASHES[f] || 'missing';
const recorderFingerprint = () => crypto.createHash('sha256').update(['v1', 'scripts/demo-videos/demos/closing.demo.ts:aaa', 'src/pages/ledger/TreasurerReporting.tsx:ccc', 'tests/ui/treasurer/reporting.spec.ts:bbb', 'lines:{"a":"Closing is offered."}'].join('\n')).digest('hex').slice(0, 12);
const videoInputs = () => ({
  manifest: { videos: { '07-closing-the-month': { title: 'Closing the month', file: '07-closing-the-month--treasurer--desktop.mp4', seconds: 75, fingerprint: recorderFingerprint() } } },
  storyboard: { videos: [clone(scripted)] },
  hashOf,
  driveFiles: [{ Name: '07-closing-the-month--treasurer--desktop.mp4', ID: 'abc_DEF-123' }, { Name: 'README.md', ID: 'zzz' }],
});

test('videos: the fingerprint is the recorder\'s', () => {
  assert.equal(videoFingerprint(scripted, hashOf), recorderFingerprint());
});

test('videos: a number becomes a title, a length and a Drive link', () => {
  assert.deepEqual(resolveVideos(['07', '07'], videoInputs()), { '07': { title: 'Closing the month', seconds: 75, url: 'https://drive.google.com/file/d/abc_DEF-123/view' } });
  assert.equal(driveLink('x'), 'https://drive.google.com/file/d/x/view');
});

test('videos: refused when never recorded', () => {
  assert.throws(() => resolveVideos(['19'], videoInputs()), /19: not recorded/);
});

test('videos: refused when the screens changed since it was recorded', () => {
  const v = videoInputs(); v.hashOf = (f) => (f.endsWith('TreasurerReporting.tsx') ? 'changed' : hashOf(f));
  assert.throws(() => resolveVideos(['07'], v), /07 \(Closing the month\): not current/);
  const gone = videoInputs(); gone.storyboard.videos = [];
  assert.throws(() => resolveVideos(['07'], gone), /not in the storyboard/);
});

test('videos: refused when Drive has no such file', () => {
  const v = videoInputs(); v.driveFiles = [{ Name: '07-something-else.mp4', ID: 'q' }];
  assert.throws(() => resolveVideos(['07'], v), /no file named 07-closing-the-month--treasurer--desktop\.mp4/);
});

test('videos: every refusal is named at once', () => {
  assert.throws(() => resolveVideos(['07', '19', '22'], Object.assign(videoInputs(), { driveFiles: [] })), (e) => /07 .*no file named/.test(e.message) && /19: not recorded/.test(e.message) && /22: not recorded/.test(e.message));
});

// published
function published(today, previous) {
  const questions = buildQuestions(source(), { pending: pendingAll(), answeredButOpen: ['D-059'] });
  const spec = parseScreensSpec(SPEC);
  const src = screensSource(); src.features[1].screens[0].videos = ['07'];
  const screens = buildScreens(src, spec, ['A1', 'A2', 'B1'], 3);
  assert.deepEqual(videoNumbers(questions, screens), ['07', '07']);
  return buildPublished({ questions, screens, videos: resolveVideos(['07'], videoInputs()), today, previous });
}

test('published: both files pass their own check and the guards', () => {
  const p = published('2026-09-28');
  assert.deepEqual(checkPublished(p.data, p.screens), { cards: 3, rows: 5, screens: 3, videos: 1, critical: { rows: 0, screens: 0 }, answered: 0 });
  assert.doesNotThrow(() => guardPublished('data.json', JSON.stringify(p.data)));
  assert.doesNotThrow(() => guardPublished('screens.json', JSON.stringify(p.screens)));
});

test('published: "Last updated" moves only when something an owner reads changed', () => {
  const first = published('2026-09-28');
  const again = published('2026-10-03', first);
  assert.equal(again.data.updated, '2026-09-28');
  assert.equal(again.screens.updated, '2026-09-28');
  const changed = clone(first); changed.data.cards[0].rows[0].rec = 'The homeowner pays.';
  assert.equal(published('2026-10-03', changed).data.updated, '2026-10-03');
});

test('published: a field the page does not read is refused', () => {
  const p = published('2026-09-28');
  const leak = clone(p); leak.data.cards[0].rows[0].d = ['x'];
  assert.throws(() => checkPublished(leak.data, leak.screens), /A01-1 carries "d"/);
  const map = clone(p); map.screens.features[0].screens[0].stub = 'x';
  assert.throws(() => checkPublished(map.data, map.screens), /A1 carries "stub"/);
  const dead = clone(p); dead.data.cards[0].rows[1].videos = ['19'];
  assert.throws(() => checkPublished(dead.data, dead.screens), /A01-2 names video 19, which has no link/);
});

test('published: the change is described in plain lines', () => {
  const before = published('2026-09-28');
  const after = clone(before); after.data.cards[0].rows.shift(); after.data.cards[0].rows[0].videos = [];
  assert.deepEqual(describeChange(before, after), ['~ question A01-2: videos 07 -> none', '- question A01-1: Who pays the card cost?']);
  assert.equal(describeChange(null, before).length, 8);
});

// pull
const pullOf = (store) => buildPull({ source: source(), screens: screensSource(), store, site: 'https://example.test', now: '2026-09-30T12:00:00.000Z', answeredButOpen: ['D-059'] });
const at = '2026-09-29T15:00:00.000Z';

test('pull: Agree records the recommendation as the answer', () => {
  const p = pullOf({ 'A01-1': { v: 'agree', n: '', updatedAt: at } });
  assert.match(p.text, /### D-049 · Q-FIN-8\nMark: Change\nNote: Agreed with the recommendation of 2026-09-28: The community pays\.\nQuestion: A01-1 · Who pays the card cost\?\nUpdated: 2026-09-29T15:00:00\.000Z/);
  assert.doesNotMatch(p.text, /### D-046/);
  assert.deepEqual(p.tally, { agreed: 1, changed: 0, discuss: 0, held: 0, open: 4 });
});

test('pull: Change carries the owners\' words, then the recommendation', () => {
  const p = pullOf({ 'A01-2': { v: 'change', n: 'Off by default.\n', updatedAt: at } });
  assert.match(p.text, /### D-046 · Q-FIN-5\nMark: Change\nNote: Off by default\.\nOn the recommendation: Yes, down to one dollar\./);
  assert.equal(p.tally.changed, 1);
});

test('pull: Change with nothing written, and Discuss, are Mark: Discuss', () => {
  const p = pullOf({ 'A01-1': { v: 'change', n: '  ', updatedAt: at }, 'A01-2': { v: 'discuss', n: 'The whole board, or only the treasurer?', updatedAt: at } });
  assert.match(p.text, /### D-049 · Q-FIN-8\nMark: Discuss\nNote: \(Change pressed on A01-1 with nothing written; ask the owners\.\)/);
  assert.match(p.text, /### D-046 · Q-FIN-5\nMark: Discuss\nNote: The whole board, or only the treasurer\?/);
  assert.equal(p.tally.discuss, 2);
  const bare = pullOf({ 'A01-2': { v: 'discuss', n: '', updatedAt: at } });
  assert.match(bare.text, /Mark: Discuss\nNote: \(Discuss pressed on A01-2 with nothing written; put it on the next call\.\)/);
});

test('pull: one answer on a line with two entries gives each entry its block', () => {
  const p = pullOf({ 'A09-1': { v: 'agree', n: '', updatedAt: at } });
  assert.match(p.text, /### D-062 · Q-VIOL-1\nMark: Change\nNote: Agreed with the recommendation of 2026-09-28: A published schedule/);
  assert.match(p.text, /### D-064 · Q-VIOL-3\nMark: Change\nNote: Agreed with the recommendation of 2026-09-28: A published schedule/);
  assert.equal(p.tally.agreed, 2);
});

test('pull: an entry with several questions is held until all are answered', () => {
  const p = pullOf({ 'A23-1': { v: 'agree', n: '', updatedAt: at } });
  assert.match(p.text, /### D-059 · Q-BILL-1\nHold: 1 of 2 questions on this entry are answered\. Do not apply until the rest are\./);
  assert.doesNotMatch(p.text.split('### D-059')[1].split('## ')[0], /^Mark:/m);
  assert.equal(p.tally.held, 1);
});

test('pull: then it gets one block, as an addendum', () => {
  const p = pullOf({ 'A23-1': { v: 'agree', n: '', updatedAt: at }, 'A23-2': { v: 'change', n: 'The community pays it.', updatedAt: '2026-09-29T16:00:00.000Z' } });
  const block = p.text.split('### D-059 · Q-BILL-1\n')[1].split('\n\n')[0];
  assert.equal(p.text.match(/### D-059/g).length, 1);
  assert.match(block, /^Mark: Change\nNote: \(1\) Where does the top tier end\? Agreed: At 500 homes\. \(2\) Who pays the card cost on the subscription\? Changed to: The community pays it\. \(the recommendation was: HOAhx does\.\)\nQuestions: A23-1, A23-2\nUpdated: 2026-09-29T16:00:00\.000Z\nAddendum: D-059 already carries a recorded answer/);
  const open = pullOf({ 'A23-1': { v: 'agree', n: '', updatedAt: at }, 'A23-2': { v: 'discuss', n: '', updatedAt: at } });
  assert.match(open.text, /### D-059 · Q-BILL-1\nMark: Discuss/);
});

test('pull: an answer given per card on the earlier page is listed and never applied', () => {
  const p = pullOf({ A01: { v: 'change', n: '', updatedAt: at } });
  assert.match(p.text, /## Card-level answers from the earlier page \(not applied\)/);
  assert.match(p.text, /- A01 · How a homeowner pays: change, nothing written \(2026-09-29\)/);
  assert.doesNotMatch(p.text, /^Mark:/m);
  assert.deepEqual(p.old, ['A01']);
});

test('pull: a cleared answer is not an answer', () => {
  const p = pullOf({ 'A01-1': { v: '', n: '', updatedAt: at, history: [{ v: 'agree', n: '', at }] } });
  assert.doesNotMatch(p.text, /^Mark:/m);
  assert.equal(p.tally.open, 5);
});

test('pull: screens carry Signed off, Change and Discuss, with who answered', () => {
  const p = pullOf({ 'S-A1': { v: 'yes', n: '', by: 'Rustin', updatedAt: at }, 'S-A2': { v: 'change', n: 'Say who to call.', by: 'Dan', updatedAt: at }, 'S-B1': { v: 'discuss', n: 'Working days or calendar days?', by: 'Rustin', updatedAt: at }, 'S-C9': { v: 'yes', n: '', updatedAt: at } });
  assert.match(p.text, /### S-A1 · A1 · old — Signed off \(2026-09-29\)\nRegister: D-059 · Stub: F-052\nScreen: accepted\n.*\nBy: Rustin/);
  assert.match(p.text, /### S-A2 · A2 · old — Change \(2026-09-29\)\nRegister: D-174 · Stub: F-053\nMark: Change\nNote: Say who to call\.\nFollows: a candidate on D-174/);
  assert.match(p.text, /### S-B1 · B1 · old — Discuss \(2026-09-29\)\nRegister: D-042 · Stub: F-059\nMark: Discuss\nNote: Working days or calendar days\?\nBy: Rustin/);
  assert.match(p.text, /## Screens answered on the test site that the source does not list\n\n.*\n\n### S-C9 — yes/);
  assert.deepEqual(p.screens, { yes: 1, change: 1, discuss: 1, open: 0 });
});

// ── the screen walk-throughs ──────────────────────────────────────────────────
// A film of one screen, state by state. It is not a feature video: it says nothing about
// whether the thing is built, and every screen has one.
const TREE = {
  'src/components/a/plans.preview.ts': "import { lazy } from 'react';\nimport type { P } from './PlansView';\nimport { TIERS } from './fixtures';\nimport { Button } from '@/components/ui/button';\nexport default definePreview({ code: 'A1' })",
  'src/components/a/PlansView.tsx': "import { price } from './pricing';\nimport { Card } from '@/components/ui/card';\nexport const V = 1;",
  'src/components/a/pricing.ts': 'export const price = 1;',
  'src/components/a/fixtures.ts': 'export const TIERS = [];',
  'src/components/ui/button.tsx': 'export const Button = 1;',
  'src/components/b/refund.preview.ts': "export default definePreview({ code: 'B1' })",
};
const treeSide = (tree) => ({
  exists: (f) => f in tree,
  read: (f) => (f in tree ? tree[f] : null),
  hashOf: (f) => (f in tree ? crypto.createHash('sha1').update(tree[f]).digest('hex').slice(0, 8) : 'missing'),
});
const manifest = () => clone({
  schema: 1, commit: 'abc1234', driveFolder: 'HOAhx/video-review/pending-recordings',
  walkthroughs: [
    { code: 'A1', title: 'Plans and prices', file: 'a1-plans-and-prices--walkthrough--desktop.mp4', seconds: 48, commit: 'abc1234' },
    { code: 'B1', title: 'Asking for a refund', file: 'b1-asking-for-a-refund--walkthrough--desktop.mp4', seconds: 72, commit: 'abc1234' },
  ],
});
const DRIVE = [
  { Name: 'a1-plans-and-prices--walkthrough--desktop.mp4', ID: 'aaa111' },
  { Name: 'b1-asking-for-a-refund--walkthrough--desktop.mp4', ID: 'bbb222' },
];
const resolveWalk = (codes, over = {}) => resolveWalkthroughs(codes, {
  manifest: manifest(), driveFiles: DRIVE, current: () => true, readable: () => true, ...over,
});

test('walk-through: a screen is its preview module and everything it imports relatively', () => {
  const files = previewClosure('src/components/a/plans.preview.ts', treeSide(TREE));
  assert.deepEqual(files, [
    'src/components/a/PlansView.tsx',
    'src/components/a/fixtures.ts',
    'src/components/a/plans.preview.ts',
    'src/components/a/pricing.ts',
  ], 'the view, its fixtures and the helper below it — and not the shared button behind "@/"');
});

test('walk-through: a change under the screen stales it, a change to a shared part does not', () => {
  const entry = 'src/components/a/plans.preview.ts';
  const before = treeSide(TREE);
  const was = screenFingerprint(previewClosure(entry, before), before.hashOf);

  const restyled = { ...TREE, 'src/components/ui/button.tsx': 'export const Button = 2;' };
  const after1 = treeSide(restyled);
  assert.equal(screenFingerprint(previewClosure(entry, after1), after1.hashOf), was,
    'restyling a shared button must not stale all 27 films');

  const repriced = { ...TREE, 'src/components/a/pricing.ts': 'export const price = 2;' };
  const after2 = treeSide(repriced);
  assert.notEqual(screenFingerprint(previewClosure(entry, after2), after2.hashOf), was,
    'a pricing change two imports down is a change to the screen');

  const gone = { ...TREE }; delete gone['src/components/a/fixtures.ts'];
  const after3 = treeSide(gone);
  assert.notEqual(screenFingerprint(previewClosure(entry, after3), after3.hashOf), was, 'a missing file is a change');
});

test('walk-through: each screen that has a film gets a link, by its own code', () => {
  const { walkthroughs, refused } = resolveWalk(['A1', 'B1']);
  assert.deepEqual(refused, []);
  assert.deepEqual(walkthroughs, {
    A1: { seconds: 48, url: driveLink('aaa111') },
    B1: { seconds: 72, url: driveLink('bbb222') },
  });
});

test('walk-through: one that cannot be linked is left off and named, never fatal', () => {
  const never = resolveWalk(['A1', 'C7']);
  assert.deepEqual(Object.keys(never.walkthroughs), ['A1'], 'the other 26 still get their links');
  assert.match(never.refused.join('\n'), /^C7: never filmed/m);

  const stale = resolveWalk(['A1', 'B1'], { current: (code) => code !== 'B1' });
  assert.deepEqual(Object.keys(stale.walkthroughs), ['A1']);
  assert.match(stale.refused.join('\n'), /B1 \(Asking for a refund\): not current, the screen changed since it was filmed at abc1234/);

  const notUploaded = resolveWalk(['A1', 'B1'], { driveFiles: DRIVE.slice(0, 1) });
  assert.deepEqual(Object.keys(notUploaded.walkthroughs), ['A1']);
  assert.match(notUploaded.refused.join('\n'), /B1 .*: no file named b1-.* in the Drive folder/);

  const m = manifest(); delete m.walkthroughs[1].seconds;
  const noLength = resolveWalk(['A1', 'B1'], { manifest: m });
  assert.deepEqual(Object.keys(noLength.walkthroughs), ['A1']);
  assert.match(noLength.refused.join('\n'), /B1: the manifest gives no length/);
});

test('walk-through: a Drive file nobody may open is not a link', () => {
  // The one that shipped 27 dead links if nobody asked: the file is there, the screen is current,
  // and the owner meets a sign-in page. Anything but a clear yes counts as no.
  const shared = driveLink('aaa111');
  const { walkthroughs, refused } = resolveWalk(['A1', 'B1'], { readable: (url) => url === shared });
  assert.deepEqual(Object.keys(walkthroughs), ['A1']);
  assert.match(refused.join('\n'), /B1 \(Asking for a refund\): the Drive file is not readable by link, so the owners would meet a sign-in page/);
  assert.deepEqual(Object.keys(resolveWalk(['A1'], { readable: () => undefined }).walkthroughs), []);
});

test('walk-through: the published screen carries the link, and the page reads nothing else', () => {
  const spec = parseScreensSpec(SPEC);
  const walk = resolveWalk(['A1', 'B1']).walkthroughs;
  const s = buildScreens(screensSource(), spec, ['A1', 'A2', 'B1'], 3, walk);
  assert.deepEqual(s.features[0].screens[0].walk, { seconds: 48, url: driveLink('aaa111') });
  assert.equal('walk' in s.features[0].screens[1], false, 'A2 was never filmed, so it carries nothing');

  const data = { updated: '2026-09-28', groups: [], cards: [], videos: {} };
  const ok = { updated: '2026-09-28', previewUrl: s.previewUrl, features: clone(s.features) };
  ok.features[1].screens[0].videos = [];
  assert.equal(checkPublished(data, ok).screens, 3);

  const bad = clone(ok); bad.features[0].screens[0].walk.title = 'Plans and prices';
  assert.throws(() => checkPublished(data, bad), /A1's walk carries "title", which the page does not read/);
  const short = clone(ok); short.features[0].screens[0].walk.seconds = 0;
  assert.throws(() => checkPublished(data, short), /A1's walk has no length/);
  const elsewhere = clone(ok); elsewhere.features[0].screens[0].walk.url = 'https://example.com/a1.mp4';
  assert.throws(() => checkPublished(data, elsewhere), /A1's walk has no Drive link/);
});

test('walk-through: the sync says when a film appears, is re-filmed, or goes', () => {
  const spec = parseScreensSpec(SPEC);
  const none = { screens: { features: buildScreens(screensSource(), spec, ['A1', 'A2', 'B1'], 3).features }, data: { cards: [] } };
  const one = { screens: { features: buildScreens(screensSource(), spec, ['A1', 'A2', 'B1'], 3, resolveWalk(['A1']).walkthroughs).features }, data: { cards: [] } };
  assert.deepEqual(describeChange(none, one), ['+ screen A1: a video of it, 48s']);
  const longer = clone(one); longer.screens.features[0].screens[0].walk.seconds = 61;
  assert.deepEqual(describeChange(one, longer), ['~ screen A1: a new video of it, 61s']);
  assert.deepEqual(describeChange(one, none), ['- screen A1: its video is no longer linked']);
});

// ── what is critical ─────────────────────────────────────────────────────────
import {
  addWorkingDays, criticalFirst, criticalForEntries, criticalForScreen, dueWithin, parseBlocks,
  parseMilestones, parseScreenLinks, parseTaskMilestones,
} from '../scripts/answers-lib.mjs';

const PLAN = [
  '| M3 | Accounts secured | Sep 18 → **Sep 23** | x | y |',
  '| M8 | Payment integration built and verified in sandbox | Sep 18 → **Sep 30** | x | y |',
  '| M4 | Protection, monitoring, and backups | Sep 25 → **Oct 9** | x | y |',
  '| M13 | Submission | **Oct 16** | x | y |',
  '| M9 | Live payment test | Sep 25 → **within a week of O1 approval; done by Oct 28** | x | y |',
].join('\n');
const STATUS = '| M3 | Accounts that move money secured | Sep 23 | **Done 2026-09-23** (S1) |';
const BACKLOG = ['### Item 2 · Build NMI · milestone M8, Sep 18', '| N3 | x | y |', '### Item 4 · Abuse · part of milestone M4', '| A2 | x |', '### Week 4 · Submission', '| ST3 | x |', '### Item 12 · milestone M13', '| ST3 | later |'].join('\n');
const DECISIONS = ['### D-049 · Q-FIN-8', '- Blocks: N3, M7 (Q&A question 5)', '### D-107 · Q-X', '- Blocks: A2', '### D-105 · Q-Y', '- Blocks: ST3', '### D-030 · Q-Z', '- Blocks: none'].join('\n');
const plan = () => ({ milestones: parseMilestones(PLAN, STATUS), taskMilestone: parseTaskMilestones(BACKLOG), today: '2026-09-29', windowDays: 10 });

test('critical: the window counts working days, the milestones and their done state come from the plan', () => {
  assert.equal(addWorkingDays('2026-09-29', 10), '2026-10-13');
  assert.equal(addWorkingDays('2026-10-02', 1), '2026-10-05');
  const m = parseMilestones(PLAN, STATUS);
  assert.equal(m.M8.date, '2026-09-30');
  assert.equal(m.M3.done, true);
  assert.equal(m.M8.done, false);
  assert.ok(!('M9' in m), 'a target that is not one plain date is left out, not guessed');
  assert.deepEqual(parseBlocks(DECISIONS)['D-049'], ['N3', 'M7']);
  assert.equal(parseTaskMilestones(BACKLOG).ST3, 'M13');
});

test('critical: a question is critical only when what it blocks is due in the window and not done', () => {
  const blocks = parseBlocks(DECISIONS);
  const c = (ids) => criticalForEntries(ids, blocks, plan());
  assert.deepEqual(c(['D-049']), { date: '2026-09-30', why: 'Needed by Sep 30: payment integration built and verified in sandbox.' });
  assert.equal(c(['D-107']).date, '2026-10-09');
  assert.equal(c(['D-105']), null, 'submission is Oct 16, past the window');
  assert.equal(c(['D-030']), null, 'blocks none');
  assert.equal(dueWithin(['M3'], plan()), null, 'a milestone that is done blocks nothing');
  assert.equal(c(['D-049', 'D-107']).date, '2026-09-30', 'the soonest wins');
});

test('critical: a screen is critical when another screen leads to it or a due task waits on it', () => {
  const links = parseScreenLinks(['### A1 · Plans', '- Can do: choose a plan; continue to A2.', '- Draw these states: A9 is not read', '### A2 · Trial', '- Shows: a trial'].join('\n'));
  assert.deepEqual(links, { A2: ['A1'] });
  const m = plan().milestones;
  m.M17 = { name: 'The 27 screens approved by the owners', date: '2026-10-02', done: false };
  const blocks = parseBlocks(DECISIONS);
  const p = plan();
  assert.match(criticalForScreen('A2', 'D-030', { blocksOf: blocks, ledBy: links }, p, m.M17).why, /^Needed by Oct 2: A1 leads to this screen/);
  assert.equal(criticalForScreen('A1', 'D-030', { blocksOf: blocks, ledBy: links }, p, m.M17), null);
  assert.equal(criticalForScreen('A1', 'D-049', { blocksOf: blocks, ledBy: links }, p, m.M17).date, '2026-09-30');
});

test('critical: buildQuestions puts critical questions and cards first, soonest due first, others in their order', () => {
  const blocks = { 'D-049': ['N3'], 'D-046': ['A2'], 'D-062': [], 'D-064': [], 'D-059': [] };
  const q = buildQuestions(source(), { pending: pendingAll(), answeredButOpen: ['D-059'], criticalOf: (ids) => criticalForEntries(ids, blocks, plan()) });
  assert.equal(q.critical, 2);
  assert.deepEqual(q.cards.map((c) => c.id), ['A01', 'A09', 'A23']);
  assert.deepEqual(q.cards[0].rows.map((r) => r.id), ['A01-1', 'A01-2']);
  assert.equal(q.cards[0].rows[0].critical.date, '2026-09-30');
  assert.equal(q.cards[0].rows[1].critical.date, '2026-10-09');
  assert.equal(q.cards[1].rows[0].critical, undefined);
  // a later-due card that comes first in the source is moved behind the sooner one
  const src = source();
  src.cards.reverse();
  const q2 = buildQuestions(src, { pending: pendingAll(), answeredButOpen: ['D-059'], criticalOf: (ids) => criticalForEntries(ids, blocks, plan()) });
  assert.equal(q2.cards[0].id, 'A01');
  assert.deepEqual(q2.cards.slice(1).map((c) => c.id), ['A23', 'A09'], 'the rest keep the order they had');
  assert.deepEqual(criticalFirst([{ d: null }, { d: '2026-10-09' }, { d: '2026-09-30' }], (x) => x.d).map((x) => x.d), ['2026-09-30', '2026-10-09', null]);
});

test('critical: the published file allows a plain reason and nothing else, and the page guards still hold', () => {
  const data = { updated: '2026-09-29', groups: [{ id: 'money', title: 'Money' }], videos: {}, cards: [{ id: 'A01', group: 'money', title: 'T', why: 'w', rows: [{ id: 'A01-1', qs: ['q?'], rec: 'r', videos: [], critical: { date: '2026-09-30', why: 'Needed by Sep 30: payment integration built and verified in sandbox.' } }] }] };
  const screens = { updated: '2026-09-29', previewUrl: 'https://x.test/preview', features: [{ id: 'A', title: 'A', screens: [{ id: 'S-A1', code: 'A1', title: 't', what: 'w', url: 'https://x.test/preview/A1', videos: [], critical: { date: '2026-10-02', why: 'Needed by Oct 2: A2 leads to this screen, so it is signed off first.' } }] }] };
  assert.deepEqual(checkPublished(data, screens).critical, { rows: 1, screens: 1 });
  const bad = clone(data); bad.cards[0].rows[0].critical.why = 'Urgent';
  assert.throws(() => checkPublished(bad, screens), /one plain line/);
  const extra = clone(data); extra.cards[0].rows[0].critical.d = 'D-049';
  assert.throws(() => checkPublished(extra, screens), /does not read/);
  const leak = clone(screens); leak.features[0].screens[0].critical.why = 'Needed by Oct 2: see D-049.';
  assert.throws(() => guardPublished('screens.json', JSON.stringify(leak)), /D-049/);
});
