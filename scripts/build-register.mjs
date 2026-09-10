#!/usr/bin/env node
// Build the published Decision Register page from the launch program's decisions.md.
//
//   node scripts/build-register.mjs [--source <decisions.md>] [--out <html>] [--site <url>]
//        [--snapshot-dir <dir>] [--date "September 9, 2026"] [--key <passphrase>]
//        [--offline] [--allow-orphans] [--check]
//
// What it guarantees before it writes anything:
//   1. decisions.md parses cleanly: every entry has an Area, Why, Today, Question, Answer,
//      Answered; ids and codes are unique; every entry sits under an area header.
//   2. The live shared store is fetched and snapshotted to --snapshot-dir (default:
//      <decisions.md's folder>/register-store), so the owners' marks and notes are on disk
//      before the page changes. --offline skips this (and says so).
//   3. No live mark or note in the store points at an id the new page does not have. If one
//      does, the build stops and lists them; --allow-orphans overrides (the snapshot still
//      holds them).
//   4. The generated page contains none of the words the owner-facing documents exclude.
// --check runs all of that and writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseDecisions, fetchStore, snapshotStore, isLive, forbiddenWords, DEFAULT_SITE } from './register-lib.mjs';

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
const parsed = parseDecisions(md, path.basename(SOURCE));
if (parsed.problems.length) fail('decisions.md has problems:\n  ' + parsed.problems.join('\n  '));
const { domains, questions } = parsed;
const ids = new Set(questions.map((x) => x.id));
const total = questions.length;
const priority = questions.filter((x) => x.p);
const priorityOpen = priority.filter((x) => !x.pd).length;
console.log(`✓ ${path.basename(SOURCE)}: ${total} decisions in ${domains.length} areas, ${parsed.answeredCount} planned (answered on the record), ${priority.length} money-and-enforcement (${priorityOpen} open), ${questions.filter((x) => x.plan).length} with a Planned line`);
if (parsed.headerCount && (parsed.headerCount.answered !== parsed.answeredCount || parsed.headerCount.total !== total)) {
  console.warn(`  ! header says "Answers: ${parsed.headerCount.answered} of ${parsed.headerCount.total}" but the entries say ${parsed.answeredCount} of ${total}; fix the header`);
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
const ledeOne = `${total} decisions the software has already made on the business's behalf: 109 found by reading the code that runs today — not the specification, and not what anyone intended — ${extra > 0 ? `plus ${extra === 1 ? 'one follow-up question' : word(extra) + ' follow-up questions'} added since, ` : ''}all brought into line with the launch proposal, the launch plan, and the NMI Integration Plan of September 3, 2026. Some will be exactly right. Some will be wrong. Until each is confirmed, nobody can say which.`;
const found = extra > 0
  ? `${total} decisions: 109 found on September 4, 2026, ${extra === 1 ? 'and one follow-up question' : `and ${word(extra)} follow-up questions`} added as your answers raised ${extra === 1 ? 'it' : 'them'}.`
  : `${total} decisions, found on September 4, 2026.`;
const updated = args.date || longDate();
const built = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) + ' MT';

const fill = {
  TOTAL: String(total), PLANNED: String(parsed.answeredCount), PRIORITY_COUNT: String(priority.length),
  PRIORITY_OPEN: String(priorityOpen), UPDATED: updated, LEDE_ONE: ledeOne, FOUND_SENTENCE: found, BUILT: built, DATA_JSON: dataJson,
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
