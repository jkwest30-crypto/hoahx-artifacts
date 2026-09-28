#!/usr/bin/env node
/**
 * Publishes the data behind /hub (HOAhx · The owners' hub): the links to the
 * documents in the shared Google Drive and to the review pages on this site,
 * grouped by Product, Developer review and UX. The list is kept in the HOAhx
 * repo's launch program; the page (index.html, hub.css, hub.js) is authored
 * here and reads /hub/data.json at load.
 *
 *   npm run publish:hub -- --source ../hoahx/docs/launch/hub.json
 *   npm run check:hub                    # verify the committed data, write nothing
 *   npm run check:hub -- --links         # also ask every page link for an answer
 *
 * Refuses to write if the data is malformed, a link is not https, the same
 * link sits in two groups, a date is not a real date, or a word the
 * owner-facing documents exclude appears in the data or the page.
 *
 * --links requests each link that is not a Google Drive link (Drive answers
 * a sign-in page to anyone, so a request proves nothing there) and fails on
 * any that does not answer 200.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sourceArg = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'go-live/hub/data.json';
const checkOnly = args.includes('--check');
const checkLinks = args.includes('--links');
const source = resolve(root, sourceArg);
const target = resolve(root, 'go-live/hub/data.json');
const pagesDir = resolve(root, 'go-live/hub');

const KINDS = ['page', 'doc', 'sheet', 'slides', 'pdf', 'video', 'folder'];
const DRIVE_ONLY = ['doc', 'sheet', 'slides', 'folder'];
const DRIVE = /^https:\/\/(docs|drive)\.google\.com\//;

function fail(message) { console.error(`publish-hub: ${message}`); process.exit(1); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)); }
function isLink(s) { return typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s); }
function isText(s, max) { return typeof s === 'string' && s.trim().length > 0 && s.length <= max; }

if (!existsSync(source)) fail(`source not found: ${source}`);
let data;
try { data = JSON.parse(readFileSync(source, 'utf8')); } catch (e) { fail(`source is not valid JSON: ${e.message}`); }
// The Decision Register is an internal tool: the hub neither lists it nor links to it.
if (/decision[ -]register/i.test(JSON.stringify(data))) fail('the list names the Decision Register, which is internal: take the row out');
if (/decision[ -]register/i.test(readFileSync(resolve(root, 'go-live/hub/index.html'), 'utf8'))) fail('go-live/hub/index.html names the Decision Register, which is internal');

if (!isDate(data.updated)) fail('"updated" must be a date, YYYY-MM-DD');
if (data.drive !== null && !(data.drive && DRIVE.test(data.drive))) fail('"drive" must be null or a Google Drive link');
if (!Array.isArray(data.waiting)) fail('data has no "waiting" list');
if (!Array.isArray(data.sections) || !data.sections.length) fail('data has no "sections"');

for (const w of data.waiting) {
  for (const k of ['t', 'due', 'd', 'go']) if (!isText(w[k], 160)) fail(`a "waiting" item has no "${k}": ${JSON.stringify(w)}`);
  if (!isLink(w.href)) fail(`"${w.t}" in "waiting" has no https link`);
}

const sectionIds = new Set();
const seen = new Map();
const links = new Set(data.waiting.map((w) => w.href));
let rowCount = 0;
let emptyGroups = 0;
for (const s of data.sections) {
  if (!/^[a-z][a-z-]*$/.test(s.id || '')) fail(`section id "${s.id}" must be lowercase letters and hyphens`);
  if (sectionIds.has(s.id)) fail(`section id "${s.id}" is used twice`);
  sectionIds.add(s.id);
  if (!isText(s.name, 60) || !isText(s.about, 160)) fail(`section "${s.id}" needs a name and an about line`);
  if (s.columns !== 1 && s.columns !== 2) fail(`section "${s.id}": "columns" must be 1 or 2`);
  if (s.folder !== null && !(s.folder && DRIVE.test(s.folder))) fail(`section "${s.id}": "folder" must be null or a Google Drive link`);
  if (!Array.isArray(s.groups) || !s.groups.length) fail(`section "${s.id}" has no groups`);
  const groupNames = new Set();
  for (const g of s.groups) {
    if (!isText(g.name, 60)) fail(`a group in "${s.id}" has no name`);
    if (groupNames.has(g.name)) fail(`group "${g.name}" appears twice in "${s.id}"`);
    groupNames.add(g.name);
    if (!Array.isArray(g.rows)) fail(`group "${g.name}" has no "rows" list`);
    if (!g.rows.length) emptyGroups += 1;
    for (const r of g.rows) {
      const where = `"${r.t}" in ${s.name} · ${g.name}`;
      if (!isText(r.t, 90)) fail(`a row in ${s.name} · ${g.name} has no title`);
      if (!KINDS.includes(r.k)) fail(`${where}: kind "${r.k}" is not one of ${KINDS.join(', ')}`);
      if (!isText(r.d, 160)) fail(`${where}: needs a one-line description`);
      if (!isLink(r.href)) fail(`${where}: needs an https link`);
      // A PDF or a video may sit on this site or in Drive; the other kinds have one home.
      if (r.k === 'page' && DRIVE.test(r.href)) fail(`${where}: a Google Drive link is a doc, sheet, slides, pdf, video or folder, not a page`);
      if (DRIVE_ONLY.includes(r.k) && !DRIVE.test(r.href)) fail(`${where}: kind "${r.k}" needs a Google Drive link; a link to a website is a page`);
      if ('date' in r && !isDate(r.date)) fail(`${where}: "date" must be YYYY-MM-DD`);
      if ('date' in r && r.date > data.updated) fail(`${where}: dated ${r.date}, after the list's own date ${data.updated}`);
      if ('by' in r && !isText(r.by, 40)) fail(`${where}: "by" is empty`);
      if ('tag' in r && !isText(r.tag, 24)) fail(`${where}: "tag" is empty or longer than 24 characters`);
      // The same document in two groups drifts: one copy gets the new description, the other does not.
      if (seen.has(r.href)) fail(`${where}: the same link is already listed as ${seen.get(r.href)}`);
      seen.set(r.href, where);
      links.add(r.href);
      rowCount += 1;
    }
  }
}

const excluded = /\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/;
const hitData = JSON.stringify(data).match(excluded);
if (hitData) fail(`excluded word "${hitData[0]}" appears in the data`);
for (const f of readdirSync(pagesDir).filter((n) => n.endsWith('.html') || n.endsWith('.js'))) {
  const text = readFileSync(resolve(pagesDir, f), 'utf8');
  const hit = text.match(excluded);
  if (hit) fail(`excluded word "${hit[0]}" appears in ${f}`);
  if (/localhost|client-walkthrough/.test(text)) fail(`${f} links to a file that is not on this site`);
}

if (checkLinks) {
  const toAsk = [...links].filter((l) => !DRIVE.test(l));
  const dead = [];
  for (const l of toAsk) {
    try {
      const res = await fetch(l.split('#')[0], { redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (res.status !== 200) dead.push(`${res.status} ${l}`);
    } catch (e) { dead.push(`no answer (${e.name}) ${l}`); }
  }
  if (dead.length) fail(`${dead.length} of ${toAsk.length} links did not answer:\n  ${dead.join('\n  ')}`);
  console.log(`${toAsk.length} page links answered 200; ${links.size - toAsk.length} Drive links not requested`);
}

console.log(`${data.sections.length} sections, ${rowCount} links, ${emptyGroups} groups with nothing in them yet, ${data.waiting.length} waiting on the owners; list dated ${data.updated}`);
if (checkOnly) { console.log('check only; nothing written'); process.exit(0); }
const out = `${JSON.stringify(data, null, 1)}\n`;
if (existsSync(target) && readFileSync(target, 'utf8') === out) { console.log('go-live/hub/data.json is already current'); process.exit(0); }
writeFileSync(target, out);
console.log(`wrote go-live/hub/data.json (${out.length} bytes)`);
