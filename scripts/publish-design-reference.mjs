#!/usr/bin/env node
/**
 * Copies the HOAhx repo's design reference into go-live/design/ so Netlify serves
 * it at /design/ with its three downloadable files beside it. The page is built in
 * the HOAhx repo by docs/design/build-reference.py from tokens.json,
 * prompt-preamble.md and the route registry; DESIGN_BRIEF.md is the long form.
 *
 *   npm run publish:design -- --source ../hoahx/docs/design
 *   npm run publish:design -- --check        # verify only, write nothing
 *
 * Refuses to write if a file is missing, the page links to a file that is not
 * published beside it, or a page contains a word the owner-facing documents
 * exclude. "AI" is allowed only inside the two product labels the route table
 * carries verbatim from the code ("AI Assistant", "AI Insights").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : '../hoahx/docs/design';
const checkOnly = args.includes('--check');
const source = resolve(root, sourceArg);
const target = resolve(root, 'go-live/design');

const FILES = [
  ['design-reference.html', 'index.html'],
  ['tokens.json', 'tokens.json'],
  ['DESIGN_BRIEF.md', 'DESIGN_BRIEF.md'],
  ['prompt-preamble.md', 'prompt-preamble.md'],
];

function fail(message) {
  console.error(`publish-design-reference: ${message}`);
  process.exit(1);
}

for (const [from] of FILES) {
  if (!existsSync(join(source, from))) fail(`source file missing: ${join(source, from)}`);
}

const html = readFileSync(join(source, 'design-reference.html'), 'utf8');
const excluded = /\bStripe\b|\bClaude\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/;
for (const [from] of FILES) {
  if (from === 'tokens.json') continue;
  const text = readFileSync(join(source, from), 'utf8');
  const hit = text.match(excluded);
  if (hit) fail(`excluded word "${hit[0]}" appears in ${from}`);
  const ai = text.replace(/AI Assistant|AI Insights|ai_assistant|ai-assistant|ai-insights/g, '').match(/\bAI\b/);
  if (ai) fail(`"AI" appears in ${from} outside the two product labels`);
}

// Every relative file the page links to must be published beside it.
const linked = new Set([...html.matchAll(/href="([^"#:]+)"/g)].map(m => m[1]));
const published = new Set(FILES.map(([, to]) => to));
for (const href of linked) {
  if (!published.has(href)) fail(`the page links to "${href}", which is not published in go-live/design/`);
}
if (/localhost|claude\.ai\/code\/artifact/.test(html)) fail('the page links to a location that is not this site');

console.log(`design reference: ${html.length} bytes; ${[...linked].join(', ')} linked and present`);
if (checkOnly) {
  console.log('check only; nothing written');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
let changed = 0;
for (const [from, to] of FILES) {
  const src = join(source, from), dst = join(target, to);
  const same = existsSync(dst) && readFileSync(src).equals(readFileSync(dst));
  if (same) continue;
  copyFileSync(src, dst);
  changed += 1;
  console.log(`wrote go-live/design/${to} (${statSync(dst).size} bytes)`);
}
console.log(changed ? `${changed} file(s) updated` : 'go-live/design/ is already current');
