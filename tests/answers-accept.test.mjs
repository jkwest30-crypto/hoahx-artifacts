// Jacob's accept step and the Answered Questions tab. Run with `npm test`.
// The rule under test: nothing an owner answered leaves the open list until Jacob accepts it; an
// accepted answer moves to the Answered Questions tab; a reply stays open with our reply on it;
// a Discuss never moves. Screens follow the same rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAcceptance, buildAcceptRows, buildPublished, buildQuestions, buildScreens, checkAccepted, checkAnsweredStatus,
  checkPublished, describeChange, findForbidden, parseAnswers, parseRegister, parseScreensSpec, sortAnswer,
} from '../scripts/answers-lib.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const source = () => clone({
  generated: '2026-09-28',
  groups: [{ id: 'money', title: 'Money' }, { id: 'pricing', title: 'Pricing' }],
  cards: [
    { id: 'A01', group: 'money', title: 'How a homeowner pays', why: 'Because.',
      decisions: [{ id: 'D-049', code: 'Q-FIN-8', q: 'Who pays the card cost?' }, { id: 'D-046', code: 'Q-FIN-5', q: 'Are partial payments accepted?' }],
      rec: [{ id: 'A01-1', d: ['D-049'], text: 'The community pays.', videos: [] }, { id: 'A01-2', d: ['D-046'], text: 'Yes, down to one dollar.', videos: [], planned: 'A homeowner can pay any amount from one dollar.' }] },
    { id: 'A02', group: 'money', title: 'Late fees', why: 'Because.',
      decisions: [{ id: 'D-043', code: 'Q-FIN-2', q: 'Are late fees applied automatically?' }],
      rec: [{ id: 'A02-1', d: ['D-043'], text: 'Yes, the day after the grace period.', videos: [] }] },
    { id: 'A23', group: 'pricing', title: 'Pricing: the loose ends', why: 'Because.',
      decisions: [{ id: 'D-059', code: 'Q-BILL-1', q: 'What are the plans?' }],
      rec: [{ id: 'A23-1', d: ['D-059'], q: 'Where does the top tier end?', text: 'At 500 homes.', videos: [] }] },
  ],
});
const REGISTER = ['### D-043 · Q-FIN-2', '- Answer: pending', '### D-046 · Q-FIN-5', '- Answer: pending', '### D-049 · Q-FIN-8', '- Answer: pending', '### D-059 · Q-BILL-1', '- Answer: pending'].join('\n');
const SPEC = ['# SCREENS', '## FEATURE A · Subscription (2 screens)', '### A1 · Plans and prices', '### A2 · The free trial'].join('\n');
const screenSource = () => clone({ previewUrl: 'https://hoahx-staging.web.app/preview', features: [
  { id: 'A', title: 'x', screens: [
    { id: 'S-A1', code: 'A1', title: 'old', look: 'The plans side by side.', register: 'D-059', stub: 'F-052', videos: [] },
    { id: 'S-A2', code: 'A2', title: 'old', look: 'The trial.', register: 'D-174', stub: 'F-053', videos: [] },
  ] },
] });
const at = '2026-09-30T01:50:20.883Z';
// The shape of the Oct 1 pull: one clean Agree (A02-1, the late-fee question), a Discuss, a Change
// that asks something, and two screens (one signed off, one with changes and a question).
const STORE = () => clone({
  'A02-1': { v: 'agree', n: '', updatedAt: at },
  'A01-1': { v: 'discuss', n: 'What did you mean by the second part?', updatedAt: at },
  'A01-2': { v: 'change', n: 'Down to one dollar, but never more than the balance?', updatedAt: at },
  'A23-1': { v: 'change', n: 'At 458 homes.', by: 'Rustin', updatedAt: at },
  'S-A1': { v: 'yes', n: '', by: 'Rustin', updatedAt: at },
  'S-A2': { v: 'change', n: 'Show the pricing math. Who can cancel?', by: 'Rustin', updatedAt: at },
});

