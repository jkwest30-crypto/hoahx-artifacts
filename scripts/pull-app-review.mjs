#!/usr/bin/env node
/**
 * Pulls the App Store listing review (/app-review) into the HOAhx checkout:
 *   docs/launch/register-store/app-review-answers-<timestamp>.json   every owner's answer, per question
 *   docs/launch/store/screenshots/from-owners/<slot>-<who>-<file>    every uploaded image
 *
 *   npm run pull:app-review
 *   npm run pull:app-review -- --site http://localhost:8789 --key <passphrase> --hoahx ../hoahx
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
const key = opt('--key', process.env.DECISION_EDIT_KEY || '');
const hoahx = resolve(root, opt('--hoahx', '../hoahx'));
function fail(m) { console.error(`pull-app-review: ${m}`); process.exit(1); }
if (!existsSync(join(hoahx, 'docs/launch'))) fail(`not a HOAhx checkout: ${hoahx} (pass --hoahx)`);

const get = async (qs) => {
  const res = await fetch(`${site}/api/app-review${qs}`, { headers: key ? { 'x-edit-key': key } : {} }).catch((e) => fail(`could not reach ${site} (${e.message})`));
  if (res.status === 401) fail('unauthorized; pass --key or set DECISION_EDIT_KEY');
  if (!res.ok) fail(`${res.status} from ${site}`);
  return res.json();
};

const store = await get('');
const data = JSON.parse(await (await fetch(`${site}/app-review/data.json`)).text());
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const questions = data.questions.map((q) => ({
  id: q.id, title: q.t, recommendation: q.rec, reason: q.why,
  answers: data.owners.map((o) => {
    const a = store.answers[`${q.id}.${o}`];
    return { who: o, answer: a && a.v ? a.v : 'none', change: a && a.v === 'change' ? a.n : '', at: a ? a.updatedAt : '' };
  }),
}));
const slots = [...data.shots.filter((s) => s.iphone).map((s) => `iphone-${s.n}`), ...data.shots.filter((s) => s.ipad).map((s) => `ipad-${s.n}`), 'extra'];
const screenshots = slots.map((slot) => ({
  slot,
  jacobProvides: data.owners.filter((o) => (store.shots[`${slot}.${o}`] || {}).v === 'jacob'),
  uploads: store.files.filter((f) => f.slot === slot).map((f) => ({ who: f.who, name: f.name, file: '', at: f.at })),
}));

const outDir = join(hoahx, 'docs/launch/store/screenshots/from-owners');
mkdirSync(outDir, { recursive: true });
for (const f of store.files) {
  const parts = [];
  for (let i = 0; i < f.chunks; i++) parts.push(Buffer.from((await get(`?file=${f.id}&chunk=${i}`)).data, 'base64'));
  const name = `${f.slot}-${f.who}-${f.id.slice(0, 6)}-${f.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  writeFileSync(join(outDir, name), Buffer.concat(parts));
  screenshots.find((s) => s.slot === f.slot).uploads.find((u) => u.name === f.name && u.who === f.who && !u.file).file = name;
  console.log(`saved ${name}`);
}
const dir = join(hoahx, 'docs/launch/register-store');
mkdirSync(dir, { recursive: true });
const out = join(dir, `app-review-answers-${stamp}.json`);
writeFileSync(out, JSON.stringify({ pulledAt: new Date().toISOString(), site, questions, screenshots }, null, 2) + '\n');
console.log(`wrote ${out}`);
