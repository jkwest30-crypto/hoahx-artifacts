#!/usr/bin/env node
/**
 * Publishes the data behind /scope/ (HOAhx · Beyond the proposal): copies the
 * a-la-carte JSON built by the HOAhx repo into go-live/scope/data.json after
 * checking it. The pages themselves (index, packages, features, review) are
 * authored in this repo and read data.json at load.
 *
 *   npm run publish:scope -- --source ../hoahx/go-live-scope-data.json
 *   npm run publish:scope -- --check          # verify only, write nothing
 *
 * Build the source in the HOAhx repo first:
 *   python3 docs/launch/scripts/build-a-la-carte.py --out docs/launch/a-la-carte-<date>.xlsx --json <path>
 *
 * Refuses to write if the data is malformed, a package names a feature that is
 * not in it, a page links to a file that is not on this site, or a word the
 * owner-facing documents exclude appears in the data or the pages.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'go-live/scope/data.json';
const checkOnly = args.includes('--check');
const source = resolve(root, sourceArg);
const target = resolve(root, 'go-live/scope/data.json');
const pagesDir = resolve(root, 'go-live/scope');

function fail(message) { console.error(`publish-scope: ${message}`); process.exit(1); }

if (!existsSync(source)) fail(`source not found: ${source}`);
let data;
try { data = JSON.parse(readFileSync(source, 'utf8')); } catch (e) { fail(`source is not valid JSON: ${e.message}`); }
for (const k of ['generated', 'baseline', 'rate', 'hoursPerDay', 'stages', 'recommendation', 'core', 'candidates', 'declined', 'inScope', 'packages']) {
  if (!(k in data)) fail(`data has no "${k}"`);
}
const ids = new Set([...data.core, ...data.candidates].map((i) => i.id));
for (const p of data.packages) {
  for (const id of p.items) if (!ids.has(id)) fail(`package ${p.id} names ${id}, which is not a feature on the pages`);
  if (typeof p.jake !== 'number') fail(`package ${p.id} has no numeric estimate`);
}
for (const i of [...data.core, ...data.candidates]) if (typeof i.jake !== 'number') fail(`${i.id} has no numeric estimate`);

const excluded = /\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/;
const dataText = JSON.stringify(data);
const hitData = dataText.match(excluded);
if (hitData) fail(`excluded word "${hitData[0]}" appears in the data`);
for (const f of readdirSync(pagesDir).filter((n) => n.endsWith('.html') || n.endsWith('.js'))) {
  const text = readFileSync(resolve(pagesDir, f), 'utf8');
  const hit = text.match(excluded);
  if (hit) fail(`excluded word "${hit[0]}" appears in ${f}`);
  if (/localhost|client-walkthrough/.test(text)) fail(`${f} links to a file that is not on this site`);
}

console.log(`${data.core.length} core, ${data.candidates.length} candidates, ${data.declined.length} set aside, ${data.inScope.length} in scope, ${data.packages.length} packages; generated ${data.generated}; baseline ${data.baseline}, $${data.rate}/h, ${data.hoursPerDay} h/day`);
if (checkOnly) { console.log('check only; nothing written'); process.exit(0); }
const out = JSON.stringify(data, null, 1);
if (existsSync(target) && readFileSync(target, 'utf8') === out && resolve(source) === resolve(target)) { console.log('go-live/scope/data.json is already current'); process.exit(0); }
writeFileSync(target, out);
console.log(`wrote go-live/scope/data.json (${out.length} bytes)`);
