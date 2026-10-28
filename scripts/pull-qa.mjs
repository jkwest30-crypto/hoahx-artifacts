#!/usr/bin/env node
/**
 * Reads one run of the hands-on checks from the /qa shared store (GET /api/qa?full=1, with the
 * passphrase from the QA_KEY environment variable) and writes it back to the launch program in
 * the shape of the contract's "How results come back" (docs/launch/qa/README.md):
 *
 *   <out>/<run>.md            the run header, a table of every card in the run's scope with its
 *                             outcome, tester and notes, then Passed (evidence lines), Not provable,
 *                             Failed (drafted Open-defect rows with F??, for /wrap to number) and
 *                             Blocked
 *   <out>/<run>/QA-###-<n>.<ext>   the screenshots, in the order the tester attached them
 *   <out>/<run>.store.json    the raw store snapshot the file was written from (no sign-in details:
 *                             the store never returns them in this read)
 *
 *   npm run pull:qa -- --run 2026-09-28-m8 --out ../hoahx/docs/launch/qa/runs/
 *   npm run pull:qa -- --run <id> --site http://localhost:8788 --out <dir> [--data <data.json>]
 *
 * The cards are read from the site's /qa/data.json (what the tester saw), else from this repo's
 * go-live/qa/data.json; --data names another file. A result on a card that is no longer on the
 * page is still listed, marked as such. It never writes to the store.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) && args[args.indexOf(name) + 1] && !args[args.indexOf(name) + 1].startsWith('--') ? args[args.indexOf(name) + 1] : dflt);
const run = opt('--run', '');
const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
const out = opt('--out', '');
const dataArg = opt('--data', '');
const key = process.env.QA_KEY || '';

function fail(m) { console.error(`pull-qa: ${m}`); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(run)) fail('pass --run <YYYY-MM-DD-short-name>');
if (!out) fail('pass --out <directory>, e.g. ../hoahx/docs/launch/qa/runs/');
// QA_KEY is optional: with no passphrase on the site (Jacob, 2026-10-09) the results are open.
const headers = key ? { 'x-edit-key': key } : {};
async function getJson(url, what) {
  const res = await fetch(url, { headers });
  if (res.status === 401) fail(`${what}: the site has a passphrase; set QA_KEY in this shell`);
  if (res.status === 403) fail(`${what}: refused by the site (403)`);
  if (!res.ok) fail(`${what}: ${res.status} from ${url.split('?')[0]}`);
  return res.json();
}

// ── the cards ────────────────────────────────────────────────────────────
let data = null, dataFrom = '';
if (dataArg) { data = JSON.parse(readFileSync(resolve(dataArg), 'utf8')); dataFrom = dataArg; }
else {
  try { const r = await fetch(site + '/qa/data.json'); if (r.ok) { data = await r.json(); dataFrom = site + '/qa/data.json'; } } catch (e) { /* offline: fall back */ }
  if (!data) { const p = resolve(root, 'go-live/qa/data.json'); if (existsSync(p)) { data = JSON.parse(readFileSync(p, 'utf8')); dataFrom = 'go-live/qa/data.json (this repo)'; } }
}
if (!data || !Array.isArray(data.cards)) fail('no data.json to read the cards from');
const cardById = new Map(data.cards.map((c) => [c.id, c]));
const featureTitle = (id) => ((data.features || []).find((f) => f.id === id) || {}).title || id;
const envLabel = (id) => ((data.environments || {})[id] || {}).label || id;

// ── the store ────────────────────────────────────────────────────────────
const snap = await getJson(site + '/api/qa?full=1', 'reading the store');
const header = (snap.runs || {})[run];
if (!header) fail(`run ${run} is not in the store (runs there: ${Object.keys(snap.runs || {}).sort().join(', ') || 'none'})`);
const results = (snap.results || {})[run] || {};
const submission = (snap.submissions || {})[run] || null;

const scope = header.scope || { type: 'all', value: '' };
const inScope = (c) => scope.type === 'feature' ? c.feature === scope.value : scope.type === 'milestone' ? c.milestone === scope.value : true;
const scopeText = scope.type === 'feature' ? `Feature: ${featureTitle(scope.value)} (${scope.value})` : scope.type === 'milestone' ? `Milestone ${scope.value}` : 'All cards';
const scoped = data.cards.filter(inScope).map((c) => c.id);
const extra = Object.keys(results).filter((id) => !scoped.includes(id) && results[id].outcome).sort();
const ids = [...scoped, ...extra];

// ── screenshots ──────────────────────────────────────────────────────────
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const outDir = resolve(out);
const shotDir = join(outDir, run);
const shotPaths = {};
let downloaded = 0;
for (const id of ids) {
  const r = results[id];
  if (!r || !Array.isArray(r.shots) || !r.shots.length) continue;
  shotPaths[id] = [];
  for (let n = 0; n < r.shots.length; n++) {
    const sid = r.shots[n];
    if (!/^[a-f0-9]{24}$/.test(sid)) continue;
    const shot = await getJson(site + '/api/qa?shot=' + sid, `screenshot ${sid}`);
    const ext = EXT[shot.mime];
    if (!ext || typeof shot.data !== 'string') { console.warn(`pull-qa: screenshot ${sid} on ${id} is not an image; skipped`); continue; }
    mkdirSync(shotDir, { recursive: true });
    const file = `${id}-${n + 1}.${ext}`;
    writeFileSync(join(shotDir, file), Buffer.from(shot.data, 'base64'));
    shotPaths[id].push(`${run}/${file}`);
    downloaded += 1;
  }
}

