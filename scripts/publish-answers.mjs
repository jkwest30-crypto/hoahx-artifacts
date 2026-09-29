#!/usr/bin/env node
/**
 * The one command that keeps the owners' open questions page current (served at the site root
 * and at /answers). It reads the launch program in the HOAhx repo and writes the two files the
 * page reads, go-live/answers/data.json and go-live/answers/screens.json.
 *
 *   npm run sync:answers                     # the whole thing, against ../hoahx and the live store
 *   npm run sync:answers -- --hoahx <path>   # another checkout of the HOAhx repo
 *   npm run sync:answers -- --dry-run        # everything but the writing: shows what would change
 *   npm run sync:answers -- --screens-ref <ref>  # read the screens at another ref, to see what the
 *                                            # page will say once a branch has landed (with --dry-run)
 *   npm run check:answers                    # verify the committed page and files, read nothing else
 *   npm run publish:answers                  # the same command as sync:answers, under its old name
 *
 * In order:
 *   1. snapshots the live store into <hoahx>/docs/launch/register-store/ (the owners' words are
 *      copied before anything about the page changes; --site and --key choose the store,
 *      --skip-snapshot is for a machine with no network and says so loudly)
 *   2. drops the questions whose entry in decisions.md is no longer pending
 *   3. rebuilds the list of screens from the spec and the preview modules, and links the film of
 *      each screen, leaving off (and naming) any whose screen has changed since it was filmed,
 *      whose take is not in Drive, or whose Drive file is not readable by link
 *   4. resolves every video number to its title, length and Drive link, and refuses a video that
 *      was never recorded, is not current, or has no file in Drive
 *   5. runs the guards: the words the owner-facing documents exclude, and every mark of the
 *      internal numbering, in the page and in both published files
 *   6. writes the two files and prints what changed
 *
 * It never commits and never pushes: a push to main is what puts the page in front of the owners.
 *
 * Inputs, all under <hoahx>: docs/launch/recommendations.json (the wording),
 * docs/launch/screen-review.json (the screens' descriptions and internal mapping),
 * docs/launch/decisions.md (which entries are pending), and docs/launch/owners-questions/sync.json
 * (which git ref the screens and the videos are read at, the recorder's manifest, the Drive
 * folder). Tracked files are read from a git ref, never from a working tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRITICAL_WINDOW_DAYS, addWorkingDays, buildPublished, buildQuestions, buildScreens, checkPublished, checkSource, describeChange,
  criticalForEntries, criticalForScreen, guardPublished, parseBlocks, parseMilestones, parseRegister, parseScreenLinks, parseTaskMilestones, parseScreensSpec, previewClosure, previewCode, resolveVideos,
  resolveWalkthroughs, screenFingerprint, videoNumbers,
} from './answers-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name, dflt) => (has(name) ? args[args.indexOf(name) + 1] : dflt);
const pagesDir = resolve(root, 'go-live/answers');
const dataTarget = join(pagesDir, 'data.json');
const screensTarget = join(pagesDir, 'screens.json');

function fail(message) { console.error(`sync-answers: ${message}`); process.exit(1); }
const readJson = (path, what) => {
  if (!existsSync(path)) fail(`${what} not found: ${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return fail(`${what} is not valid JSON: ${e.message}`); }
};
const readPublished = () => (existsSync(dataTarget) && existsSync(screensTarget)
  ? { data: JSON.parse(readFileSync(dataTarget, 'utf8')), screens: JSON.parse(readFileSync(screensTarget, 'utf8')) }
  : null);

/**
 * The page as it stands: nothing an owner must not read. A check reads the two published files
 * too; a sync guards the ones it is about to write instead of the ones it is about to replace.
 */
function guardPage(withJson) {
  const names = readdirSync(pagesDir).filter((n) => (withJson ? /\.(html|js|css|json)$/ : /\.(html|js|css)$/).test(n));
  for (const name of names) {
    try { guardPublished(`go-live/answers/${name}`, readFileSync(join(pagesDir, name), 'utf8')); } catch (e) { fail(e.message); }
  }
  return names;
}

