#!/usr/bin/env node
/**
 * Copies the HOAhx repo's built demo comparison into go-live/demo/ so Netlify
 * serves it at /demo/. The page is built there by scripts/build-prototype-comparison.cjs
 * from the Demo Feature Register (docs/prototype/features.md); its data is embedded.
 * Two plain-text files travel with it for the owners' ChatGPT project: the list of
 * what the app does now (app-today.md) and the instructions to paste into the
 * project (prompt-preamble.md).
 *
 *   npm run publish:prototype -- --source ../hoahx/docs/prototype
 *   npm run publish:prototype -- --check        # verify only, write nothing
 *
 * Refuses to write if the page has no embedded data, a file is missing, the page
 * links to something not on this site, or a file contains a word the owner-facing
 * documents exclude (the demo's own product label "HOAhx AI" is allowed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenWords } from './register-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : '../hoahx/docs/prototype';
const checkOnly = args.includes('--check');
const source = resolve(root, sourceArg);
const targetDir = resolve(root, 'go-live/demo');

const FILES = [
  ['prototype-comparison.html', 'index.html'],
  ['app-today.md', 'app-today.md'],
  ['prompt-preamble.md', 'prompt-preamble.md'],
];
const ALLOWED_LABELS = /HOAhx AI|AI Assistant|AI Insights/g;

function fail(message) {
  console.error(`publish-prototype: ${message}`);
  process.exit(1);
}

if (!existsSync(source)) fail(`source folder not found: ${source}`);
const texts = new Map();
for (const [from] of FILES) {
  const file = resolve(source, from);
  if (!existsSync(file)) fail(`missing ${from} in ${source}; run \`node scripts/build-prototype-comparison.cjs\` in the HOAhx repo first`);
  texts.set(from, readFileSync(file, 'utf8'));
}

const html = texts.get('prototype-comparison.html');
const embedded = html.match(/<script id="prototype-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!embedded) fail('the page has no embedded comparison data; run `node scripts/build-prototype-comparison.cjs` in the HOAhx repo first');
let data;
try {
  data = JSON.parse(embedded[1]);
} catch (error) {
  fail(`embedded comparison data is not valid JSON: ${error.message}`);
}
if (!Array.isArray(data.features) || !data.features.length) fail('embedded data has no features');

for (const [from, text] of texts) {
  const hits = forbiddenWords(text.replace(ALLOWED_LABELS, ''));
  if (hits.length) fail(`excluded word "${hits[0].label}" appears in ${from} (line ${hits[0].line}): ${hits[0].text}`);
}
if (/client-walkthrough|localhost|claude\.ai\/code\/artifact|chatgpt\.site/.test(html)) fail('the page links to something that is not on this site');
// Static links in the markup (outside the page's scripts) must point at this site.
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
for (const m of markup.matchAll(/href="([^"#]+)/g)) {
  const href = m[1];
  if (/^(https?:)?\/\//.test(href) || href.startsWith('data:')) continue;
  if (!['/', '/workflow-map', '/design/', 'app-today.md', 'prompt-preamble.md'].includes(href)) fail(`the page links to "${href}", which is not published on this site`);
}
// Links the page renders from its data all go to the workflow map on this site.
for (const item of [...data.features.flatMap((f) => f.app || []), ...(data.appOnly || [])]) {
  if (item.href && !item.href.startsWith('/workflow-map#')) fail(`a card links to "${item.href}", which is not the workflow map on this site`);
}

console.log(`demo v${data.demo.version} (${data.demo.date}) vs app ${data.app.branch}: ${data.features.length} features (${data.counts.demoOnly} demo only, ${data.counts.both} in both), ${data.counts.appOnly} app-only items; built ${data.generated}`);
if (checkOnly) {
  console.log('check only; nothing written');
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
let wrote = 0;
for (const [from, to] of FILES) {
  const target = resolve(targetDir, to);
  const next = texts.get(from);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === next) continue;
  writeFileSync(target, next);
  wrote++;
  console.log(`wrote go-live/demo/${to} (${next.length.toLocaleString('en-US')} bytes)`);
}
if (!wrote) console.log('go-live/demo/ is already current');
