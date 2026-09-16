#!/usr/bin/env node
/**
 * Reads the owners' selection from the /scope/ shared store (GET /api/picks) and
 * prints it as the plain-text summary the Review page sends, plus every note,
 * so the launch program can write the change order from it.
 *
 *   npm run pull:scope                       # live site
 *   npm run pull:scope -- --site http://localhost:8788 --key <passphrase>
 *   npm run pull:scope -- --out ../hoahx/docs/launch/register-store/scope-YYYY-MM-DD.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
const key = opt('--key', process.env.DECISION_EDIT_KEY || '');
const out = opt('--out', '');

const data = JSON.parse(readFileSync(resolve(root, 'go-live/scope/data.json'), 'utf8'));
const byId = {};
[...data.core, ...data.candidates].forEach((i) => { byId[i.id] = i; });
data.packages.forEach((p) => { byId[p.id] = p; });

const res = await fetch(site + '/api/picks?full=1' + (key ? '&key=' + encodeURIComponent(key) : ''), { headers: key ? { 'x-edit-key': key } : {} });
if (res.status === 401) { console.error('pull-scope: unauthorized; pass --key or set DECISION_EDIT_KEY'); process.exit(1); }
if (!res.ok) { console.error(`pull-scope: ${res.status} from ${site}`); process.exit(1); }
const all = await res.json();

const picked = Object.entries(all).filter(([id, r]) => r.v === 'yes' && byId[id]);
const pkgs = picked.filter(([id]) => byId[id].items).map(([id]) => byId[id]);
const inPicked = new Set(pkgs.flatMap((p) => p.items));
const items = picked.filter(([id]) => !byId[id].items && !inPicked.has(id)).map(([id]) => byId[id]);
const hours = pkgs.reduce((s, p) => s + p.jake, 0) + items.reduce((s, i) => s + i.jake, 0);
const lines = [`# Owners' selection · pulled ${new Date().toISOString()} from ${site}`, ''];
const sub = all._submission;
lines.push(sub && sub.v ? `Last sent: ${sub.updatedAt}` : 'Not sent yet (the picks below are the live selection).', '');
if (sub && sub.n) lines.push('## As sent', '', '```', sub.n, '```', '');
lines.push('## Live selection', '');
pkgs.sort((a, b) => a.build - b.build).forEach((p) => lines.push(`- Package ${p.id} · ${p.area} · ${p.jake} h · items ${p.items.join(', ')}` + (all[p.id].n ? ` · note: ${all[p.id].n}` : '')));
items.sort((a, b) => a.build - b.build).forEach((i) => lines.push(`- ${i.id} · ${i.title} · ${i.jake} h` + (i.pkg ? ` (part of ${i.pkg})` : '') + (all[i.id].n ? ` · note: ${all[i.id].n}` : '')));
lines.push('', `Total ${hours} h · ${Math.ceil(hours / data.hoursPerDay)} working days at ${data.hoursPerDay} h/day from ${data.baseline} · $${Math.round(hours * data.rate)} at $${data.rate}/h`, '');
const notes = Object.entries(all).filter(([id, r]) => r.n && r.n.trim() && id !== '_submission' && byId[id] && r.v !== 'yes');
if (notes.length) { lines.push('## Notes on items not selected', ''); notes.forEach(([id, r]) => lines.push(`- ${id} · ${byId[id].title || byId[id].area}: ${r.n}`)); lines.push(''); }
if (all._message && all._message.n) lines.push('## Message', '', all._message.n, '');
const text = lines.join('\n');
if (out) { writeFileSync(resolve(out), text); console.log(`wrote ${out}`); } else console.log(text);