if (has('--check')) {
  const pub = readPublished();
  if (!pub) fail('go-live/answers/data.json or screens.json is missing');
  let n;
  try { n = checkPublished(pub.data, pub.screens); } catch (e) { fail(e.message); }
  const names = guardPage(true);
  console.log(`${n.rows} questions (${n.critical.rows} critical) on ${n.cards} cards, ${n.screens} screens (${n.critical.screens} critical), ${n.videos} videos linked; last updated ${pub.data.updated}`);
  console.log(`guards passed on ${names.join(', ')}`);
  console.log('check only; nothing written');
  process.exit(0);
}

const hoahx = resolve(root, opt('--hoahx', '../hoahx'));
if (!existsSync(join(hoahx, 'docs/launch'))) fail(`no launch program at ${hoahx}/docs/launch (pass --hoahx <path to the HOAhx checkout>)`);
const config = readJson(join(hoahx, 'docs/launch/owners-questions/sync.json'), 'the sync settings');
const git = (...a) => execFileSync('git', ['-C', hoahx, ...a], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();
const revOf = (ref) => { try { return git('rev-parse', '--short', ref).trim(); } catch (e) { return fail(`the git ref "${ref}" does not exist in ${hoahx}; set it in docs/launch/owners-questions/sync.json`); } };
const today = opt('--today', new Date().toLocaleDateString('en-CA'));

/**
 * Does this Drive link open for someone who was only given the link? A file that was never
 * shared answers 401 and shows a sign-in page, which is what an owner would meet. Asking is
 * the difference between a link and a dead end, and nothing else on this page checks it.
 * Anything other than a clear yes is treated as no: a link we cannot vouch for is not published.
 */
async function linkReadable(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return res.status === 200;
  } catch (e) {
    console.warn(`     could not open ${url} (${e.message})`);
    return false;
  }
}

// 1 · the owners' words first
if (has('--skip-snapshot')) {
  console.warn('sync-answers: SNAPSHOT SKIPPED (--skip-snapshot). The live store was not copied before this run.');
} else {
  const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
  const key = opt('--key', process.env.DECISION_EDIT_KEY || '');
  let res;
  try { res = await fetch(`${site}/api/answers?full=1${key ? '&key=' + encodeURIComponent(key) : ''}`, { headers: key ? { 'x-edit-key': key } : {} }); } catch (e) { fail(`the store at ${site} could not be reached (${e.message}); nothing was written`); }
  if (res.status === 401) fail('the store asked for the passphrase: pass --key or set DECISION_EDIT_KEY');
  if (!res.ok) fail(`the store at ${site} answered ${res.status}; nothing was written`);
  const all = await res.json();
  const dir = join(hoahx, 'docs/launch/register-store');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const file = join(dir, `answers-store-${stamp}.json`);
  if (!has('--dry-run')) writeFileSync(file, JSON.stringify({ pulledAt: new Date().toISOString(), site, records: all }, null, 1));
  const liveCount = Object.values(all).filter((r) => r && (r.v || (r.n && String(r.n).trim()))).length;
  console.log(`1 · snapshot: ${Object.keys(all).length} records, ${liveCount} live${has('--dry-run') ? ' (dry run: not written)' : ' -> ' + file}`);
}