function sync({ accepted = {}, status = {}, store = STORE(), register = REGISTER, src = source() } = {}) {
  const questions = buildQuestions(src, { pending: parseRegister(register).pending });
  const screens = buildScreens(screenSource(), parseScreensSpec(SPEC), ['A1', 'A2'], 2);
  return applyAcceptance({ source: src, questions, screenSource: screenSource(), screens, store, accepted, status, answers: parseAnswers(register), today: '2026-10-03' });
}
const answeredOn = (id, text) => REGISTER.replace(`### ${id} · ${{ 'D-043': 'Q-FIN-2', 'D-046': 'Q-FIN-5', 'D-049': 'Q-FIN-8', 'D-059': 'Q-BILL-1' }[id]}\n- Answer: pending`, (m) => m.replace('pending', text));
const ok = (at2 = '2026-10-02T20:00:00.000Z') => ({ decision: 'accept', at: at2 });
const openIds = (r) => r.questions.cards.flatMap((c) => c.rows.map((x) => x.id));

test('accept: with no decision nothing moves, an Agree included', () => {
  const r = sync();
  assert.deepEqual(openIds(r), ['A01-1', 'A01-2', 'A02-1', 'A23-1']);
  assert.deepEqual(r.answered, []);
});

test('accept: an accepted Agree moves to Answered with the recommendation as what will be built', () => {
  const r = sync({ accepted: { 'A02-1': ok() } });
  assert.deepEqual(openIds(r), ['A01-1', 'A01-2', 'A23-1']);
  assert.deepEqual(r.answered, [{
    id: 'A02-1', kind: 'question', card: 'Late fees', qs: ['Are late fees applied automatically?'], answer: 'agree',
    rec: 'Yes, the day after the grace period.', build: 'Yes, the day after the grace period.', answeredOn: '2026-09-30', acceptedOn: '2026-10-02', status: 'planned',
  }]);
  assert.equal(r.questions.rows, 3);
});

test('accept: once the entry is answered, what will be built is the recorded answer, and the card and group leave', () => {
  const register = answeredOn('D-043', 'Agreed with the recommendation of 2026-10-02: Yes, on the day after the grace period, and the homeowner is told.');
  const r = sync({ accepted: { 'A02-1': ok() }, register });
  assert.equal(r.answered.length, 1);
  assert.equal(r.answered[0].build, 'Yes, on the day after the grace period, and the homeowner is told.');
  assert.ok(!r.questions.cards.some((c) => c.id === 'A02'));
});

test('accept: a recorded answer an owner must not read is not published; the source wording is asked for', () => {
  const register = answeredOn('D-043', 'Yes; see D-120 in the register.');
  const r = sync({ accepted: { 'A02-1': ok() }, register });
  assert.equal(r.answered[0].build, 'Yes, the day after the grace period.');
  assert.match(r.held[0].why, /carries "D-120", "register"/);
  assert.deepEqual(findForbidden(JSON.stringify(r.answered)), []);
});

test('accept: a Discuss stays open until its outcome is recorded, then moves as settled together', () => {
  const r = sync({ accepted: { 'A01-1': ok() } });
  assert.ok(openIds(r).includes('A01-1'));
  assert.deepEqual(r.held, [{ id: 'A01-1', why: "accepted, but the owners' mark is discuss and the outcome is not recorded yet: it stays open" }]);
  const settled = sync({ accepted: { 'A01-1': ok() }, register: answeredOn('D-049', '**The homeowner pays**, shown before they confirm.') });
  assert.ok(!openIds(settled).includes('A01-1'));
  assert.deepEqual([settled.answered[0].answer, settled.answered[0].build], ['discuss', 'The homeowner pays, shown before they confirm.']);
});

test('accept: a Discuss Jacob did not accept stays open even when its outcome is recorded elsewhere', () => {
  const r = sync({ register: answeredOn('D-049', 'The homeowner pays.') });
  assert.ok(!openIds(r).includes('A01-1'), 'the old rule still drops a line whose entry is answered');
  assert.deepEqual(r.answered, [], 'but nothing reaches Answered without an accept');
});

