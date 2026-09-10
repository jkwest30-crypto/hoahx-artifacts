#!/usr/bin/env node
// Pull the owners' marks and notes off the shared register into files the launch
// program can apply with /decide.
//
//   node scripts/pull-register.mjs [--source <decisions.md>] [--site <url>] [--snapshot-dir <dir>]
//        [--key <passphrase>] [--out <export.md>] [--all]
//
// Writes:
//   <snapshot-dir>/store-YYYYMMDD-HHMMSS.json   the whole store as fetched (only if it changed)
//   <snapshot-dir>/export-YYYY-MM-DD.md         every live mark/note in the "### D-### · Q-ID /
//                                               Mark: / Note:" shape /decide reads; items that
//                                               changed since the previous snapshot are flagged
// Prints a table of what changed. Never writes to the store.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseDecisions, fetchStore, snapshotStore, latestSnapshot, isLive, DEFAULT_SITE } from './register-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const SOURCE = path.resolve(args.source || process.env.DECISIONS_MD || path.join(root, '..', 'hoahx', 'docs', 'launch', 'decisions.md'));
const SITE = (args.site || process.env.REGISTER_SITE || DEFAULT_SITE).replace(/\/$/, '');
const SNAP_DIR = path.resolve(args['snapshot-dir'] || process.env.REGISTER_STORE_DIR || path.join(path.dirname(SOURCE), 'register-store'));
const KEY = args.key || process.env.DECISION_EDIT_KEY || '';
const MARK = { keep: 'Keep as-is', change: 'Change', discuss: 'Discuss' };

function fail(msg) { console.error('\n✗ ' + msg); process.exit(1); }

const byId = new Map();
if (fs.existsSync(SOURCE)) {
  const parsed = parseDecisions(fs.readFileSync(SOURCE, 'utf8'), path.basename(SOURCE));
  for (const q of parsed.questions) byId.set(q.id, q);
} else console.warn(`  ! ${SOURCE} not found; the export will carry ids only`);

const prev = latestSnapshot(SNAP_DIR);
let store;
try { store = await fetchStore(SITE, KEY); } catch (e) { fail(e.message); }
const snap = snapshotStore(SNAP_DIR, SITE, store);
const prevStore = prev && prev.data ? prev.data.store || {} : {};

const rows = [];
for (const [id, r] of Object.entries(store)) {
  const was = prevStore[id];
  const changed = !prev || JSON.stringify({ v: was && was.v || '', n: was && was.n || '' }) !== JSON.stringify({ v: r.v || '', n: r.n || '' });
  rows.push({ id, r, changed, live: isLive(r), known: byId.has(id) });
}
rows.sort((a, b) => a.id.localeCompare(b.id));
const live = rows.filter((x) => x.live);
const changedLive = live.filter((x) => x.changed);
const cleared = rows.filter((x) => !x.live && x.changed && prevStore[x.id] && isLive(prevStore[x.id]));
const unknown = rows.filter((x) => x.live && !x.known);

console.log(`✓ ${SITE}: ${live.length} live mark(s)/note(s) (${Object.keys(store).length} records); snapshot ${snap.wrote ? 'written' : 'unchanged'}: ${snap.file}`);
console.log(prev ? `  previous snapshot: ${prev.file}` : '  no previous snapshot: everything counts as new');
if (unknown.length) console.warn(`  ! ${unknown.length} live record(s) have no entry in decisions.md: ${unknown.map((x) => x.id).join(', ')}`);

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); // YYYY-MM-DD, local
const out = path.resolve(args.out || path.join(SNAP_DIR, `export-${today}.md`));
const lines = [
  '# HOAhx Decision Register — shared marks and notes',
  '',
  `Pulled ${new Date().toISOString()} from ${SITE} · ${live.length} of ${byId.size || '?'} marked or noted · ${changedLive.length} changed since the previous pull${prev ? ` (${path.basename(prev.file)})` : ''}.`,
  'Apply with /decide. "Discuss" is not an answer; "Change" without a note needs a conversation.',
  '',
];
const selected = args.all ? live : (prev ? changedLive : live);
for (const x of selected) {
  const q = byId.get(x.id);
  lines.push(`### ${x.id} · ${q ? q.code : x.r.code || '?'}${x.changed ? '   (changed since the previous pull)' : ''}`);
  if (q) lines.push(`Question: ${q.q}`);
  lines.push(`Mark: ${x.r.v ? MARK[x.r.v] || x.r.v : '(no mark — see note)'}`);
  if (x.r.n && String(x.r.n).trim()) lines.push(`Note: ${String(x.r.n).trim().replace(/\s*\n+\s*/g, ' ')}`);
  if (x.r.updatedAt) lines.push(`Updated: ${x.r.updatedAt}`);
  if (q && q.ans) lines.push(`Already on the record: answered ${q.ans}; compare before changing.`);
  lines.push('');
}
if (cleared.length) {
  lines.push('## Cleared since the previous pull (previous state, kept in the snapshot history)');
  for (const x of cleared) {
    const was = prevStore[x.id];
    lines.push(`- ${x.id}: was ${was.v ? MARK[was.v] || was.v : '(no mark)'}${was.n ? ' · note: ' + String(was.n).trim().replace(/\s*\n+\s*/g, ' ') : ''}`);
  }
  lines.push('');
}
fs.writeFileSync(out, lines.join('\n'));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('ID', 7)}${pad('Code', 11)}${pad('Mark', 11)}${pad('Changed', 9)}Note`);
for (const x of live) {
  const q = byId.get(x.id);
  console.log(`${pad(x.id, 7)}${pad(q ? q.code : '?', 11)}${pad(x.r.v ? MARK[x.r.v] || x.r.v : '—', 11)}${pad(x.changed ? 'yes' : '', 9)}${x.r.n ? String(x.r.n).trim().replace(/\s+/g, ' ').slice(0, 70) : ''}`);
}
if (!live.length) console.log('(nothing marked or noted yet)');
if (cleared.length) console.log(`\n${cleared.length} record(s) cleared since the previous pull; listed at the end of the export.`);
console.log(`\n✓ wrote ${out} (${selected.length} item(s)${args.all ? ', all live' : prev ? ', changed only; pass --all for everything' : ''})`);