// 2 · the questions still waiting
const source = readJson(resolve(root, opt('--source', join(hoahx, 'docs/launch/recommendations.json'))), 'the wording source');
let counts;
try { counts = checkSource(source); } catch (e) { fail(e.message); }
const registerPath = resolve(root, opt('--register', join(hoahx, 'docs/launch/decisions.md')));
if (!existsSync(registerPath)) fail(`decisions.md not found: ${registerPath}`);
const { all: entries, pending } = parseRegister(readFileSync(registerPath, 'utf8'));
for (const c of source.cards) for (const d of c.decisions) if (!entries.has(d.id)) fail(`${d.id} (card ${c.id}) is not an entry in decisions.md`);
const answeredButOpen = config.answeredButOpen || [];
// what is critical, from the plan: see "what is critical" in answers-lib.mjs
const readText = (rel) => { const p = join(hoahx, rel); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
const registerText = readFileSync(registerPath, 'utf8');
const milestones = parseMilestones(readText('docs/launch/plan.md'), readText('docs/launch/status.md'));
const plan = { milestones, taskMilestone: parseTaskMilestones(readText('docs/launch/backlog.md')), today, windowDays: CRITICAL_WINDOW_DAYS };
const blocksOf = parseBlocks(registerText);
if (!Object.keys(milestones).length) fail('no milestones could be read from docs/launch/plan.md, so nothing can be judged critical; nothing was written');
const questions = buildQuestions(source, { pending, answeredButOpen, criticalOf: (ids) => criticalForEntries(ids, blocksOf, plan) });
const onCards = new Set(source.cards.flatMap((c) => c.decisions.map((d) => d.id)));
const unasked = [...pending].filter((id) => !onCards.has(id));
console.log(`2 · questions: ${questions.rows} of ${counts.lines} lines still waiting, on ${questions.cards.length} cards, ${questions.critical} critical (blocking something due by ${addWorkingDays(today, CRITICAL_WINDOW_DAYS)})`);
for (const d of questions.dropped) console.log(`    dropped ${d.id}: ${d.why}`);
if (unasked.length) console.warn(`    pending in decisions.md but on no card: ${unasked.join(', ')}`);

// 3 · the screens
if (!has('--no-fetch')) { try { git('fetch', '--quiet', 'origin'); } catch (e) { console.warn('sync-answers: could not fetch origin; reading the refs as they are on this machine'); } }
const screensRef = opt('--screens-ref', config.screens.ref);
const screensRev = revOf(screensRef);
const spec = parseScreensSpec(git('show', `${screensRef}:${config.screens.spec}`));
const previewFiles = git('ls-tree', '-r', '--name-only', screensRef, '--', 'src').split('\n').filter((f) => f.endsWith('.preview.ts'));
const moduleOf = new Map();
for (const f of previewFiles) { const c = previewCode(git('show', `${screensRef}:${f}`)); if (c) moduleOf.set(c, f); }
const built = [...moduleOf.keys()];
const screensSource = readJson(resolve(root, opt('--screens', join(hoahx, 'docs/launch/screen-review.json'))), 'the screens source');

// 3b · the film of each screen. It is linked only when the screen is the one that was filmed,
// which is decided by content: the preview module and everything it imports relatively, at the
// ref the page reads and at the commit the take was filmed from.
const walkCfg = config.walkthroughs || null;
const walkPath = walkCfg && join(hoahx, walkCfg.manifest);
let walkthroughs = {};
if (walkCfg && existsSync(walkPath)) {
  const manifest = readJson(walkPath, 'the walk-through manifest');
  const filmRef = manifest.commit;
  revOf(filmRef);
  const treeAt = (ref) => new Set(git('ls-tree', '-r', '--name-only', ref, '--', 'src').split('\n').filter(Boolean));
  const at = (ref) => {
    const tree = treeAt(ref);
    return {
      exists: (f) => tree.has(f),
      read: (f) => { try { return git('show', `${ref}:${f}`); } catch (e) { return null; } },
      hashOf: (f) => { try { return git('rev-parse', '--verify', '--quiet', `${ref}:${f}`).trim() || 'missing'; } catch (e) { return 'missing'; } },
    };
  };
  const now = at(screensRef), then = at(filmRef);
  const fingerprintAt = (side, code) => {
    const module = moduleOf.get(code) || (manifest.walkthroughs.find((w) => w.code === code) || {}).module;
    if (!module) return 'no module';
    return screenFingerprint(previewClosure(module, side), side.hashOf);
  };
  const current = (code) => fingerprintAt(now, code) === fingerprintAt(then, code);
  let driveFiles;
  try { driveFiles = JSON.parse(execFileSync('rclone', ['lsjson', walkCfg.drive, '--files-only'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).toString()); } catch (e) { fail(`the Drive folder ${walkCfg.drive} could not be listed (${String(e.message).split('\n')[0]}); no screen video can be checked, nothing was written`); }
  // Readability is the last gate and the only one that needs the network, so it is asked only
  // about the links that would otherwise be used: resolve once trusting every link, check those,
  // then resolve again for real. resolveWalkthroughs is pure, so running it twice costs nothing.
  const codes = spec.flatMap((f) => f.screens.map((x) => x.code));
  const would = resolveWalkthroughs(codes, { manifest, driveFiles, current, readable: () => true });
  const readable = new Map();
  if (has('--trust-drive-links')) {
    console.warn('     --trust-drive-links: the Drive links were NOT opened to check the owners can see them');
    for (const [, w] of Object.entries(would.walkthroughs)) readable.set(w.url, true);
  } else {
    await Promise.all(Object.values(would.walkthroughs).map(async (w) => {
      readable.set(w.url, await linkReadable(w.url));
    }));
  }
  const out = resolveWalkthroughs(codes, { manifest, driveFiles, current, readable: (url) => readable.get(url) === true });
  walkthroughs = out.walkthroughs;
  const n = Object.keys(walkthroughs).length;
  console.log(`3b · screen videos: ${n} linked, filmed from ${filmRef}, each current at ${screensRef} and readable by link`);
  for (const r of out.refused) console.log(`     not linked — ${r}`);
} else if (walkCfg) {
  console.log(`3b · screen videos: none (no manifest at ${walkCfg.manifest})`);
}

const ledBy = parseScreenLinks(git('show', `${screensRef}:${config.screens.spec}`));
const signOff = milestones.M17;
let screens;
try { screens = buildScreens(screensSource, spec, built, config.screens.expected, walkthroughs, (code, entry) => criticalForScreen(code, entry, { blocksOf, ledBy }, plan, signOff)); } catch (e) { fail(e.message); }
console.log(`3 · screens: ${screens.total} (${screens.critical} critical) from ${config.screens.spec} at ${screensRef} (${screensRev}), ${previewFiles.length} preview modules`);

// 4 · the videos
const numbers = videoNumbers(questions, screens);
let videos = {};
if (numbers.length) {
  const v = config.videos;
  const videosRev = revOf(v.ref);
  const manifest = readJson(join(hoahx, v.manifest), "the recorder's manifest");
  const storyboard = JSON.parse(git('show', `${v.ref}:${v.storyboard}`));
  const hashOf = (file) => { try { return git('rev-parse', '--verify', '--quiet', `${v.ref}:${file}`).trim() || 'missing'; } catch (e) { return 'missing'; } };
  let driveFiles;
  try { driveFiles = JSON.parse(execFileSync('rclone', ['lsjson', v.drive, '--files-only'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }).toString()); } catch (e) { fail(`the Drive folder ${v.drive} could not be listed (${String(e.message).split('\n')[0]}); no video link can be checked, nothing was written`); }
  try { videos = resolveVideos(numbers, { manifest, storyboard, hashOf, driveFiles }); } catch (e) { fail(e.message); }
  console.log(`4 · videos: ${Object.keys(videos).length} linked (${Object.keys(videos).join(', ')}), current at ${v.ref} (${videosRev}), each with a file in ${v.drive}`);
} else console.log('4 · videos: none named');

// 5 · the guards
const previous = readPublished();
const next = buildPublished({ questions, screens, videos, today, previous });
const dataOut = JSON.stringify(next.data, null, 1);
const screensOut = JSON.stringify(next.screens, null, 1);
try {
  checkPublished(next.data, next.screens);
  guardPublished('data.json', dataOut);
  guardPublished('screens.json', screensOut);
} catch (e) { fail(e.message); }
const names = guardPage(false);
console.log(`5 · guards passed on data.json, screens.json, ${names.join(', ')}`);

// 6 · the two files
const changes = describeChange(previous, next);
const same = previous && JSON.stringify(previous.data, null, 1) === dataOut && JSON.stringify(previous.screens, null, 1) === screensOut;
if (same) { console.log(`6 · nothing changed; the page still reads "Last updated ${next.data.updated}"`); process.exit(0); }
console.log(`6 · ${changes.length} change${changes.length === 1 ? '' : 's'}; last updated ${next.data.updated}`);
for (const line of changes.slice(0, 60)) console.log(`    ${line}`);
if (changes.length > 60) console.log(`    … and ${changes.length - 60} more`);
if (has('--dry-run')) { console.log('dry run; nothing written'); process.exit(0); }
writeFileSync(dataTarget, dataOut);
writeFileSync(screensTarget, screensOut);
console.log(`wrote go-live/answers/data.json (${dataOut.length} bytes) and screens.json (${screensOut.length} bytes). Not committed, not pushed.`);