// ── the run file ─────────────────────────────────────────────────────────
const OUT = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', 'not-provable': 'Not provable', '': 'Not run' };
const cell = (s) => String(s == null ? '' : s).replace(/\r?\n+/g, ' / ').replace(/\|/g, '\\|').trim();
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const testerOf = (r) => (r && r.tester) || header.tester || '?';
const build = header.build || '?';
const tag = (r) => `run ${run} (${testerOf(r)}, build ${build})`;
const titleOf = (id) => (cardById.get(id) || {}).title || '(not on the page now)';

const lines = [
  `# Hands-on checks · run ${run}`,
  '',
  `Pulled ${new Date().toISOString()} from ${site}/qa · cards from ${dataFrom}. For /wrap: evidence lines to status.md, drafted defects to backlog.md's Open table with the next F numbers.`,
  '',
  '| Run | |',
  '|---|---|',
  `| Run | ${cell(run)} |`,
  `| Environment | ${cell(envLabel(header.env))} (${cell(header.env)}) |`,
  `| Build | ${cell(build)} |`,
  `| Date | ${cell(header.date || run.slice(0, 10))} |`,
  `| Test accounts reset | ${cell(header.seedReset || 'not recorded')} |`,
  `| Tester | ${cell(header.tester)} |`,
  `| Device and browser | ${cell(header.device || 'not recorded')} |`,
  `| Cards | ${cell(scopeText)} · ${scoped.length} on the page |`,
  `| Started | ${cell(header.createdAt || '')} |`,
  `| Sent | ${submission ? cell(submission.updatedAt) : 'not sent (the results below are the live state)'} |`,
  '',
  '## Results',
  '',
  '| Card | Title | Outcome | Tester | Notes | Screenshots |',
  '|---|---|---|---|---|---|',
];
const counts = { pass: 0, fail: 0, blocked: 0, 'not-provable': 0, '': 0 };
for (const id of ids) {
  const r = results[id] || { outcome: '' };
  counts[r.outcome || ''] += 1;
  lines.push(`| ${id} | ${cell(titleOf(id))}${scoped.includes(id) ? '' : ' (outside the run\'s cards)'} | ${OUT[r.outcome || '']} | ${r.outcome ? cell(testerOf(r)) : ''} | ${cell(r.notes)} | ${(shotPaths[id] || []).join(', ')} |`);
}
lines.push('', `${counts.pass} pass · ${counts.fail} fail · ${counts.blocked} blocked · ${counts['not-provable']} not provable · ${counts['']} not run, of ${ids.length}`, '');

const by = (o) => ids.filter((id) => (results[id] || {}).outcome === o);
lines.push('## Passed', '');
const passed = by('pass');
if (passed.length) passed.forEach((id) => lines.push(`- ${id} passed, ${tag(results[id])}`)); else lines.push('None.');
lines.push('', '## Not provable', '');
const np = by('not-provable');
if (np.length) np.forEach((id) => lines.push(`- ${id} not provable: ${oneLine(results[id].notes)}, ${tag(results[id])}`)); else lines.push('None.');
lines.push('', '## Failed', '');
const failed = by('fail');
if (failed.length) {
  lines.push('Drafted in the Open-defects shape; /wrap assigns the F numbers. The notes are the tester\'s words.', '', '| ID | Defect | Found by | Where | Est. h | Priority |', '|---|---|---|---|---|---|');
  for (const id of failed) {
    const r = results[id];
    const c = cardById.get(id) || {};
    const where = [c.start || '?', ...(c.complements || [])].join('; ');
    const shots = (shotPaths[id] || []).length ? ` Screenshots: ${shotPaths[id].join(', ')}.` : '';
    lines.push(`| F?? | **${cell(titleOf(id))}: ${cell(oneLine(r.notes))}**${shots} | Hands-on check ${id} (run ${run}, ${cell(testerOf(r))}, build ${cell(build)}) | ${cell(where)} | ? | Normal |`);
  }
} else lines.push('None.');
lines.push('', '## Blocked', '');
const blocked = by('blocked');
if (blocked.length) blocked.forEach((id) => lines.push(`- ${id} blocked: ${oneLine(results[id].notes)}, ${tag(results[id])}`)); else lines.push('None.');
if (submission && submission.text) lines.push('', '## As sent from the page', '', '```', submission.text, '```');
lines.push('');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${run}.md`), lines.join('\n'));
writeFileSync(join(outDir, `${run}.store.json`), JSON.stringify(snap, null, 1) + '\n');
console.log(`wrote ${join(out, run + '.md')}, ${join(out, run + '.store.json')}${downloaded ? ` and ${downloaded} screenshot${downloaded === 1 ? '' : 's'} under ${join(out, run)}/` : ''}`);
console.log(`${counts.pass} pass · ${counts.fail} fail · ${counts.blocked} blocked · ${counts['not-provable']} not provable · ${counts['']} not run, of ${ids.length}`);
