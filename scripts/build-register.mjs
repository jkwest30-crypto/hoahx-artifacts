#!/usr/bin/env node
// Build the published Decision Register page from the launch program's decisions.md.
//
//   node scripts/build-register.mjs [--source <decisions.md>] [--out <html>] [--site <url>]
//        [--snapshot-dir <dir>] [--date "September 9, 2026"] [--key <passphrase>]
//        [--offline] [--allow-orphans] [--check] [--skip-register-check]
//
// What it guarantees before it writes anything:
//   1. decisions.md parses cleanly: every entry has an Area, Why, Today, Question, Answer,
//      Answered; ids and codes are unique; every entry sits under an area header; every
//      Launch value is one of the three; every Follows points at a real entry, not itself.
//   2. register-check.cjs passes in --strict mode. That script lives beside decisions.md in the
//      launch program and owns the coverage and reference rules (every Core bullet and F-id in
//      exactly one entry, every Core bullet on an in-the-launch entry, real Test and Blocks
//      references, no pending answer on a candidate, the header count, the excluded words).
//      It is the one implementation of those rules; this builder runs it rather than repeating
//      it. When decisions.md sits somewhere without it, the build says so and carries on.
//   3. The live shared store is fetched and snapshotted to --snapshot-dir (default:
//      <decisions.md's folder>/register-store), so the owners' marks and notes are on disk
//      before the page changes. --offline skips this (and says so).
//   4. No live mark or note in the store points at an id the new page does not have. If one
//      does, the build stops and lists them; --allow-orphans overrides (the snapshot still
//      holds them).
//   5. The generated page contains none of the words the owner-facing documents exclude.
// --check runs all of that and writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseDecisions, loadWorkflowNames, fetchStore, snapshotStore, isLive, forbiddenWords, DEFAULT_SITE } from './register-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = parseArgs(process.argv.slice(2));

const SOURCE = path.resolve(args.source || process.env.DECISIONS_MD || path.join(root, '..', 'hoahx', 'docs', 'launch', 'decisions.md'));
const OUT = path.resolve(args.out || path.join(root, 'go-live', 'decision-register', 'decision-register.html'));
const SITE = (args.site || process.env.REGISTER_SITE || DEFAULT_SITE).replace(/\/$/, '');
const SNAP_DIR = path.resolve(args['snapshot-dir'] || process.env.REGISTER_STORE_DIR || path.join(path.dirname(SOURCE), 'register-store'));
const KEY = args.key || process.env.DECISION_EDIT_KEY || '';
const TEMPLATE = path.join(here, 'register-template.html');
const CHECK_ONLY = !!args.check;
const TZ = 'America/Denver';

function fail(msg) { console.error('\n✗ ' + msg); process.exit(1); }
function longDate(d = new Date()) { return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ }); }

// 1. Parse
if (!fs.existsSync(SOURCE)) fail(`decisions.md not found at ${SOURCE} (pass --source or set DECISIONS_MD)`);
const md = fs.readFileSync(SOURCE, 'utf8');
// The workflow map sits at the repo root two levels above docs/launch/.
const WORKFLOWS = path.resolve(args.workflows || path.join(path.dirname(SOURCE), '..', '..', 'workflow-map.json'));
const workflowNames = loadWorkflowNames(WORKFLOWS);
if (!workflowNames.size) console.warn(`  ! no workflow names at ${WORKFLOWS}: "Proven by" will read as a plain sentence instead of the workflow's name`);
const parsed = parseDecisions(md, path.basename(SOURCE), workflowNames);
if (parsed.problems.length) fail('decisions.md has problems:\n  ' + parsed.problems.join('\n  '));
const { domains, questions } = parsed;
const ids = new Set(questions.map((x) => x.id));
const total = questions.length;
// "Start here" is the gating set: the entries a launch task is waiting on, from the Priority
// queue, not an area. Waiting on you is the open half of it.
const gating = questions.filter((x) => x.gate);
const waiting = gating.filter((x) => !x.pd);
const L = parsed.launch;
console.log(`✓ ${path.basename(SOURCE)}: ${total} decisions in ${domains.length} areas, ${parsed.answeredCount} planned (answered on the record), ${questions.filter((x) => x.plan).length} with a Planned line`);
console.log(`  release: ${L.l} in the launch · ${L.c} candidate${L.c === 1 ? '' : 's'} · ${L.n} not planned${L.unset ? ` · ${L.unset} with no Launch value (no pill will show)` : ''}`);
console.log(`  gating set: ${gating.length}, of which ${waiting.length} waiting on the owners · proven by a named test: ${questions.filter((x) => x.tp).length}, proof to come: ${questions.filter((x) => x.tk && !x.tp).length}, no Test line: ${questions.filter((x) => !x.tk).length}`);
console.log(`  sources on ${questions.filter((x) => x.sf || x.sr).length} entries · ${questions.filter((x) => x.fl).length} continue another entry · value in words on ${questions.filter((x) => x.vw).length}`);
if (parsed.headerCount && (parsed.headerCount.answered !== parsed.answeredCount || parsed.headerCount.total !== total)) {
  console.warn(`  ! header says "Answers: ${parsed.headerCount.answered} of ${parsed.headerCount.total}" but the entries say ${parsed.answeredCount} of ${total}; fix the header`);
}

