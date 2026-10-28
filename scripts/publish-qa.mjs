#!/usr/bin/env node
/**
 * Publishes the data behind /qa (HOAhx · Hands-on checks): checks the scenario cards kept in the
 * HOAhx repo (docs/launch/qa/scenarios.json, the source of truth for every card) against the
 * contract in docs/launch/qa/README.md and taxonomy.md, and writes the `ready` cards, with the
 * public part of the cast of test accounts, to go-live/qa/data.json. The page itself
 * (index.html, qa.js, qa.css) is authored in this repo and reads data.json at load.
 *
 *   npm run publish:qa -- --source ../hoahx/docs/launch/qa/scenarios.json \
 *       --accounts ../hoahx/docs/launch/qa/accounts.json --app ../hoahx [--build <sha>]
 *   npm run publish:qa -- … --upload-accounts [--site https://hoahx-requirements.netlify.app]
 *   npm run publish:qa -- --source … --accounts … --app … --check   # validate the sources, write nothing
 *   npm run check:qa                                                 # validate the committed data.json
 *   npm run publish:qa -- … --out /some/scratch/data.json            # write somewhere else (for trying it)
 *
 * With --check only, a missing accounts.json falls back to accounts.sample.json beside it (same
 * shape, fake values) and says so. Publishing with the sample needs it named explicitly with
 * --accounts; only the cast's public fields are published either way.
 *
 * --upload-accounts sends the accounts file (emails, the password, the two-step phones and code)
 * to the site's store behind the passphrase, as { kind: 'accounts' }, with the passphrase from the
 * QA_KEY environment variable. It is refused without QA_KEY, and a sample file is only ever sent
 * to a local stand-in (http://localhost…), never to the live site.
 *
 * Refuses to write, listing every failure, if:
 *   - the source does not have the contract's shape exactly (unknown fields included);
 *   - an id is not QA-### or appears twice; a status is not draft, ready or retired;
 *   - a card has no whyManual from the six categories or no whyManualNote
 *     ("a card without a reason a person must do it is refused");
 *   - a card names a feature or an environment that does not exist;
 *   - a start is not a path in the app's src/App.tsx (":params" match anything), or /preview/<code>
 *     with a code that is not one of the screens (docs/prototype/v3/SCREENS.md, *.preview.ts);
 *   - an account handle is not in the accounts file;
 *   - a card has fewer than 2 or more than 15 steps, a step without "do" or "see", or minutes
 *     outside 1–20; a ready card has no reviewed date;
 *   - a word the owner-facing documents exclude appears in the data or the page files;
 *   - the data carries a password, the two-step code, an email address or a phone number.
 * Retired cards are kept for history: only their id, status and title are checked.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name, dflt) => (has(name) && args[args.indexOf(name) + 1] && !args[args.indexOf(name) + 1].startsWith('--') ? args[args.indexOf(name) + 1] : dflt);
const checkOnly = has('--check');
const sourceArg = opt('--source', '');
const accountsArg = opt('--accounts', '');
const appArg = opt('--app', '');
const buildArg = opt('--build', '');
const outArg = opt('--out', '');
const upload = has('--upload-accounts');
const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
const pagesDir = resolve(root, 'go-live/qa');
const target = outArg ? resolve(outArg) : resolve(pagesDir, 'data.json');

// The six reasons a person must do a check (taxonomy.md), with the words the page shows.
const CATEGORIES = {
  'third-party': 'Real outside services',
  'real-device': 'A real phone or device',
  time: 'Time passing',
  'two-people': 'Two people, or two devices',
  judgment: 'A person’s judgment',
  'production-config': 'Only on the live site',
};
const STATUSES = ['draft', 'ready', 'retired'];
const DEVICES = ['any', 'desktop', 'phone', 'iphone', 'android', 'two-devices'];
const SOURCE_KEYS = ['version', 'updated', 'title', 'lede', 'environments', 'features', 'always', 'cards'];
const PUBLISHED_KEYS = ['title', 'lede', 'environments', 'features', 'always', 'categories', 'cast', 'cards', 'build', 'generated'];
const CARD_REQUIRED = ['id', 'status', 'title', 'feature', 'whyManual', 'whyManualNote', 'env', 'start', 'accounts', 'device', 'minutes', 'steps', 'added'];
const CARD_OPTIONAL = ['milestone', 'task', 'decisions', 'precondition', 'lookFor', 'expectNotProvable', 'reset', 'complements', 'reviewed'];
// Published order; `status` is dropped (every published card is ready).
const CARD_PUBLISHED = ['id', 'title', 'feature', 'milestone', 'task', 'decisions', 'whyManual', 'whyManualNote', 'env', 'start', 'accounts', 'device', 'minutes', 'precondition', 'steps', 'lookFor', 'expectNotProvable', 'reset', 'complements', 'added', 'reviewed'];
const CAST_KEYS = ['handle', 'name', 'roleLabel', 'where', 'opening', 'twoStep'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_REASON = 'a card without a reason a person must do it is refused';

// The owner-facing excluded words: publish-answers' list, with "AI" matched only as the whole
// capitalised word (so /ai-assistant and "said" pass) and the others in any case.
const EXCLUDED = /\bStripe\b|\bClaude\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/i;
const EXCLUDED_AI = /\bAI\b/;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

const errors = [];
const notes = [];
const err = (m) => errors.push(m);
const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim().length > 0;

function readJson(path, what) {
  if (!existsSync(path)) { err(`${what} not found: ${path}`); return null; }
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { err(`${what} is not valid JSON (${path}): ${e.message}`); return null; }
}

// Every string value in a JSON value, with where it sits.
function* strings(v, path) {
  if (isStr(v)) yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

function excludedHits(value, where) {
  for (const [p, s] of strings(value, '')) {
    const m = s.match(EXCLUDED) || s.match(EXCLUDED_AI);
    if (m) err(`excluded word "${m[0]}" appears in ${where}${p ? ` at ${p}` : ''}`);
  }
}

function secretHits(value, where, secrets) {
  for (const [p, s] of strings(value, '')) {
    const at = `${where}${p ? ` at ${p}` : ''}`;
    if (s.includes('@')) err(`an email address (or an "@") appears in ${at}; the page shows sign-in details only behind the passphrase`);
    if (PHONE_RE.test(s)) err(`a phone number appears in ${at}`);
    if (secrets.password && s.includes(secrets.password)) err(`the test accounts' password appears in ${at}`);
    if (secrets.code && new RegExp(`\\b${secrets.code}\\b`).test(s)) err(`the two-step code appears in ${at}`);
    for (const digits of secrets.phoneDigits) if (s.replace(/\D/g, '').includes(digits)) err(`a test account's phone number appears in ${at}`);
  }
}

// ── the app's routes and screens ─────────────────────────────────────────
function loadApp(app) {
  const appTsx = join(app, 'src/App.tsx');
  if (!existsSync(appTsx)) { err(`the app's routes were not found: ${appTsx}`); return null; }
  const paths = [...readFileSync(appTsx, 'utf8').matchAll(/\bpath=["']([^"']+)["']/g)].map((m) => m[1]).filter((p) => p !== '*' && p.startsWith('/'));
  const matchers = [...new Set(paths)].map((p) => new RegExp('^' + p.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg === '*' ? '.*' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$'));
  const codes = new Set();
  const sources = [];
  const screensMd = join(app, 'docs/prototype/v3/SCREENS.md');
  if (existsSync(screensMd)) {
    for (const m of readFileSync(screensMd, 'utf8').matchAll(/^### ([A-Z]\d{1,2}) ·/gm)) codes.add(m[1]);
    sources.push('docs/prototype/v3/SCREENS.md');
  }
  const previews = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.preview\.tsx?$/.test(name)) previews.push(p);
    }
  })(join(app, 'src'));
  for (const f of previews) for (const m of readFileSync(f, 'utf8').matchAll(/\bcode:\s*['"]([A-Z]\d{1,2})['"]/g)) codes.add(m[1]);
  if (previews.length) sources.push(`${previews.length} *.preview.ts files`);
  return { paths: paths.length, matchers, codes, codeSources: sources };
}

function startProblem(start, app) {
  if (!isStr(start) || !start.startsWith('/')) return 'start must be a path beginning with "/"';
  if (!app) return '';
  const path = start.split(/[?#]/)[0];
  const pm = path.match(/^\/preview(?:\/([^/]+))?\/?$/);
  if (pm) {
    if (!pm[1]) return '';
    if (!app.codes.size) return `start "${start}": no screen list was found to check the code against`;
    return app.codes.has(pm[1]) ? '' : `start "${start}": "${pm[1]}" is not one of the screens (${app.codeSources.join(', ')})`;
  }
  return app.matchers.some((re) => re.test(path)) ? '' : `start "${start}" is not a route in src/App.tsx`;
}

// ── one card ─────────────────────────────────────────────────────────────
function checkCard(c, i, ctx) {
  const at = `card ${isStr(c && c.id) ? c.id : '#' + (i + 1)}`;
  if (!c || typeof c !== 'object' || Array.isArray(c)) { err(`${at} is not an object`); return; }
  if (!isStr(c.id) || !/^QA-\d{3}$/.test(c.id)) err(`${at}: id "${c.id}" is not QA-### (three digits)`);
  else if (ctx.ids.has(c.id)) err(`${at} appears twice`);
  else ctx.ids.add(c.id);
  if (!ctx.published && !STATUSES.includes(c.status)) err(`${at}: status "${c.status}" is not draft, ready or retired`);
  if (!nonEmpty(c.title)) err(`${at}: no title`);
  if (!ctx.published && c.status === 'retired') return;

  const allowed = ctx.published ? CARD_PUBLISHED : [...CARD_REQUIRED, ...CARD_OPTIONAL];
  for (const k of Object.keys(c)) if (!allowed.includes(k)) err(`${at}: "${k}" is not a card field in the contract`);
  const required = ctx.published ? CARD_REQUIRED.filter((k) => k !== 'status').concat('reviewed') : CARD_REQUIRED;
  for (const k of required) if (!(k in c) || c[k] == null) err(`${at}: no "${k}"`);

  if (!(c.whyManual in CATEGORIES) || !nonEmpty(c.whyManualNote)) err(`${at}: ${NO_REASON} (whyManual must be one of ${Object.keys(CATEGORIES).join(', ')}, with a whyManualNote)`);
  if (c.feature != null && !ctx.featureIds.has(c.feature)) err(`${at}: feature "${c.feature}" does not exist`);
  if (c.env != null && !ctx.envIds.has(c.env)) err(`${at}: env "${c.env}" does not exist`);
  if (c.start != null) { const p = startProblem(c.start, ctx.app); if (p) err(`${at}: ${p}`); }
  if (c.milestone != null && !(isStr(c.milestone) && /^M\d{1,2}[a-z]?$/.test(c.milestone))) err(`${at}: milestone "${c.milestone}" is not M#`);
  if (c.task != null && !isStr(c.task)) err(`${at}: task must be text`);
  if (c.decisions != null && !(Array.isArray(c.decisions) && c.decisions.every((d) => isStr(d) && /^D-\d{3}$/.test(d)))) err(`${at}: decisions must be a list of D-###`);
  if (c.accounts != null) {
    if (!Array.isArray(c.accounts) || !c.accounts.every(isStr)) err(`${at}: accounts must be a list of handles`);
    else for (const h of c.accounts) if (ctx.handles && !ctx.handles.has(h)) err(`${at}: account "${h}" is not in ${ctx.handlesFrom}`);
  }
  if (c.device != null && !DEVICES.includes(c.device)) err(`${at}: device "${c.device}" is not one of ${DEVICES.join(', ')}`);
  if (c.minutes != null && !(Number.isInteger(c.minutes) && c.minutes >= 1 && c.minutes <= 20)) err(`${at}: minutes must be a whole number from 1 to 20`);
  if (c.steps != null) {
    if (!Array.isArray(c.steps) || c.steps.length < 2 || c.steps.length > 15) err(`${at}: needs 2 to 15 steps, has ${Array.isArray(c.steps) ? c.steps.length : 'none'}`);
    else c.steps.forEach((s, n) => {
      if (!s || typeof s !== 'object') { err(`${at}: step ${n + 1} is not { do, see }`); return; }
      for (const k of Object.keys(s)) if (k !== 'do' && k !== 'see') err(`${at}: step ${n + 1} has "${k}"; a step is { do, see }`);
      if (!nonEmpty(s.do)) err(`${at}: step ${n + 1} has no "do"`);
      if (!nonEmpty(s.see)) err(`${at}: step ${n + 1} has no "see"`);
    });
  }
  for (const k of ['precondition', 'expectNotProvable', 'reset']) if (c[k] != null && !isStr(c[k])) err(`${at}: ${k} must be text`);
  for (const k of ['lookFor', 'complements']) if (c[k] != null && !(Array.isArray(c[k]) && c[k].every(nonEmpty))) err(`${at}: ${k} must be a list of text`);
  if (c.added != null && !(isStr(c.added) && DATE_RE.test(c.added))) err(`${at}: added must be YYYY-MM-DD`);
  if (c.reviewed != null && !(isStr(c.reviewed) && DATE_RE.test(c.reviewed))) err(`${at}: reviewed must be YYYY-MM-DD`);
  if ((ctx.published || c.status === 'ready') && !(isStr(c.reviewed) && DATE_RE.test(c.reviewed))) err(`${at}: a ready card needs the date it was reviewed`);
}

function checkFrame(d, ctx) {
  const keys = ctx.published ? PUBLISHED_KEYS : SOURCE_KEYS;
  for (const k of keys) if (!(k in d)) err(`${ctx.what} has no "${k}"`);
  for (const k of Object.keys(d)) if (!keys.includes(k)) err(`${ctx.what}: "${k}" is not a field in the contract`);
  if (!ctx.published) {
    if (d.version !== 1) err(`${ctx.what}: version must be 1`);
    if (!(isStr(d.updated) && DATE_RE.test(d.updated))) err(`${ctx.what}: updated must be YYYY-MM-DD`);
  }
  if (!nonEmpty(d.title)) err(`${ctx.what}: no title`);
  if (!nonEmpty(d.lede)) err(`${ctx.what}: no lede`);
  ctx.envIds = new Set();
  if (!d.environments || typeof d.environments !== 'object' || Array.isArray(d.environments)) err(`${ctx.what}: environments must be an object`);
  else for (const [id, e] of Object.entries(d.environments)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) err(`${ctx.what}: environment id "${id}" is not a short lower-case name`);
    if (!e || typeof e !== 'object' || !isStr(e.url) || !nonEmpty(e.label)) { err(`${ctx.what}: environment "${id}" needs url (text, may be empty) and label`); continue; }
    for (const k of Object.keys(e)) if (k !== 'url' && k !== 'label') err(`${ctx.what}: environment "${id}" has "${k}"`);
    if (e.url && !/^https:\/\/[^\s/]+$/.test(e.url)) err(`${ctx.what}: environment "${id}" url must be https://<host> with no path, or empty`);
    ctx.envIds.add(id);
  }
  ctx.featureIds = new Set();
  if (!Array.isArray(d.features) || !d.features.length) err(`${ctx.what}: features must be a non-empty list`);
  else for (const f of d.features) {
    if (!f || !/^[a-z][a-z0-9-]{0,31}$/.test(f.id || '') || !nonEmpty(f.title) || !nonEmpty(f.blurb)) { err(`${ctx.what}: feature ${f && f.id || '?'} needs id, title and blurb`); continue; }
    for (const k of Object.keys(f)) if (!['id', 'title', 'blurb'].includes(k)) err(`${ctx.what}: feature "${f.id}" has "${k}"`);
    if (ctx.featureIds.has(f.id)) err(`${ctx.what}: feature "${f.id}" appears twice`);
    ctx.featureIds.add(f.id);
  }
  if (!Array.isArray(d.always) || !d.always.every(nonEmpty)) err(`${ctx.what}: always must be a list of text`);
  if (!Array.isArray(d.cards)) err(`${ctx.what}: cards must be a list`);
}

// ── the accounts file ────────────────────────────────────────────────────
function loadAccounts() {
  if (!accountsArg) { err('pass --accounts <accounts.json> (the file the QA seed writes)'); return null; }
  let path = resolve(accountsArg);
  if (!existsSync(path) && checkOnly) {
    const sample = join(dirname(path), 'accounts.sample.json');
    if (existsSync(sample)) {
      notes.push(`${basename(path)} is not there; checking the handles against accounts.sample.json instead (--check only)`);
      path = sample;
    }
  }
  const a = readJson(path, 'accounts file');
  if (!a) return null;
  if (!Array.isArray(a.accounts) || !a.accounts.length) { err(`accounts file has no accounts list: ${path}`); return null; }
  const isSample = /SAMPLE/.test(a._note || '') || basename(path) === 'accounts.sample.json';
  if (isSample && !checkOnly) notes.push('publishing the cast from the sample accounts file: only names, roles and opening states are published, and they match the seeded cast');
  const seen = new Set();
  for (const x of a.accounts) {
    for (const k of ['handle', 'name', 'roleLabel', 'where']) if (!nonEmpty(x && x[k])) err(`accounts file: an account has no "${k}" (${x && x.handle || '?'})`);
    if (x && seen.has(x.handle)) err(`accounts file: handle "${x.handle}" appears twice`);
    if (x) seen.add(x.handle);
  }
  return { path, data: a, isSample };
}

function publicCast(a) {
  return a.accounts.map((x) => ({ handle: x.handle, name: x.name, roleLabel: x.roleLabel, where: x.where, opening: x.opening || '', twoStep: !!x.secondFactor }));
}

function secretsOf(a) {
  if (!a) return { password: '', code: '', phoneDigits: [] };
  const phoneDigits = a.accounts.map((x) => (x.secondFactor && x.secondFactor.phone ? String(x.secondFactor.phone).replace(/\D/g, '') : '')).filter((d) => d.length >= 7);
  return { password: a.password || '', code: /^\d{4,10}$/.test(a.secondFactorCode || '') ? a.secondFactorCode : '', phoneDigits };
}

function checkPageFiles() {
  if (!existsSync(pagesDir)) { err('go-live/qa/ is missing'); return; }
  for (const f of readdirSync(pagesDir).filter((n) => /\.(html|js|css)$/.test(n))) {
    const text = readFileSync(resolve(pagesDir, f), 'utf8');
    const m = text.match(EXCLUDED) || text.match(EXCLUDED_AI);
    if (m) err(`excluded word "${m[0]}" appears in go-live/qa/${f}`);
    if (/localhost|client-walkthrough/.test(text)) err(`go-live/qa/${f} links to a file that is not on this site`);
  }
}

function report() {
  for (const n of notes) console.log(`publish-qa: note: ${n}`);
  if (errors.length) {
    console.error(`publish-qa: refused, ${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing written:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

// ── check the committed data.json (npm run check:qa) ─────────────────────
if (!sourceArg) {
  if (!checkOnly) { console.error('publish-qa: pass --source <scenarios.json>, or --check to verify the committed data.json'); process.exit(1); }
  const d = readJson(target, 'data.json');
  if (d) {
    const ctx = { published: true, what: 'data.json', ids: new Set(), app: appArg ? loadApp(resolve(appArg)) : null };
    checkFrame(d, ctx);
    if (!Array.isArray(d.cast)) err('data.json: cast must be a list');
    else for (const x of d.cast) {
      const ks = Object.keys(x || {});
      if (ks.length !== CAST_KEYS.length || !CAST_KEYS.every((k) => ks.includes(k)) || typeof x.twoStep !== 'boolean') err(`data.json: the cast entry "${x && x.handle}" must be exactly { ${CAST_KEYS.join(', ')} }`);
    }
    ctx.handles = new Set((d.cast || []).map((x) => x.handle));
    ctx.handlesFrom = 'the published cast';
    if (d.categories == null || JSON.stringify(d.categories) !== JSON.stringify(CATEGORIES)) err('data.json: categories must be the six from taxonomy.md');
    if (!nonEmpty(d.build)) err('data.json: no build');
    if (!nonEmpty(d.generated)) err('data.json: no generated time');
    (d.cards || []).forEach((c, i) => checkCard(c, i, ctx));
    const acc = accountsArg ? loadAccounts() : null;
    excludedHits(d, 'data.json');
    secretHits(d, 'data.json', secretsOf(acc && acc.data));
    checkPageFiles();
    if (!ctx.app) notes.push('start routes not checked (pass --app ../hoahx to check them)');
    if (!acc) notes.push('password and two-step code not checked by value (pass --accounts to check them); emails and phone numbers were');
    report();
    console.log(`data.json: ${d.cards.length} ready card${d.cards.length === 1 ? '' : 's'}, ${d.cast.length} accounts in the cast, build ${d.build}, generated ${d.generated}`);
  } else report();
  console.log('check only; nothing written');
  process.exit(0);
}

// ── publish from the sources ─────────────────────────────────────────────
const src = readJson(resolve(sourceArg), 'source');
const acc = loadAccounts();
if (!appArg) err('pass --app <the HOAhx repo> so every start can be checked against its routes');
const app = appArg ? loadApp(resolve(appArg)) : null;
if (!src) report();

const ctx = { published: false, what: 'source', ids: new Set(), app, handles: acc ? new Set(acc.data.accounts.map((x) => x.handle)) : null, handlesFrom: acc ? basename(acc.path) : '' };
checkFrame(src, ctx);
const cards = Array.isArray(src.cards) ? src.cards : [];
cards.forEach((c, i) => checkCard(c, i, ctx));
const live = cards.filter((c) => c && c.status !== 'retired');
const secrets = secretsOf(acc && acc.data);
excludedHits(Object.assign({}, src, { cards: live }), 'the source');
secretHits(Object.assign({}, src, { cards: live }), 'the source', secrets);

let build = buildArg;
if (!build && appArg) {
  try { build = execFileSync('git', ['-C', resolve(appArg), 'rev-parse', '--short', 'origin/dev'], { encoding: 'utf8' }).trim(); }
  catch (e) { err(`could not read the build from ${appArg} (git rev-parse --short origin/dev); pass --build <sha>`); }
}
if (build && !/^[0-9a-f]{7,40}$/.test(build)) err(`build "${build}" is not a commit id`);

const ready = cards.filter((c) => c && c.status === 'ready');
const drafts = cards.filter((c) => c && c.status === 'draft').length;
const retired = cards.filter((c) => c && c.status === 'retired').length;
const published = {
  title: src.title, lede: src.lede, environments: src.environments, features: src.features, always: src.always,
  categories: CATEGORIES,
  cast: acc ? publicCast(acc.data) : [],
  cards: ready.map((c) => { const o = {}; for (const k of CARD_PUBLISHED) if (c[k] != null) o[k] = c[k]; return o; }),
  build, generated: new Date().toISOString(),
};
excludedHits(published, 'data.json');
secretHits(published, 'data.json', secrets);
checkPageFiles();
report();

console.log(`${ready.length} ready card${ready.length === 1 ? '' : 's'} to publish · ${drafts} draft${drafts === 1 ? '' : 's'} not published · ${retired} retired · ${published.cast.length} accounts in the cast · build ${build}`);
if (app) console.log(`routes: ${app.paths} paths in src/App.tsx; ${app.codes.size} screen codes from ${app.codeSources.join(' and ') || 'nowhere'}`);
if (checkOnly) { console.log('check only; nothing written'); process.exit(0); }

const body = (d) => JSON.stringify(d, null, 1);
const sameExceptTime = (a, b) => body(Object.assign({}, a, { generated: '' })) === body(Object.assign({}, b, { generated: '' }));
let current = null;
try { current = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null; } catch (e) { current = null; }
const rel = target.startsWith(root + '/') ? target.slice(root.length + 1) : target;
if (current && sameExceptTime(current, published)) console.log(`${rel} is already current (generated ${current.generated})`);
else {
  mkdirSync(dirname(target), { recursive: true });
  const out = body(published) + '\n';
  writeFileSync(target, out);
  console.log(`wrote ${rel} (${out.length} bytes)`);
}

if (upload) {
  const key = process.env.QA_KEY || '';
  if (!key) { console.error('publish-qa: --upload-accounts needs the passphrase in the QA_KEY environment variable; nothing uploaded'); process.exit(1); }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site);
  if (acc.isSample && !local) { console.error(`publish-qa: refusing to upload the sample accounts file to ${site}; upload the seeded accounts.json`); process.exit(1); }
  const res = await fetch(site + '/api/qa', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-edit-key': key }, body: JSON.stringify({ kind: 'accounts', accounts: acc.data }) });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`publish-qa: the upload was refused (${res.status}${reply.error ? ': ' + reply.error : ''})`); process.exit(1); }
  console.log(`uploaded the sign-in details for ${reply.count} accounts to ${site} (behind the passphrase)`);
}
