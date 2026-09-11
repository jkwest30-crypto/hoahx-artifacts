#!/usr/bin/env node
/**
 * Copies the HOAhx repo's built workflow map into go-live/ so Netlify serves it
 * at /workflow-map. The page is a single self-contained file; its data is
 * embedded by the HOAhx repo's scripts/build-workflow-map.cjs.
 *
 *   npm run publish:workflow-map -- --source ../hoahx/workflow-map.html
 *   npm run publish:workflow-map -- --check        # verify only, write nothing
 *
 * Refuses to write if the page has no embedded data, links to files that are
 * not on this site, or contains a word the owner-facing documents exclude.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : '../hoahx/workflow-map.html';
const checkOnly = args.includes('--check');
const source = resolve(root, sourceArg);
const target = resolve(root, 'go-live/workflow-map/workflow-map.html');

function fail(message) {
  console.error(`publish-workflow-map: ${message}`);
  process.exit(1);
}

if (!existsSync(source)) fail(`source not found: ${source}`);
const html = readFileSync(source, 'utf8');

const embedded = html.match(/<script id="workflow-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!embedded) fail('the page has no embedded workflow data; run `node scripts/build-workflow-map.cjs` in the HOAhx repo first');
let data;
try {
  data = JSON.parse(embedded[1]);
} catch (error) {
  fail(`embedded workflow data is not valid JSON: ${error.message}`);
}
if (!Array.isArray(data.workflows) || !data.workflows.length) fail('embedded data has no workflows');

const excluded = /\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/;
const hit = html.match(excluded);
if (hit) fail(`excluded word "${hit[0]}" appears in the page`);
if (/client-walkthrough|localhost/.test(html)) fail('the page links to a file that is not on this site');

console.log(`${data.workflows.length} workflows, ${data.roles.length} roles, ${data.handoffs.length} handoffs; generated ${data.generated}`);
if (checkOnly) {
  console.log('check only; nothing written');
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
if (current === html) {
  console.log('go-live/workflow-map/workflow-map.html is already current');
  process.exit(0);
}
writeFileSync(target, html);
console.log(`wrote go-live/workflow-map/workflow-map.html (${html.length} bytes)`);