test('accept: a cleared answer stays open', () => {
  const store = STORE(); store['A23-1'] = { v: '', n: '', updatedAt: at };
  const r = sync({ accepted: { 'A23-1': ok() }, store });
  assert.ok(openIds(r).includes('A23-1'));
  assert.match(r.held[0].why, /no longer in the store/);
});

test('accept: a Change in their words moves, with the planned wording when the source has one', () => {
  const r = sync({ accepted: { 'A01-2': ok(), 'A23-1': ok() }, status: { 'A23-1': 'built' } });
  const byId = Object.fromEntries(r.answered.map((a) => [a.id, a]));
  assert.equal(byId['A01-2'].build, 'A homeowner can pay any amount from one dollar.');
  assert.equal(byId['A23-1'].build, 'Built the way you asked, in your words above.');
  assert.equal(byId['A23-1'].status, 'built');
  assert.equal(byId['A01-2'].status, 'planned', 'missing from the status file reads as planned');
});

test('reply: the question stays open and carries our reply', () => {
  const r = sync({ accepted: { 'A01-2': { decision: 'reply', at: '2026-10-02T20:00:00Z', reply: 'Yes: never more than what is owed.' } } });
  const row = r.questions.cards[0].rows.find((x) => x.id === 'A01-2');
  assert.equal(row.reply, 'Yes: never more than what is owed.');
  assert.equal(r.replied, 1);
  assert.deepEqual(r.answered, []);
});

test('screens: a sign-off moves only when accepted; a reply shows on the screen', () => {
  const none = sync();
  assert.equal(none.answered.length, 0);
  const r = sync({ accepted: { 'S-A1': ok(), 'S-A2': { decision: 'reply', at: '2026-10-02', reply: 'We will send a screen-by-screen answer.' } } });
  assert.deepEqual(r.answered.map((a) => [a.id, a.kind, a.code, a.answer, a.build]), [['S-A1', 'screen', 'A1', 'yes', 'Built as shown on the screen.']]);
  const a2 = r.screens.features[0].screens.find((s) => s.code === 'A2');
  assert.equal(a2.reply, 'We will send a screen-by-screen answer.');
  assert.equal(r.screens.features[0].screens.length, 2, 'screens.json still lists every screen');
});

test('published: answered and replies pass the check, carry no internal numbering, and are described', () => {
  const r = sync({ accepted: { 'A02-1': ok(), 'S-A1': ok(), 'A01-2': { decision: 'reply', at: '2026-10-02', reply: 'Yes.' } } });
  const p = buildPublished({ questions: r.questions, screens: r.screens, videos: {}, today: '2026-10-03', previous: null, answered: r.answered });
  const n = checkPublished(p.data, p.screens);
  assert.equal(n.answered, 2);
  assert.deepEqual(findForbidden(JSON.stringify(p.data)), []);
  const before = buildPublished({ questions: sync().questions, screens: sync().screens, videos: {}, today: '2026-10-02', previous: null });
  const lines = describeChange(before, p);
  assert.ok(lines.includes('+ answered A02-1: Are late fees applied automatically? (planned)'));
  assert.ok(lines.includes('- question A02-1: Are late fees applied automatically?'));
  assert.ok(lines.includes('~ question A01-2: our reply shown'));
  const moved = clone(p); moved.data.answered[0].status = 'live';
  assert.ok(describeChange(p, moved).some((l) => / -> live$/.test(l)));
});

test('published: an id both open and answered, an unknown field or status, is refused', () => {
  const r = sync({ accepted: { 'A02-1': ok() } });
  const p = buildPublished({ questions: r.questions, screens: r.screens, videos: {}, today: '2026-10-03', previous: null, answered: r.answered });
  const twice = clone(p); twice.data.answered.push(Object.assign({}, twice.data.answered[0], { id: 'A01-1' }));
  assert.throws(() => checkPublished(twice.data, twice.screens), /A01-1 is both open and answered/);
  const leak = clone(p); leak.data.answered[0].d = ['D-043'];
  assert.throws(() => checkPublished(leak.data, leak.screens), /carries "d"/);
  const bad = clone(p); bad.data.answered[0].status = 'done';
  assert.throws(() => checkPublished(bad.data, bad.screens), /status "done"/);
});

