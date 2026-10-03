#!/usr/bin/env node
/**
 * Reads the owners' answers from the shared store (GET /api/answers?full=1) and writes them as
 * the Mark / Note blocks that /decide applies to decisions.md: one block per register entry.
 *
 *   npm run pull:answers                       # live site, printed
 *   npm run pull:answers -- --out ../hoahx/docs/launch/register-store/answers-2026-09-29.md
 *   npm run pull:answers -- --site http://localhost:8789 --key <passphrase>
 *   npm run pull:answers -- --hoahx <path to the HOAhx checkout>
 *   npm run pull:answers -- --out <md> --accept-file ../hoahx/docs/launch/register-store/answers-to-accept-2026-10-03.json
 *                                              # also sorts every answer Jacob has not decided yet for
 *                                              # his accept step (clean / open-point / discuss), keeping
 *                                              # the intake lane's drafted replies on unchanged answers
 *   npm run pull:answers -- --store <snapshot.json> ...   # read a saved snapshot instead of the store
 *
 * The published files carry no internal numbering, so every answer is mapped back through the
 * wording source in the HOAhx repo (docs/launch/recommendations.json, docs/launch/screen-review.json).
 *
 * A question:
 *   Agree  -> Mark: Change · Note: "Agreed with the recommendation of <date>: <its text>"
 *             (the recommendation, not the entry's Planned line, is the answer to record)
 *   Change -> Mark: Change · Note: the owners' words, then the recommendation they were changing
 *   Change with nothing written, and Discuss -> Mark: Discuss, with the note if there is one
 *   An entry with several questions (card A23) gets one block once all of them are answered.
 * A screen:
 *   Signed off -> the screen is accepted: date it on its stub; the register entry is untouched
 *   Change     -> a Follows candidate on the register entry with the owners' words, never a reopen
 *   Discuss    -> Mark: Discuss; put it on the next call
 * An answer the page saved per card, before it asked per question, is listed and never applied.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAcceptRows, buildPull, checkAccepted, checkSource } from './answers-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const site = opt('--site', 'https://hoahx-requirements.netlify.app').replace(/\/$/, '');
const key = opt('--key', process.env.DECISION_EDIT_KEY || '');
const out = opt('--out', '');
const hoahx = resolve(root, opt('--hoahx', '../hoahx'));

function fail(message) { console.error(`pull-answers: ${message}`); process.exit(1); }
const readJson = (path, what) => {
  if (!existsSync(path)) fail(`${what} not found: ${path} (pass --hoahx <path to the HOAhx checkout>)`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return fail(`${what} is not valid JSON: ${e.message}`); }
};

const source = readJson(resolve(root, opt('--source', join(hoahx, 'docs/launch/recommendations.json'))), 'the wording source');
try { checkSource(source); } catch (e) { fail(e.message); }
const screens = readJson(resolve(root, opt('--screens', join(hoahx, 'docs/launch/screen-review.json'))), 'the screens source');
const settings = join(hoahx, 'docs/launch/owners-questions/sync.json');
const answeredButOpen = existsSync(settings) ? (JSON.parse(readFileSync(settings, 'utf8')).answeredButOpen || []) : [];

let store;
if (opt('--store', '')) {
  const snap = readJson(resolve(opt('--store')), 'the store snapshot');
  store = snap.records || snap;
} else {
  let res;
  try { res = await fetch(site + '/api/answers?full=1' + (key ? '&key=' + encodeURIComponent(key) : ''), { headers: key ? { 'x-edit-key': key } : {} }); } catch (e) { fail(`the store at ${site} could not be reached (${e.message})`); }
  if (res.status === 401) fail('unauthorized; pass --key or set DECISION_EDIT_KEY');
  if (!res.ok) fail(`${res.status} from ${site}`);
  store = await res.json();
}

const pull = buildPull({ source, screens, store, site, now: new Date().toISOString(), answeredButOpen });
if (out) {
  writeFileSync(resolve(out), pull.text);
  console.log(`wrote ${out}`);
  console.log(pull.summary.filter((l) => !l.endsWith('| not answered | |')).join('\n') || 'no question answered yet');
} else console.log(pull.text);

// Jacob's accept step: every answer he has not decided on yet, sorted, for his page and the gate
const acceptFile = opt('--accept-file', '');
if (acceptFile) {
  const acceptedPath = resolve(opt('--accepted', join(hoahx, 'docs/launch/register-store/accepted.json')));
  let accepted = {};
  try { if (existsSync(acceptedPath)) accepted = checkAccepted(JSON.parse(readFileSync(acceptedPath, 'utf8'))); } catch (e) { fail(e.message); }
  const target = resolve(acceptFile);
  const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : [];
  const rows = buildAcceptRows({ source, screens, store, accepted, previous });
  writeFileSync(target, JSON.stringify(rows, null, 1) + '\n');
  const n = (k) => rows.filter((r) => r.sort === k).length;
  console.log(`wrote ${acceptFile}: ${rows.length} answers to accept (${n('clean')} clean, ${n('open-point')} open point, ${n('discuss')} discuss); ${Object.keys(accepted).length} already decided`);
  const undrafted = rows.filter((r) => r.recommendation === 'reply' && !r.draftReply).length;
  if (undrafted) console.log(`${undrafted} open point(s) need a drafted reply in owner wording before they reach Jacob's page`);
}