// 2. The register's own coverage and reference rules, from the launch program beside decisions.md.
const CHECK = path.join(path.dirname(SOURCE), 'scripts', 'register-check.cjs');
if (args['skip-register-check']) {
  console.warn('  ! --skip-register-check: the coverage and reference rules were NOT checked');
} else if (!fs.existsSync(CHECK)) {
  console.warn(`  ! register-check.cjs not found at ${CHECK}; the coverage and reference rules were not checked (pass --skip-register-check to silence this)`);
} else {
  const run = spawnSync(process.execPath, [CHECK, '--strict', '--quiet'], { encoding: 'utf8' });
  const out = `${run.stdout || ''}${run.stderr || ''}`.trimEnd();
  if (run.status !== 0) fail(`register-check.cjs --strict failed, so the page is not built:\n${out || '(no output)'}`);
  console.log(`✓ register-check.cjs --strict passed${out ? ` (${out.split('\n').pop().trim()})` : ''}`);
}

// 2 + 3. Snapshot the live store and refuse to strand anything in it
let storeNote = '';
if (args.offline) {
  storeNote = 'store not checked (--offline)';
  console.warn('  ! --offline: the shared store was NOT snapshotted or checked for stranded marks');
} else {
  let store;
  try { store = await fetchStore(SITE, KEY); } catch (e) { fail(e.message + '\n  (use --offline only if you accept building without the store check)'); }
  const snap = snapshotStore(SNAP_DIR, SITE, store);
  const live = Object.entries(store).filter(([, r]) => isLive(r));
  console.log(`✓ shared store at ${SITE}: ${live.length} live mark(s)/note(s), ${Object.keys(store).length} record(s) in all; snapshot ${snap.wrote ? 'written' : 'unchanged'}: ${snap.file}`);
  const orphans = live.filter(([id]) => !ids.has(id));
  if (orphans.length) {
    const list = orphans.map(([id, r]) => `${id}: ${r.v || '(no mark)'}${r.n ? ' · note: ' + String(r.n).slice(0, 60) : ''}`).join('\n  ');
    if (!args['allow-orphans']) fail(`${orphans.length} live mark(s) in the shared store have no matching decision on the new page and would be hidden:\n  ${list}\nRename or restore those ids in decisions.md, or rerun with --allow-orphans (the snapshot keeps them).`);
    console.warn(`  ! --allow-orphans: ${orphans.length} stranded record(s) will not show on the page (kept in the snapshot):\n  ${list}`);
  }
  storeNote = `${live.length} live records checked`;
}

// 4. Render
const template = fs.readFileSync(TEMPLATE, 'utf8');
const data = { domains, questions: questions.map(({ _answer, _area, _line, ...x }) => x) };
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const extra = total - 109;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const word = (n) => (n < WORDS.length ? WORDS[n] : String(n));
// The lede the owners read (section 7 of the triage plan): the register's job changed from
// "questions found by reading the code" to "every requirement of the release, and how it is
// proven". The old framing left the impression that all of it was owed back as answers.
const ledeOne = `Every requirement of the first release, in one place: ${total} items, each with what the platform does today, whether it is in the release, a ranked candidate, or not planned, and the test that will prove it works. It is built from your Core list of September 14 and its September 15 update, three dozen screens in your demo, and 109 decisions found by reading the code that runs today. ${waiting.length ? `${waiting.length === 1 ? 'One item is' : `${word(waiting.length)} items are`} waiting on you; the rest say what will be built unless you say otherwise.` : 'Nothing is waiting on you; every item says what will be built unless you say otherwise.'}`;
const found = `${total} items: your Core list of September 14, 2026 (updated September 15), the features your demo shows, and 109 decisions found on September 4 by reading the code${extra - 106 > 0 ? `, plus ${word(Math.min(extra - 106, 9))} follow-up ${extra - 106 === 1 ? 'question' : 'questions'} raised since` : ''}.`;
const updated = args.date || longDate();
const built = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) + ' MT';

const fill = {
  TOTAL: String(total), PLANNED: String(parsed.answeredCount),
  PRIORITY_COUNT: String(waiting.length), PRIORITY_OPEN: String(waiting.length),
  RELEASE_COUNT: String(L.l), CANDIDATE_COUNT: String(L.c), NOTPLANNED_COUNT: String(L.n),
  UPDATED: updated, LEDE_ONE: ledeOne, FOUND_SENTENCE: found, BUILT: built, DATA_JSON: dataJson,
};
const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in fill)) fail(`template placeholder {{${k}}} has no value`);
  return fill[k];
});

// 5. Owner-facing word check on the finished page
const hits = forbiddenWords(html.replace(/<script id="data"[\s\S]*?<\/script>/, (s) => s));
if (hits.length) {
  console.error('✗ excluded words in the generated page:');
  for (const h of hits) console.error(`  line ${h.line} [${h.label}]: ${h.text}`);
  process.exit(1);
}
console.log('✓ no excluded words (Stripe, Claude, AI, workshop, customer, "as today", "already handles")');

if (CHECK_ONLY) { console.log(`✓ --check: nothing written (${storeNote})`); process.exit(0); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
fs.writeFileSync(OUT, html);
console.log(`✓ wrote ${path.relative(root, OUT)} (${html.length.toLocaleString()} bytes${before ? `, ${before === html ? 'unchanged' : 'changed'}` : ''}); ${storeNote}`);
