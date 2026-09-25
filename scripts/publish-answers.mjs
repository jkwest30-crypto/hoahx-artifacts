#!/usr/bin/env node
/**
 * Publishes the data behind /answers (HOAhx · Open questions, answered by recommendation):
 * copies the recommendations JSON kept in the HOAhx repo (docs/launch/recommendations.json,
 * the source of truth for the wording) into go-live/answers/data.json after checking it.
 * The page itself (index.html, answers.js, answers.css) is authored in this repo and reads
 * data.json at load.
 *
 *   npm run publish:answers -- --source ../hoahx/docs/launch/recommendations.json
 *   npm run publish:answers -- --source ../hoahx/docs/launch/recommendations.json --register ../hoahx/docs/launch/decisions.md
 *   npm run publish:answers -- --source … --register … --screens ../hoahx/docs/launch/screen-review.json
 *   npm run check:answers                      # verify the committed data.json and screens.json, write nothing
 *
 * --screens publishes the "Screens to review" section (docs/launch/screen-review.json in the
 * HOAhx repo) as go-live/answers/screens.json. The internal mapping each screen carries in the
 * source (its register entry and its stub in register-stubs.md) is stripped: it is for the pull,
 * never for the page. Screen ids are "S-<code>" so they cannot collide with the A## cards, and the
 * register's pending guard does not apply to them (their entries are answered; a change becomes a
 * Follows candidate).
 *
 * Refuses to write if the data is malformed, a card names a group that does not exist, a
 * D-number appears on two cards, a recommendation line names a D-number its card does not
 * carry, a word the owner-facing documents exclude appears in the data or the page, or, when
 * --register is given, a D-number on a card is not a pending entry in decisions.md (D-059 is
 * the one allowed exception: its four loose ends sit on a recorded answer).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const source = resolve(root, opt('--source', 'go-live/answers/data.json'));
const register = opt('--register', '');
const screensSource = opt('--screens', '');
const screensTarget = resolve(root, 'go-live/answers/screens.json');
const checkOnly = args.includes('--check');
const target = resolve(root, 'go-live/answers/data.json');
const pagesDir = resolve(root, 'go-live/answers');
const ANSWERED_EXCEPTIONS = new Set(['D-059']);

function fail(message) { console.error(`publish-answers: ${message}`); process.exit(1); }

if (!existsSync(source)) fail(`source not found: ${source}`);
let data;
try { data = JSON.parse(readFileSync(source, 'utf8')); } catch (e) { fail(`source is not valid JSON: ${e.message}`); }
for (const k of ['generated', 'title', 'lede', 'groups', 'cards']) if (!(k in data)) fail(`data has no "${k}"`);
if (!Array.isArray(data.groups) || !data.groups.length) fail('groups must be a non-empty array');
if (!Array.isArray(data.cards) || !data.cards.length) fail('cards must be a non-empty array');

const groupIds = new Set(data.groups.map((g) => g.id));
const cardIds = new Set();
const seenD = new Map();
for (const c of data.cards) {
  for (const k of ['id', 'group', 'title', 'decisions', 'rec', 'why']) if (!(k in c)) fail(`card ${c.id || '?'} has no "${k}"`);
  if (!/^A\d{2}$/.test(c.id)) fail(`card id "${c.id}" is not A##`);
  if (cardIds.has(c.id)) fail(`card ${c.id} appears twice`);
  cardIds.add(c.id);
  if (!groupIds.has(c.group)) fail(`card ${c.id} names group "${c.group}", which does not exist`);
  if (!c.decisions.length) fail(`card ${c.id} carries no decisions`);
  const own = new Set();
  for (const d of c.decisions) {
    if (!/^D-\d{3}$/.test(d.id)) fail(`card ${c.id}: "${d.id}" is not a D-number`);
    if (!d.code || !d.q) fail(`card ${c.id}: ${d.id} needs a code and a question`);
    if (seenD.has(d.id)) fail(`${d.id} is on two cards: ${seenD.get(d.id)} and ${c.id}`);
    seenD.set(d.id, c.id);
    own.add(d.id);
  }
  if (!c.rec.length) fail(`card ${c.id} has no recommendation lines`);
  for (const r of c.rec) {
    if (!Array.isArray(r.d) || !r.d.length || !r.text) fail(`card ${c.id}: every recommendation line needs d[] and text`);
    for (const id of r.d) if (!own.has(id)) fail(`card ${c.id}: a recommendation line names ${id}, which the card does not carry`);
  }
  const covered = new Set(c.rec.flatMap((r) => r.d));
  for (const id of own) if (!covered.has(id)) fail(`card ${c.id}: ${id} has no recommendation line`);
}

if (register) {
  const text = readFileSync(resolve(root, register), 'utf8');
  const pending = new Set();
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^### (D-\d{3}) /);
    if (m) { cur = m[1]; continue; }
    if (cur && /^- Answer: pending\b/.test(line)) pending.add(cur);
  }
  for (const id of seenD.keys()) {
    if (!pending.has(id) && !ANSWERED_EXCEPTIONS.has(id)) fail(`${id} (card ${seenD.get(id)}) is not a pending entry in ${register}`);
  }
  const missing = [...pending].filter((id) => !seenD.has(id));
  if (missing.length) console.warn(`publish-answers: pending in the register but on no card: ${missing.join(', ')}`);
}

const excluded = /\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/;
const hitData = JSON.stringify(data).match(excluded);
if (hitData) fail(`excluded word "${hitData[0]}" appears in the data`);

// ── screens to review ──
const INTERNAL = ['register', 'stub'];
function checkScreens(src, stripped) {
  for (const k of ['generated', 'due', 'previewUrl', 'title', 'lede', 'features']) if (!(k in src)) fail(`screens: no "${k}"`);
  if (!Array.isArray(src.features) || !src.features.length) fail('screens: features must be a non-empty array');
  const ids = new Set(), codes = new Set();
  for (const f of src.features) {
    for (const k of ['id', 'title', 'screens']) if (!(k in f)) fail(`screens: feature ${f.id || '?'} has no "${k}"`);
    if (!/^[A-Z]$/.test(f.id)) fail(`screens: feature id "${f.id}" is not one letter`);
    if (!Array.isArray(f.screens) || !f.screens.length) fail(`screens: feature ${f.id} has no screens`);
    for (const sc of f.screens) {
      for (const k of ['id', 'code', 'title', 'look', 'url']) if (!(k in sc)) fail(`screens: ${sc.id || sc.code || '?'} has no "${k}"`);
      if (!/^[A-Z]\d{1,2}$/.test(sc.code) || sc.code[0] !== f.id) fail(`screens: code "${sc.code}" does not belong to feature ${f.id}`);
      if (sc.id !== 'S-' + sc.code) fail(`screens: ${sc.code} must have id "S-${sc.code}", has "${sc.id}"`);
      if (ids.has(sc.id) || codes.has(sc.code)) fail(`screens: ${sc.code} appears twice`);
      ids.add(sc.id); codes.add(sc.code);
      if (!sc.url.startsWith(src.previewUrl + '/' + sc.code)) fail(`screens: ${sc.code} links to ${sc.url}, not ${src.previewUrl}/${sc.code}`);
      if (sc.sides != null && !Array.isArray(sc.sides)) fail(`screens: ${sc.code} sides must be an array`);
      if (!stripped) {
        if (!/^D-\d{3}$/.test(sc.register || '')) fail(`screens: ${sc.code} needs its register entry (D-###) in the source`);
        if (!/^F-\d{3}$/.test(sc.stub || '')) fail(`screens: ${sc.code} needs its stub (F-###) in the source`);
      } else if (INTERNAL.some((k) => k in sc)) fail(`screens: ${sc.code} carries internal mapping on the page`);
    }
  }
  const hit = JSON.stringify(src).match(excluded);
  if (hit) fail(`excluded word "${hit[0]}" appears in the screens`);
  return ids.size;
}
function stripScreens(src) {
  return Object.assign({}, src, { features: src.features.map((f) => Object.assign({}, f, { screens: f.screens.map((sc) => { const o = Object.assign({}, sc); for (const k of INTERNAL) delete o[k]; return o; }) })) });
}
let screensOut = null, screensCount = 0;
if (screensSource) {
  const p = resolve(root, screensSource);
  if (!existsSync(p)) fail(`screens source not found: ${p}`);
  let src;
  try { src = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { fail(`screens source is not valid JSON: ${e.message}`); }
  screensCount = checkScreens(src, false);
  screensOut = JSON.stringify(stripScreens(src), null, 1);
} else if (existsSync(screensTarget)) {
  screensCount = checkScreens(JSON.parse(readFileSync(screensTarget, 'utf8')), true);
}
for (const f of readdirSync(pagesDir).filter((n) => n.endsWith('.html') || n.endsWith('.js'))) {
  const text = readFileSync(resolve(pagesDir, f), 'utf8');
  const hit = text.match(excluded);
  if (hit) fail(`excluded word "${hit[0]}" appears in ${f}`);
  if (/localhost|client-walkthrough/.test(text)) fail(`${f} links to a file that is not on this site`);
}

console.log(`${data.cards.length} cards, ${seenD.size} decisions, ${data.groups.length} groups; generated ${data.generated}; ${screensCount} screens to review`);
if (checkOnly) { console.log('check only; nothing written'); process.exit(0); }
if (screensOut !== null) {
  if (existsSync(screensTarget) && readFileSync(screensTarget, 'utf8') === screensOut) console.log('go-live/answers/screens.json is already current');
  else { writeFileSync(screensTarget, screensOut); console.log(`wrote go-live/answers/screens.json (${screensOut.length} bytes)`); }
}
const out = JSON.stringify(data, null, 1);
if (existsSync(target) && readFileSync(target, 'utf8') === out) { console.log('go-live/answers/data.json is already current'); process.exit(0); }
writeFileSync(target, out);
console.log(`wrote go-live/answers/data.json (${out.length} bytes)`);