test('files: accepted.json and answered-status.json are checked', () => {
  assert.doesNotThrow(() => checkAccepted({ 'A02-1': ok(), 'S-A2': { decision: 'reply', at: '2026-10-02', reply: 'x' } }));
  assert.throws(() => checkAccepted({ 'D-043': ok() }), /not a question/);
  assert.throws(() => checkAccepted({ 'A02-1': { decision: 'yes', at: '2026-10-02' } }), /not accept or reply/);
  assert.throws(() => checkAccepted({ 'A02-1': { decision: 'reply', at: '2026-10-02' } }), /no reply text/);
  assert.throws(() => checkAccepted({ 'A02-1': { decision: 'accept' } }), /no date/);
  assert.doesNotThrow(() => checkAnsweredStatus({ 'A02-1': 'live' }));
  assert.throws(() => checkAnsweredStatus({ 'A02-1': 'shipped' }), /not planned/);
});

test('sort: Agree and Signed off are clean, a question or a condition is an open point, Discuss is held', () => {
  assert.deepEqual(sortAnswer({ v: 'agree', n: '' }), { sort: 'clean', recommendation: 'accept', openPoint: '' });
  assert.equal(sortAnswer({ v: 'yes', n: '' }).sort, 'clean');
  assert.equal(sortAnswer({ v: 'change', n: 'Make it 458 homes.' }).sort, 'clean');
  const open = sortAnswer({ v: 'change', n: 'Keep the trial. Who can cancel?' });
  assert.deepEqual(open, { sort: 'open-point', recommendation: 'reply', openPoint: 'Who can cancel?' });
  assert.equal(sortAnswer({ v: 'change', n: 'Yes, but only if the board approves.' }).sort, 'open-point');
  assert.equal(sortAnswer({ v: 'discuss', n: '' }).recommendation, 'hold');
  assert.equal(sortAnswer({ v: 'change', n: '' }).sort, 'discuss', 'a Change with nothing written is a conversation');
});

test('sort: the accept file lists only what Jacob has not decided, and keeps a drafted reply on an unchanged answer', () => {
  const rows = buildAcceptRows({ source: source(), screens: screenSource(), store: STORE(), accepted: { 'A02-1': ok() } });
  assert.deepEqual(rows.map((r) => [r.id, r.sort, r.recommendation]), [
    ['S-A1', 'clean', 'accept'], ['S-A2', 'open-point', 'reply'],
    ['A01-1', 'discuss', 'hold'], ['A01-2', 'open-point', 'reply'], ['A23-1', 'clean', 'accept'],
  ]);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'card', 'question', 'answer', 'note', 'who', 'at', 'sort', 'recommendation', 'openPoint', 'draftReply']);
  const drafted = rows.map((r) => (r.id === 'A01-2' ? Object.assign({}, r, { draftReply: 'Yes, never more than what is owed.', sort: 'clean', recommendation: 'accept' }) : r));
  const again = buildAcceptRows({ source: source(), screens: screenSource(), store: STORE(), accepted: { 'A02-1': ok() }, previous: drafted });
  const a012 = again.find((r) => r.id === 'A01-2');
  assert.equal(a012.draftReply, 'Yes, never more than what is owed.');
  assert.equal(a012.sort, 'clean', 'the intake lane\'s own sort stands on an unchanged answer');
  const store = STORE(); store['A01-2'].n = 'Something new?'; store['A01-2'].updatedAt = '2026-10-03T00:00:00Z';
  const changed = buildAcceptRows({ source: source(), screens: screenSource(), store, previous: drafted }).find((r) => r.id === 'A01-2');
  assert.equal(changed.draftReply, '', 'a changed answer is sorted again');
});
