#!/usr/bin/env node
/**
 * Reads the owners' answers from the /answers shared store (GET /api/answers?full=1) and
 * writes them as the Mark / Note blocks that /decide applies to decisions.md: one block per
 * D-number, in the order of the cards.
 *
 *   npm run pull:answers                       # live site, printed
 *   npm run pull:answers -- --out ../hoahx/docs/launch/register-store/answers-2026-09-25.md
 *   npm run pull:answers -- --site http://localhost:8788 --key <passphrase>
 *   npm run pull:answers -- --screens ../hoahx/docs/launch/screen-review.json --out …
 *
 * --screens (the source in the HOAhx repo, which carries each screen's register entry and stub;
 * the published screens.json does not) adds a "Screens to review" section for /decide:
 *   Yes     -> the screen is accepted: date it on its stub in docs/prototype/v3/register-stubs.md;
 *              the register entry (already answered) is untouched
 *   Change  -> a Follows candidate on the register entry with the owners' words, never a reopen
 *   Discuss -> Mark: Discuss; ask the owners on the next call
 *
 * How a card's mark reads per D-number:
 *   Agree  -> Mark: Change · Note: "Agreed with the recommendation of <date>: <the lines for that D-number>"
 *             (the recommendation, not the entry's Planned line, is the answer to record)
 *   Change -> Mark: Change · Note: the owners' words, then the recommendation they were changing
 *   Change with nothing written -> Mark: Discuss (there is no answer to record; ask the owners)
 *   D-059 (a recorded answer with four loose ends) is flagged as an addendum, not a change request.
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
const screensPath = opt('--screens', resolve(root, 'go-live/answers/screens.json'));
const ADDENDUM = new Set(['D-059']);

const data = JSON.parse(readFileSync(resolve(root, 'go-live/answers/data.json'), 'utf8'));
const res = await fetch(site + '/api/answers?full=1' + (key ? '&key=' + encodeURIComponent(key) : ''), { headers: key ? { 'x-edit-key': key } : {} });
if (res.status === 401) { console.error('pull-answers: unauthorized; pass --key or set DECISION_EDIT_KEY'); process.exit(1); }
if (!res.ok) { console.error(`pull-answers: ${res.status} from ${site}`); process.exit(1); }
const all = await res.json();

const when = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const lines = [`# Owners' answers on the recommendations · pulled ${new Date().toISOString()} from ${site}/answers`, '', `Recommendations dated ${data.generated}. One block per D-number, in card order; apply with /decide.`, ''];
const sub = all._submission;
lines.push(sub && sub.v ? `Last sent: ${sub.updatedAt}` : 'Not sent yet (the marks below are the live state).', '');
if (all._message && all._message.n) lines.push('## Message', '', all._message.n, '');

// ── screens to review ──
let screens = null;
try { screens = JSON.parse(readFileSync(resolve(screensPath), 'utf8')); } catch (e) { /* no screens published */ }
const screenSummary = [];
let sYes = 0, sChange = 0, sDiscuss = 0, sOpen = 0;
if (screens && screens.features && screens.features.length) {
  lines.push(`## Screens to review (dated ${screens.generated}, due ${screens.due})`, '');
  for (const f of screens.features) for (const sc of f.screens) {
    const rec = all[sc.id];
    const v = rec && rec.v ? rec.v : '';
    const note = rec && rec.n ? String(rec.n).trim() : '';
    const status = v === 'yes' ? 'Yes' : v === 'change' ? (note ? 'Change' : 'Change, nothing written') : v === 'discuss' ? 'Discuss' : 'not answered';
    const mapping = [sc.register ? `Register: ${sc.register}` : 'Register: (not in this file; pass --screens with the HOAhx source)', sc.stub ? `Stub: ${sc.stub}` : ''].filter(Boolean).join(' · ');
    screenSummary.push(`| ${sc.code} | ${sc.title} | ${sc.register || ''} | ${sc.stub || ''} | ${status} | ${rec && rec.updatedAt ? when(rec.updatedAt) : ''} |`);
    if (!v) { sOpen += 1; continue; }
    lines.push(`### ${sc.id} · ${sc.code} · ${sc.title} — ${status}${rec.updatedAt ? ` (${when(rec.updatedAt)})` : ''}`, mapping);
    if (v === 'yes') { sYes += 1; lines.push('Screen: accepted', `Note: Yes to ${sc.code} as shown on the test site; date the stub ${sc.stub || ''} and build the data behind it.`); }
    else if (v === 'change') { sChange += 1; lines.push(note ? 'Mark: Change' : 'Mark: Discuss', note ? `Note: ${note}` : `Note: (Change pressed on ${sc.code} with nothing written; ask the owners.)`, `Follows: a candidate on ${sc.register || 'its register entry'} with the owners' words, never a reopen (the entry is answered).`); }
    else { sDiscuss += 1; lines.push('Mark: Discuss', `Note: ${note || '(Discuss pressed on ' + sc.code + '; put it on the next call.)'}`); }
    lines.push(`Updated: ${rec.updatedAt || ''}`, '');
  }
  lines.push('| Screen | Title | Register | Stub | Answer | Date |', '|---|---|---|---|---|---|', ...screenSummary, '', `Screens yes ${sYes} · to change ${sChange} · to discuss ${sDiscuss} · not answered ${sOpen}`, '');
}

let agreed = 0, changed = 0, discuss = 0, open = 0;
const summary = [];
for (const card of data.cards) {
  const rec = all[card.id];
  const v = rec && rec.v ? rec.v : '';
  const note = rec && rec.n ? String(rec.n).trim() : '';
  const status = v === 'agree' ? 'Agree' : v === 'change' ? (note ? 'Change' : 'Change, nothing written') : 'not answered';
  summary.push(`| ${card.id} | ${card.title} | ${card.decisions.map((d) => d.id).join(', ')} | ${status} | ${rec && rec.updatedAt ? when(rec.updatedAt) : ''} |`);
  if (!v) { open += 1; continue; }
  lines.push(`## ${card.id} · ${card.title} — ${status}${rec.updatedAt ? ` (${when(rec.updatedAt)})` : ''}`, '');
  for (const d of card.decisions) {
    const recText = card.rec.filter((r) => r.d.includes(d.id)).map((r) => r.text).join(' ');
    lines.push(`### ${d.id} · ${d.code}`);
    if (v === 'agree') { agreed += 1; lines.push('Mark: Change', `Note: Agreed with the recommendation of ${data.generated}: ${recText}`); }
    else if (note) { changed += 1; lines.push('Mark: Change', `Note: ${note}`, `On the recommendation: ${recText}`); }
    else { discuss += 1; lines.push('Mark: Discuss', `Note: (Change pressed on card ${card.id} with nothing written; ask the owners.)`, `On the recommendation: ${recText}`); }
    lines.push(`Updated: ${rec.updatedAt || ''}`);
    if (ADDENDUM.has(d.id)) lines.push(`Addendum: ${d.id} already carries a recorded answer; this completes its open points and is not a change request.`);
    lines.push('');
  }
}
lines.push('## Summary', '', '| Card | Title | Decisions | Mark | Date |', '|---|---|---|---|---|', ...summary, '', `Decisions agreed ${agreed} · changed with a note ${changed} · to discuss ${discuss} · cards not answered ${open} of ${data.cards.length}`, '');
const text = lines.join('\n');
if (out) { writeFileSync(resolve(out), text); console.log(`wrote ${out}`); console.log(summary.join('\n')); } else console.log(text);
