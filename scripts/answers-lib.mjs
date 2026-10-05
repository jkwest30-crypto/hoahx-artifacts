// What the owners' open questions page is built from, as pure functions: the publisher
// (publish-answers.mjs) and the pull (pull-answers.mjs) do the reading and writing, and the
// tests (tests/*.test.mjs) call these directly. No dependencies beyond Node 18.
//
// The rule behind most of this file: the wording source in the HOAhx repo carries the internal
// numbering of every question, and nothing an owner can open may. The published JSON is built
// field by field from a fixed list, never copied, and then searched for what must not be there.
import crypto from 'node:crypto';

// ── guards ──────────────────────────────────────────────────────────────────
// Words the owner-facing documents exclude, and the three marks of the internal numbering.
export const EXCLUDED_WORDS = /\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/g;
export const INTERNAL_MARKS = /register|\bD-\d{3}\b|\bQ-[A-Z]+-\d+\b/gi;

/** Every excluded word and internal mark in a text, each once, in the order met. */
export function findForbidden(text) {
  const hits = [];
  for (const re of [EXCLUDED_WORDS, INTERNAL_MARKS]) {
    for (const m of String(text).matchAll(new RegExp(re.source, re.flags))) if (!hits.includes(m[0])) hits.push(m[0]);
  }
  return hits;
}

/** Throws when a published file carries something an owner must not read. */
export function guardPublished(name, text) {
  const hits = findForbidden(text);
  if (hits.length) throw new Error(`${name} carries ${hits.map((h) => `"${h}"`).join(', ')}, which an owner must not read`);
  if (/localhost|127\.0\.0\.1/.test(text)) throw new Error(`${name} links to a local address`);
}

// ── the register's pending entries ───────────────────────────────────────────
/** The ids of decisions.md, and which of them still read "Answer: pending". */
export function parseRegister(markdown) {
  const all = new Set(), pending = new Set();
  let cur = null;
  for (const line of String(markdown).split('\n')) {
    const m = /^### (D-\d{3}) /.exec(line);
    if (m) { cur = m[1]; all.add(cur); continue; }
    if (cur && /^- Answer: pending\b/.test(line)) pending.add(cur);
  }
  return { all, pending };
}

/**
 * The recorded answer of every entry that is no longer pending, as plain text: the outcome the
 * Answered Questions tab shows as what will be built. "Agreed with the recommendation of <date>:"
 * and markdown emphasis are taken off; the text is still guarded before it is published.
 */
export function parseAnswers(markdown) {
  const out = new Map();
  let cur = null;
  for (const line of String(markdown).split('\n')) {
    const m = /^### (D-\d{3}) /.exec(line);
    if (m) { cur = m[1]; continue; }
    const a = cur && /^- Answer: (.+)$/.exec(line);
    if (a && !/^pending\b/.test(a[1])) {
      out.set(cur, a[1].replace(/\*\*/g, '').replace(/^Agreed with (?:our|the) recommendation(?: of \d{4}-\d{2}-\d{2})?:\s*/i, '').trim());
    }
  }
  return out;
}

// ── the wording source ───────────────────────────────────────────────────────
const LINE_ID = /^A\d{2}-\d{1,2}$/;
const VIDEO_NO = /^\d{2}$/;

/** Checks recommendations.json. Returns counts; throws on the first thing wrong. */
export function checkSource(src) {
  for (const k of ['generated', 'groups', 'cards']) if (!(k in src)) throw new Error(`the source has no "${k}"`);
  if (!Array.isArray(src.groups) || !src.groups.length) throw new Error('groups must be a non-empty array');
  if (!Array.isArray(src.cards) || !src.cards.length) throw new Error('cards must be a non-empty array');
  const groupIds = new Set(src.groups.map((g) => g.id));
  const cardIds = new Set(), lineIds = new Set(), entryOn = new Map();
  let lines = 0;
  for (const c of src.cards) {
    for (const k of ['id', 'group', 'title', 'decisions', 'rec', 'why']) if (!(k in c)) throw new Error(`card ${c.id || '?'} has no "${k}"`);
    if (!/^A\d{2}$/.test(c.id)) throw new Error(`card id "${c.id}" is not A##`);
    if (cardIds.has(c.id)) throw new Error(`card ${c.id} appears twice`);
    cardIds.add(c.id);
    if (!groupIds.has(c.group)) throw new Error(`card ${c.id} names group "${c.group}", which does not exist`);
    if (!c.decisions.length) throw new Error(`card ${c.id} carries no decisions`);
    const own = new Map();
    for (const d of c.decisions) {
      if (!/^D-\d{3}$/.test(d.id)) throw new Error(`card ${c.id}: "${d.id}" is not a D-number`);
      if (!d.code || !d.q) throw new Error(`card ${c.id}: ${d.id} needs a code and a question`);
      if (entryOn.has(d.id)) throw new Error(`${d.id} is on two cards: ${entryOn.get(d.id)} and ${c.id}`);
      entryOn.set(d.id, c.id);
      own.set(d.id, d);
    }
    if (!c.rec.length) throw new Error(`card ${c.id} has no recommendation lines`);
    const sameEntries = new Map();
    for (const r of c.rec) {
      if (!LINE_ID.test(r.id || '')) throw new Error(`card ${c.id}: a recommendation line has no permanent id (A##-n), has "${r.id || ''}"`);
      if (!r.id.startsWith(c.id + '-')) throw new Error(`${r.id} is on card ${c.id}: a line's id starts with its card's`);
      if (lineIds.has(r.id)) throw new Error(`${r.id} appears twice: an id is never given to a second line`);
      lineIds.add(r.id);
      if (!Array.isArray(r.d) || !r.d.length || !r.text) throw new Error(`${r.id}: every recommendation line needs d[] and text`);
      for (const id of r.d) if (!own.has(id)) throw new Error(`${r.id} names ${id}, which card ${c.id} does not carry`);
      if (r.q != null && !questionsOf(r.q).length) throw new Error(`${r.id}: "q" is empty`);
      if (!Array.isArray(r.videos)) throw new Error(`${r.id}: "videos" must be a list (empty when no video shows it built)`);
      for (const n of r.videos) if (!VIDEO_NO.test(n)) throw new Error(`${r.id}: video "${n}" is not a two-digit number`);
      const key = r.d.slice().sort().join('+');
      sameEntries.set(key, (sameEntries.get(key) || []).concat(r));
      lines += 1;
    }
    // Two lines on the same entry would show the same question twice: each needs its own.
    for (const group of sameEntries.values()) {
      if (group.length > 1) for (const r of group) if (r.q == null) throw new Error(`${r.id} shares its entry with ${group.length - 1} other line(s) and has no question of its own ("q")`);
    }
    const covered = new Set(c.rec.flatMap((r) => r.d));
    for (const id of own.keys()) if (!covered.has(id)) throw new Error(`card ${c.id}: ${id} has no recommendation line`);
  }
  return { cards: src.cards.length, lines, entries: entryOn.size };
}

function questionsOf(q) { return (Array.isArray(q) ? q : [q]).map((x) => String(x || '').trim()).filter(Boolean); }

/**
 * The questions as published: one row per recommendation line, no internal numbering.
 * A line's entry that is no longer pending is dropped from it; a line with none left is
 * dropped; a card with no lines left is dropped. `answeredButOpen` names the entries that carry
 * a recorded answer and still have open points on the page; their lines stay until the source
 * gives them `closed`.
 */
export function buildQuestions(src, { pending, answeredButOpen = [], criticalOf = null }) {
  const stay = new Set(answeredButOpen);
  const dropped = [], cards = [];
  for (const c of src.cards) {
    const questionOf = new Map(c.decisions.map((d) => [d.id, d.q]));
    const rows = [];
    for (const r of c.rec) {
      if (r.closed) { dropped.push({ id: r.id, why: `closed ${r.closed}` }); continue; }
      const open = r.d.filter((id) => pending.has(id) || stay.has(id));
      if (!open.length) { dropped.push({ id: r.id, why: `${r.d.join(', ')} no longer pending` }); continue; }
      const qs = r.q != null ? questionsOf(r.q) : open.map((id) => questionOf.get(id));
      const row = { id: r.id, qs, rec: r.text, videos: r.videos.slice() };
      const crit = criticalOf && criticalOf(open);
      if (crit) row.critical = crit;
      rows.push(row);
    }
    if (!rows.length) continue;
    if (criticalOf) rows.splice(0, rows.length, ...criticalFirst(rows, (r) => r.critical && r.critical.date));
    const card = { id: c.id, group: c.group, title: c.title };
    if (c.note) card.note = c.note;
    card.why = c.why;
    card.rows = rows;
    cards.push(card);
  }
  const used = new Set(cards.map((c) => c.group));
  const groups = src.groups.filter((g) => used.has(g.id)).map((g) => ({ id: g.id, title: g.title }));
  if (criticalOf) cards.splice(0, cards.length, ...criticalFirst(cards, (c) => c.rows.reduce((d, r) => (r.critical && (!d || r.critical.date < d) ? r.critical.date : d), '') || ''));
  return { groups, cards, dropped, rows: cards.reduce((n, c) => n + c.rows.length, 0), critical: cards.reduce((n, c) => n + c.rows.filter((r) => r.critical).length, 0) };
}

// ── what is critical ─────────────────────────────────────────────────────────
// One rule, read from the launch program and never from taste:
//   A question is CRITICAL when a task or milestone that its decision blocks (the "Blocks" line
//   of its entry in decisions.md) is due within CRITICAL_WINDOW_DAYS working days from today and
//   is not done. A task is due when its milestone is (the milestone its backlog section names).
//   A screen is CRITICAL when another screen leads to it (its sign-off decides what that screen
//   goes to), or when a task or milestone blocked by its own entry is due within the same window.
// Order: critical first, soonest due first, then the rest in the order they already had.
// What the data cannot say (a lane's work, a release blocker) is not guessed: it is not critical.
export const CRITICAL_WINDOW_DAYS = 10;
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const isoDay = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The date `n` working days (Monday to Friday) after `iso`. */
export function addWorkingDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1; }
  return d.toISOString().slice(0, 10);
}
/** "Sep 30" for 2026-09-30. */
export const shortDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${Object.keys(MONTHS)[m - 1]} ${d}`; };

/**
 * The milestones of plan.md (`| M8 | name | Sep 18 → **Sep 30** | …`) with their date, and which of
 * them status.md reads as done. A milestone whose target is not one plain date is left out.
 */
export function parseMilestones(planMd, statusMd, year = 2026) {
  const out = {};
  for (const line of String(planMd).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^M\d+[a-d]?$/.test(cells[1])) continue;
    const bold = /\*\*(?:done )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\*\*/i.exec(cells[3]);
    const plain = /^(Jan|Feb|Mar|Apr|Sep|Oct|Nov|Dec) (\d{1,2})$/.exec(cells[3]);
    const hit = bold || plain;
    if (!hit) continue;
    out[cells[1]] = { name: cells[2], date: isoDay(year, MONTHS[hit[1][0].toUpperCase() + hit[1].slice(1).toLowerCase()], Number(hit[2])), done: /\bdone\b/i.test(cells[3]) };
  }
  for (const line of String(statusMd).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6 || !/^M\d/.test(cells[1])) continue;
    if (!/^\**Done\b/i.test(cells[cells.length - 2])) continue;
    for (const id of cells[1].split('/').map((x) => x.trim())) if (out[id]) out[id].done = true;
  }
  return out;
}

/** Which milestone each task of backlog.md belongs to: the one its section heading names. */
export function parseTaskMilestones(backlogMd) {
  const out = {};
  let cur = null;
  for (const line of String(backlogMd).split('\n')) {
    const h = /^#{2,3} (.*)/.exec(line);
    if (h) { const m = /milestone (M\d+[a-d]?)/.exec(h[1]); cur = m ? m[1] : null; continue; }
    const r = /^\| ([A-Z]{1,3}\d+) \|/.exec(line);
    if (r && cur && !(r[1] in out)) out[r[1]] = cur;
  }
  return out;
}

/** What each entry of decisions.md blocks: `D-049` -> ['N3', 'M7']. */
export function parseBlocks(decisionsMd) {
  const out = {};
  let cur = null;
  for (const line of String(decisionsMd).split('\n')) {
    const m = /^### (D-\d{3}) /.exec(line);
    if (m) { cur = m[1]; continue; }
    const b = cur && /^- Blocks: (.*)$/.exec(line);
    if (b) out[cur] = b[1].replace(/\([^)]*\)/g, '').match(/\b[A-Z]{1,3}\d+[a-d]?\b/g) || [];
  }
  return out;
}

/** Which screens lead to which: `C2` opens `C1`, `C4`, `C6`, so C1 is led to by C2. */
export function parseScreenLinks(screensMd) {
  const ledBy = {};
  let code = null;
  for (const line of String(screensMd).split('\n')) {
    const h = /^### ([A-Z]\d{1,2}) · /.exec(line);
    if (h) { code = h[1]; continue; }
    if (/^#{1,3} /.test(line)) { code = null; continue; }
    if (!code || !/^- (Shows|Can do|Where):/.test(line)) continue;
    for (const to of new Set(line.match(/\b[A-Z]\d{1,2}\b/g) || [])) if (to !== code) (ledBy[to] = ledBy[to] || new Set()).add(code);
  }
  return Object.fromEntries(Object.entries(ledBy).map(([k, v]) => [k, [...v].sort()]));
}

/**
 * The earliest due item among `items` (task or milestone ids) inside the window, or null.
 * `plan` = { milestones, taskMilestone, today, windowDays }.
 */
export function dueWithin(items, plan) {
  const limit = addWorkingDays(plan.today, plan.windowDays ?? CRITICAL_WINDOW_DAYS);
  let best = null;
  for (const id of items) {
    const mid = /^M\d/.test(id) ? id : plan.taskMilestone[id];
    const m = mid && plan.milestones[mid];
    if (!m || m.done || m.date < plan.today || m.date > limit) continue;
    if (!best || m.date < best.date) best = { date: m.date, name: m.name, milestone: mid, via: id };
  }
  return best;
}

const lowerFirst = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
/** The one plain line an owner reads under a critical question. */
export const criticalLine = (due) => `Needed by ${shortDay(due.date)}: ${lowerFirst(due.name)}.`;

/**
 * For a question row: its decisions' blocks, judged against the plan.
 * Returns { date, why } or null.
 */
export function criticalForEntries(entryIds, blocksOf, plan) {
  const due = dueWithin(entryIds.flatMap((id) => blocksOf[id] || []), plan);
  return due ? { date: due.date, why: criticalLine(due) } : null;
}

/**
 * For a screen: another screen leading to it (due when the screens are signed off, the date of
 * the sign-off milestone), or a task its own entry blocks. Returns { date, why } or null.
 */
export function criticalForScreen(code, entryId, { blocksOf, ledBy }, plan, signOff) {
  const found = [];
  const due = dueWithin(blocksOf[entryId] || [], plan);
  if (due) found.push({ date: due.date, why: criticalLine(due) });
  const from = ledBy[code] || [];
  if (from.length && signOff && !signOff.done && signOff.date >= plan.today) {
    found.push({ date: signOff.date, why: `Needed by ${shortDay(signOff.date)}: ${from.join(' and ')} lead${from.length === 1 ? 's' : ''} to this screen, so it is signed off first.` });
  }
  found.sort((a, b) => a.date.localeCompare(b.date));
  return found[0] || null;
}

/** Critical first (soonest due first), then the rest in the order they came. Stable. */
export function criticalFirst(list, dateOf) {
  const key = (x) => dateOf(x) || '9999-99-99';
  return list.map((x, i) => ({ x, i })).sort((a, b) => key(a.x).localeCompare(key(b.x)) || a.i - b.i).map((e) => e.x);
}

// ── the screens ──────────────────────────────────────────────────────────────
/** The features and screens of SCREENS.md: `## FEATURE A · title (7 screens)`, `### A1 · title`. */
export function parseScreensSpec(markdown) {
  const features = [];
  let cur = null;
  for (const line of String(markdown).split('\n')) {
    const f = /^## FEATURE ([A-Z]) · (.+?)(?: \(\d+ screens?\))?\s*$/.exec(line);
    if (f) { cur = { id: f[1], title: f[2], screens: [] }; features.push(cur); continue; }
    const s = /^### ([A-Z])(\d{1,2}) · (.+?)\s*$/.exec(line);
    if (s) {
      if (!cur || cur.id !== s[1]) throw new Error(`the spec lists ${s[1]}${s[2]} outside feature ${s[1]}`);
      cur.screens.push({ code: s[1] + s[2], title: s[3] });
    }
  }
  return features;
}

/** The screen code a preview module registers (`code: 'A1'`), or '' when it names none. */
export function previewCode(moduleText) {
  return (/\bcode:\s*['"]([A-Z]\d{1,2})['"]/.exec(String(moduleText)) || [])[1] || '';
}

/**
 * The screens as published: the spec decides which screens exist, in which order and under
 * which title; the source adds the owners' wording and the videos; a screen with no preview
 * module has nothing to link to and is refused. The source's internal mapping never leaves it.
 * `walkthroughs` adds the film of a screen where there is one to link (resolveWalkthroughs).
 */
export function buildScreens(source, spec, builtCodes, expected, walkthroughs = {}, criticalOf = null) {
  for (const k of ['previewUrl', 'features']) if (!(k in source)) throw new Error(`the screens source has no "${k}"`);
  if (!/^https:\/\//.test(source.previewUrl)) throw new Error('the screens source needs an https previewUrl');
  const wording = new Map();
  for (const f of source.features) for (const sc of f.screens) {
    if (wording.has(sc.code)) throw new Error(`the screens source lists ${sc.code} twice`);
    if (!/^D-\d{3}$/.test(sc.register || '')) throw new Error(`the screens source needs ${sc.code}'s register entry (D-###)`);
    if (!/^F-\d{3}$/.test(sc.stub || '')) throw new Error(`the screens source needs ${sc.code}'s stub (F-###)`);
    wording.set(sc.code, sc);
  }
  const built = new Set(builtCodes);
  const inSpec = new Set();
  const features = spec.map((f) => ({
    id: f.id,
    title: f.title,
    screens: f.screens.map((s) => {
      inSpec.add(s.code);
      const w = wording.get(s.code);
      if (!w || !String(w.look || '').trim()) throw new Error(`${s.code} (${s.title}) has no description in the screens source`);
      if (!built.has(s.code)) throw new Error(`${s.code} (${s.title}) has no preview module, so there is nothing to open`);
      const videos = w.videos || [];
      if (!Array.isArray(videos)) throw new Error(`${s.code}: "videos" must be a list`);
      for (const n of videos) if (!VIDEO_NO.test(n)) throw new Error(`${s.code}: video "${n}" is not a two-digit number`);
      const out = { id: 'S-' + s.code, code: s.code, title: s.title, what: String(w.look).trim(), url: source.previewUrl + '/' + s.code, videos: videos.slice() };
      const walk = walkthroughs[s.code];
      if (walk) out.walk = { seconds: Math.round(walk.seconds), url: walk.url };
      const crit = criticalOf && criticalOf(s.code, w.register);
      if (crit) out.critical = crit;
      return out;
    }),
  }));
  for (const code of wording.keys()) if (!inSpec.has(code)) throw new Error(`the screens source describes ${code}, which the spec does not list`);
  const total = features.reduce((n, f) => n + f.screens.length, 0);
  if (expected && total !== expected) throw new Error(`expected ${expected} screens, the spec lists ${total}`);
  return { previewUrl: source.previewUrl, features, total, critical: features.reduce((n, f) => n + f.screens.filter((x) => x.critical).length, 0) };
}

// ── the videos ───────────────────────────────────────────────────────────────
/**
 * What a video shows, as the recorder computes it (scripts/demo-videos/record-demos.cjs in the
 * HOAhx repo): the demo file, the test it mirrors and the screens it covers, by content, plus
 * its captions. `hashOf(path)` returns the git blob id of a file, or 'missing'.
 */
export function videoFingerprint(entry, hashOf) {
  const files = [entry.demoFile, entry.linkedTest && entry.linkedTest.file, ...(entry.covers || [])].filter(Boolean).sort();
  const text = ['v1', ...files.map((f) => `${f}:${hashOf(f)}`), `lines:${JSON.stringify(entry.lines || {})}`].join('\n');
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export const driveLink = (id) => `https://drive.google.com/file/d/${id}/view`;

/**
 * Title, length and link for every video number the page names. Refuses, naming each one and
 * why, a video that was never recorded, whose screens changed since it was recorded, or that
 * has no file in the Drive folder.
 *   manifest    the recorder's manifest.json
 *   storyboard  the recorder's storyboard.json at the ref the videos are judged against
 *   hashOf      path -> git blob id at that ref, or 'missing'
 *   driveFiles  [{ Name, ID }] from `rclone lsjson`
 */
export function resolveVideos(numbers, { manifest, storyboard, hashOf, driveFiles }) {
  const wanted = [...new Set(numbers)].sort();
  const recorded = new Map();
  for (const [id, v] of Object.entries((manifest && manifest.videos) || {})) recorded.set(id.slice(0, 2), Object.assign({ id }, v));
  const drive = new Map();
  for (const f of driveFiles || []) { const m = /^(\d{2})-.+\.mp4$/.exec(f.Name || ''); if (m && f.ID) drive.set(m[1] + '|' + f.Name, f.ID); }
  const videos = {}, refused = [];
  for (const n of wanted) {
    const v = recorded.get(n);
    if (!v) { refused.push(`${n}: not recorded (no entry in the manifest)`); continue; }
    const scripted = ((storyboard && storyboard.videos) || []).find((x) => x.id === v.id);
    if (!scripted) { refused.push(`${n} (${v.title}): not in the storyboard, so it cannot be checked against the screens it shows`); continue; }
    const now = videoFingerprint(scripted, hashOf);
    if (now !== v.fingerprint) { refused.push(`${n} (${v.title}): not current, the screens or the test it shows changed since it was recorded`); continue; }
    const id = drive.get(n + '|' + v.file);
    if (!id) { refused.push(`${n} (${v.title}): no file named ${v.file} in the Drive folder`); continue; }
    if (!Number.isFinite(v.seconds) || v.seconds <= 0) { refused.push(`${n} (${v.title}): the manifest gives no length`); continue; }
    videos[n] = { title: v.title, seconds: Math.round(v.seconds), url: driveLink(id) };
  }
  if (refused.length) throw new Error('video links refused:\n  ' + refused.join('\n  '));
  return videos;
}

// ── the screen walk-throughs ─────────────────────────────────────────────────
// One film per screen, state by state, so that watching a screen is an alternative to opening
// it and stepping through it. This is not a feature video: a feature-video link on this page
// means "this is built", and every screen has a walk-through whether it is built or not.
// A walk-through's identity is the screen's own code, so there is no second numbering.
const REL_IMPORT = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
const TS_EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * The files one screen is made of: its preview module and, through it, every file it imports
 * by a relative path — its view, its fixtures and the helpers beside them. Imports written
 * against the "@/" alias are left out on purpose: a change to a shared button is not a change
 * to this screen, and 27 walk-throughs must not all go stale because one was restyled.
 *   entry   the screen's *.preview.ts path
 *   exists  path -> is there a file at this path in the tree
 *   read    path -> its text, or null
 */
export function previewClosure(entry, { exists, read }) {
  const resolve = (from, spec) => {
    const out = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.') continue;
      else if (part === '..') out.pop();
      else out.push(part);
    }
    const base = out.join('/');
    for (const ext of TS_EXTS) if (exists(base + ext)) return base + ext;
    return null;
  };
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text == null) continue;
    for (const m of String(text).matchAll(REL_IMPORT)) {
      const target = resolve(file, m[1]);
      if (target) queue.push(target);
    }
  }
  return [...seen].sort();
}

/** What a screen is, by content: its files and their blob ids. `hashOf` gives 'missing' for none. */
export function screenFingerprint(files, hashOf) {
  const text = ['s1', ...files.map((f) => `${f}:${hashOf(f)}`)].join('\n');
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The walk-through link for every screen that may have one, and why each of the others may not.
 * Unlike a feature video, whose number is named by hand, a walk-through is looked up for all 27
 * at once — so one that cannot be linked is left off the page and reported, never fatal.
 *
 *   manifest   screen-walkthroughs.json from the launch program
 *   driveFiles [{ Name, ID }] from `rclone lsjson` of the folder the takes were uploaded to
 *   current    code -> true when the screen's files are the ones the take was filmed from
 *   readable   url  -> true when the Drive link opens for someone who was only given the link
 * @returns { walkthroughs: { "A1": { seconds, url } }, refused: ["A1: …"] }
 */
export function resolveWalkthroughs(codes, { manifest, driveFiles, current, readable }) {
  const filmed = new Map(((manifest && manifest.walkthroughs) || []).map((w) => [w.code, w]));
  const inDrive = new Map((driveFiles || []).filter((f) => f.ID).map((f) => [f.Name, f.ID]));
  const walkthroughs = {};
  const refused = [];
  for (const code of [...new Set(codes)].sort()) {
    const w = filmed.get(code);
    if (!w) { refused.push(`${code}: never filmed (no entry in the walk-through manifest)`); continue; }
    if (!Number.isFinite(w.seconds) || w.seconds <= 0) { refused.push(`${code}: the manifest gives no length`); continue; }
    if (!current(code)) { refused.push(`${code} (${w.title}): not current, the screen changed since it was filmed at ${w.commit}`); continue; }
    const id = inDrive.get(w.file);
    if (!id) { refused.push(`${code} (${w.title}): no file named ${w.file} in the Drive folder`); continue; }
    const url = driveLink(id);
    if (!readable(url)) { refused.push(`${code} (${w.title}): the Drive file is not readable by link, so the owners would meet a sign-in page`); continue; }
    walkthroughs[code] = { seconds: Math.round(w.seconds), url };
  }
  return { walkthroughs, refused };
}

/** Every video number the questions and the screens name. */
export function videoNumbers(questions, screens) {
  return [
    ...questions.cards.flatMap((c) => c.rows.flatMap((r) => r.videos)),
    ...screens.features.flatMap((f) => f.screens.flatMap((s) => s.videos)),
  ];
}

// ── the published files ──────────────────────────────────────────────────────
/**
 * The two files the page reads. `updated` moves only when something an owner reads changed:
 * a run that changes nothing keeps the date the page already shows.
 */
export function buildPublished({ questions, screens, videos, today, previous, answered = [] }) {
  const data = { updated: today, groups: questions.groups, cards: questions.cards, answered, videos };
  const scr = { updated: today, previewUrl: screens.previewUrl, features: screens.features };
  const same = (a, b) => b && JSON.stringify(Object.assign({}, a, { updated: '' })) === JSON.stringify(Object.assign({}, b, { updated: '' }));
  const prev = previous || {};
  if (same(data, prev.data) && same(scr, prev.screens) && prev.data.updated) { data.updated = prev.data.updated; scr.updated = prev.screens.updated || prev.data.updated; }
  return { data, screens: scr };
}

function checkCritical(where, c) {
  if (!c || typeof c !== 'object') throw new Error(`${where} has a "critical" that is not a reason`);
  for (const k of Object.keys(c)) if (k !== 'date' && k !== 'why') throw new Error(`${where}: critical carries "${k}", which the page does not read`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || '')) throw new Error(`${where}: critical has no date`);
  if (!/^Needed by [A-Z][a-z]{2} \d{1,2}: .+\.$/.test(c.why || '')) throw new Error(`${where}: critical must say why in one plain line ("Needed by <date>: <what>.")`);
}

/** Checks a published pair as the page will read it. Returns counts; throws on anything wrong. */
export function checkPublished(data, screens) {
  for (const k of ['updated', 'groups', 'cards', 'videos']) if (!(k in data)) throw new Error(`data.json has no "${k}"`);
  for (const k of ['updated', 'previewUrl', 'features']) if (!(k in screens)) throw new Error(`screens.json has no "${k}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) throw new Error('data.json: "updated" is not a date');
  const groups = new Set(data.groups.map((g) => g.id));
  const ids = new Set();
  const allowedCard = new Set(['id', 'group', 'title', 'note', 'why', 'rows']);
  const allowedRow = new Set(['id', 'qs', 'rec', 'videos', 'critical', 'reply']);
  let rows = 0;
  for (const c of data.cards) {
    for (const k of Object.keys(c)) if (!allowedCard.has(k)) throw new Error(`data.json: card ${c.id} carries "${k}", which the page does not read`);
    if (!groups.has(c.group)) throw new Error(`data.json: card ${c.id} names a group that is not published`);
    if (!Array.isArray(c.rows) || !c.rows.length) throw new Error(`data.json: card ${c.id} has no questions`);
    for (const r of c.rows) {
      for (const k of Object.keys(r)) if (!allowedRow.has(k)) throw new Error(`data.json: ${r.id} carries "${k}", which the page does not read`);
      if (!LINE_ID.test(r.id) || !r.id.startsWith(c.id + '-')) throw new Error(`data.json: "${r.id}" is not a question id of card ${c.id}`);
      if (ids.has(r.id)) throw new Error(`data.json: ${r.id} appears twice`);
      ids.add(r.id);
      if (!Array.isArray(r.qs) || !r.qs.length || r.qs.some((q) => !q)) throw new Error(`data.json: ${r.id} has no question`);
      if (!r.rec) throw new Error(`data.json: ${r.id} has no recommendation`);
      if ('critical' in r) checkCritical(`data.json: ${r.id}`, r.critical);
      if ('reply' in r && !String(r.reply || '').trim()) throw new Error(`data.json: ${r.id} has an empty reply`);
      for (const n of r.videos) if (!data.videos[n]) throw new Error(`data.json: ${r.id} names video ${n}, which has no link`);
      rows += 1;
    }
  }
  const answered = data.answered || [];
  if (!Array.isArray(answered)) throw new Error('data.json: "answered" is not a list');
  const allowedAnswered = { question: new Set(['id', 'kind', 'card', 'qs', 'answer', 'rec', 'build', 'answeredOn', 'acceptedOn', 'status']), screen: new Set(['id', 'kind', 'code', 'card', 'qs', 'answer', 'build', 'url', 'answeredOn', 'acceptedOn', 'status']) };
  const answeredIds = new Set();
  for (const a of answered) {
    const allowed = allowedAnswered[a && a.kind];
    if (!allowed) throw new Error(`data.json: an answered item has kind "${a && a.kind}"`);
    for (const k of Object.keys(a)) if (!allowed.has(k)) throw new Error(`data.json: answered ${a.id} carries "${k}", which the page does not read`);
    if (a.kind === 'question' ? !LINE_ID.test(a.id) : !SCREEN_ID.test(a.id)) throw new Error(`data.json: answered "${a.id}" is not a ${a.kind} id`);
    if (ids.has(a.id)) throw new Error(`data.json: ${a.id} is both open and answered`);
    if (answeredIds.has(a.id)) throw new Error(`data.json: ${a.id} is answered twice`);
    answeredIds.add(a.id);
    if (!Array.isArray(a.qs) || !a.qs.length || a.qs.some((q) => !q)) throw new Error(`data.json: answered ${a.id} has no question`);
    if (!String(a.build || '').trim()) throw new Error(`data.json: answered ${a.id} does not say what will be built`);
    if (!ANSWER_STATUSES.includes(a.status)) throw new Error(`data.json: answered ${a.id} has status "${a.status}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.acceptedOn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(a.answeredOn || '')) throw new Error(`data.json: answered ${a.id} has no dates`);
    const ok = a.kind === 'question' ? ['agree', 'change', 'discuss'] : ['yes', 'change'];
    if (!ok.includes(a.answer)) throw new Error(`data.json: answered ${a.id} has answer "${a.answer}"`);
  }
  const allowedScreen = new Set(['id', 'code', 'title', 'what', 'url', 'videos', 'walk', 'critical', 'reply']);
  const codes = new Set();
  for (const f of screens.features) for (const s of f.screens) {
    for (const k of Object.keys(s)) if (!allowedScreen.has(k)) throw new Error(`screens.json: ${s.code} carries "${k}", which the page does not read`);
    if (s.id !== 'S-' + s.code || s.code[0] !== f.id) throw new Error(`screens.json: ${s.code} does not belong where it is`);
    if (codes.has(s.code)) throw new Error(`screens.json: ${s.code} appears twice`);
    codes.add(s.code);
    if (!s.what || !s.title) throw new Error(`screens.json: ${s.code} has no title or description`);
    if ('critical' in s) checkCritical(`screens.json: ${s.code}`, s.critical);
    if ('reply' in s && !String(s.reply || '').trim()) throw new Error(`screens.json: ${s.code} has an empty reply`);
    if (s.url !== screens.previewUrl + '/' + s.code) throw new Error(`screens.json: ${s.code} links to ${s.url}`);
    for (const n of s.videos) if (!data.videos[n]) throw new Error(`screens.json: ${s.code} names video ${n}, which has no link`);
    if ('walk' in s) {
      const w = s.walk;
      if (!w || typeof w !== 'object') throw new Error(`screens.json: ${s.code} has a "walk" that is not a link`);
      for (const k of Object.keys(w)) if (k !== 'seconds' && k !== 'url') throw new Error(`screens.json: ${s.code}'s walk carries "${k}", which the page does not read`);
      if (!(w.seconds > 0)) throw new Error(`screens.json: ${s.code}'s walk has no length`);
      if (!/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/.test(w.url || '')) throw new Error(`screens.json: ${s.code}'s walk has no Drive link`);
    }
  }
  for (const [n, v] of Object.entries(data.videos)) {
    if (!VIDEO_NO.test(n) || !v.title || !(v.seconds > 0) || !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/.test(v.url)) throw new Error(`data.json: video ${n} is incomplete`);
  }
  const critical = { rows: data.cards.reduce((n, c) => n + c.rows.filter((r) => r.critical).length, 0), screens: screens.features.reduce((n, f) => n + f.screens.filter((x) => x.critical).length, 0) };
  for (const a of answered) if (a.kind === 'screen' && !codes.has(a.code)) throw new Error(`data.json: answered ${a.id} is not a published screen`);
  return { cards: data.cards.length, rows, screens: codes.size, videos: Object.keys(data.videos).length, critical, answered: answered.length };
}

/** What changed between two published pairs, in plain lines, for the person running the sync. */
export function describeChange(before, after) {
  const out = [];
  const rowsOf = (d) => new Map(((d && d.cards) || []).flatMap((c) => (c.rows || []).map((r) => [r.id, Object.assign({ card: c.title }, r)])));
  const a = rowsOf(before && before.data), b = rowsOf(after.data);
  for (const [id, r] of b) {
    const was = a.get(id);
    if (!was) out.push(`+ question ${id}: ${r.qs.join(' / ')}`);
    else {
      if (JSON.stringify(was.qs) !== JSON.stringify(r.qs)) out.push(`~ question ${id}: the question reads differently`);
      if (was.rec !== r.rec) out.push(`~ question ${id}: the recommendation reads differently`);
      if (JSON.stringify(was.videos) !== JSON.stringify(r.videos)) out.push(`~ question ${id}: videos ${was.videos.join(', ') || 'none'} -> ${r.videos.join(', ') || 'none'}`);
      if (JSON.stringify(was.critical || null) !== JSON.stringify(r.critical || null)) out.push(`~ question ${id}: ${r.critical ? 'critical, ' + r.critical.why : 'no longer critical'}`);
    }
  }
  for (const [id, r] of a) if (!b.has(id)) out.push(`- question ${id}: ${r.qs.join(' / ')}`);
  const scrOf = (s) => new Map(((s && s.features) || []).flatMap((f) => f.screens.map((x) => [x.code, x])));
  const sa = scrOf(before && before.screens), sb = scrOf(after.screens);
  for (const [code, s] of sb) {
    const was = sa.get(code);
    if (!was) out.push(`+ screen ${code}: ${s.title}`);
    else if (was.title !== s.title || (was.what || was.look) !== s.what || JSON.stringify(was.videos || []) !== JSON.stringify(s.videos)) out.push(`~ screen ${code}: ${s.title}`);
    if (was && JSON.stringify(was.critical || null) !== JSON.stringify(s.critical || null)) out.push(`~ screen ${code}: ${s.critical ? 'critical, ' + s.critical.why : 'no longer critical'}`);
    const wa = was && was.walk, wb = s.walk;
    if (was && JSON.stringify(wa || null) !== JSON.stringify(wb || null)) {
      out.push(wb && !wa ? `+ screen ${code}: a video of it, ${wb.seconds}s`
        : wa && !wb ? `- screen ${code}: its video is no longer linked`
        : `~ screen ${code}: a new video of it, ${wb.seconds}s`);
    }
  }
  for (const [code, s] of sa) if (!sb.has(code)) out.push(`- screen ${code}: ${s.title}`);
  for (const [id, r] of b) { const was = a.get(id); if (was && (was.reply || '') !== (r.reply || '')) out.push(r.reply ? `~ question ${id}: our reply shown` : `~ question ${id}: our reply removed`); }
  for (const [code, s] of sb) { const was = sa.get(code); if (was && (was.reply || '') !== (s.reply || '')) out.push(s.reply ? `~ screen ${code}: our reply shown` : `~ screen ${code}: our reply removed`); }
  const ansOf = (d) => new Map(((d && d.answered) || []).map((x) => [x.id, x]));
  const aa = ansOf(before && before.data), ab = ansOf(after.data);
  for (const [id, x] of ab) {
    const was = aa.get(id);
    if (!was) out.push(`+ answered ${id}: ${x.qs.join(' / ')} (${x.status})`);
    else if (was.status !== x.status) out.push(`~ answered ${id}: ${was.status} -> ${x.status}`);
    else if (was.build !== x.build) out.push(`~ answered ${id}: what will be built reads differently`);
  }
  for (const [id, x] of aa) if (!ab.has(id)) out.push(`- answered ${id}: ${x.qs.join(' / ')}`);
  return out;
}

// ── the pull ─────────────────────────────────────────────────────────────────
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const live = (rec) => (rec && rec.v ? rec : null);

/**
 * The owners' answers as the blocks /decide applies: one per register entry, mapped through
 * the wording source (the published files carry no internal numbering).
 *   Agree    -> Mark: Change, the recommendation as the answer to record
 *   Change   -> Mark: Change, the owners' words, then the recommendation they were changing
 *   Change with nothing written, and Discuss -> Mark: Discuss, with the note if there is one
 * An entry with several questions (card A23) gets one block once every one of them is
 * answered; until then it is held, and says so.
 */
export function buildPull({ source, screens, store, site, now, answeredButOpen = [] }) {
  const addendum = new Set(answeredButOpen);
  const out = [`# Owners' answers on the open questions · pulled ${now} from ${site}`, '', `Wording dated ${source.generated}. One block per register entry, in card order; apply with /decide.`, ''];
  const sub = store._submission;
  out.push(sub && sub.v ? `Last sent: ${sub.updatedAt}` : 'Not sent yet (the marks below are the live state).', '');
  if (store._message && store._message.n) out.push('## Message', '', store._message.n, '');

  // screens
  const listed = new Set();
  const screenRows = [];
  const count = { yes: 0, change: 0, discuss: 0, open: 0 };
  if (screens && screens.features && screens.features.length) {
    out.push('## Screens', '');
    for (const f of screens.features) for (const sc of f.screens) {
      listed.add(sc.id);
      const rec = live(store[sc.id]);
      const note = rec && rec.n ? String(rec.n).trim() : '';
      const status = !rec ? 'not reviewed' : rec.v === 'yes' ? 'Signed off' : rec.v === 'change' ? (note ? 'Change' : 'Change, nothing written') : 'Discuss';
      screenRows.push(`| ${sc.code} | ${sc.title} | ${sc.register || ''} | ${sc.stub || ''} | ${status} | ${rec ? day(rec.updatedAt) : ''} | ${rec && rec.by ? rec.by : ''} |`);
      if (!rec) { count.open += 1; continue; }
      out.push(`### ${sc.id} · ${sc.code} · ${sc.title} — ${status}${rec.updatedAt ? ` (${day(rec.updatedAt)})` : ''}`, [sc.register ? `Register: ${sc.register}` : '', sc.stub ? `Stub: ${sc.stub}` : ''].filter(Boolean).join(' · '));
      if (rec.v === 'yes') { count.yes += 1; out.push('Screen: accepted', `Note: Signed off on ${sc.code} as shown on the test site; date the stub ${sc.stub || ''} and build the data behind it.`); }
      else if (rec.v === 'change') { count.change += 1; out.push(note ? 'Mark: Change' : 'Mark: Discuss', note ? `Note: ${note}` : `Note: (Change pressed on ${sc.code} with nothing written; ask the owners.)`, `Follows: a candidate on ${sc.register || 'its register entry'} with the owners' words, never a reopen (the entry is answered).`); }
      else { count.discuss += 1; out.push('Mark: Discuss', `Note: ${note || '(Discuss pressed on ' + sc.code + ' with nothing written; put it on the next call.)'}`); }
      if (rec.by) out.push(`By: ${rec.by}`);
      out.push(`Updated: ${rec.updatedAt || ''}`, '');
    }
    out.push('| Screen | Title | Register | Stub | Answer | Date | By |', '|---|---|---|---|---|---|---|', ...screenRows, '', `Screens signed off ${count.yes} · to change ${count.change} · to discuss ${count.discuss} · not reviewed ${count.open}`, '');
  }
  const extra = Object.keys(store).filter((id) => /^S-[A-Z]\d{1,2}$/.test(id) && !listed.has(id) && live(store[id])).sort();
  if (extra.length) {
    out.push('## Screens answered on the test site that the source does not list', '', 'Map each to its register entry and stub by hand before /decide.', '');
    for (const id of extra) {
      const rec = store[id];
      out.push(`### ${id} — ${rec.v}${rec.updatedAt ? ` (${day(rec.updatedAt)})` : ''}`);
      if (rec.n) out.push(`Note: ${String(rec.n).trim()}`);
      if (rec.by) out.push(`By: ${rec.by}`);
      out.push(`Updated: ${rec.updatedAt || ''}`, '');
    }
  }

  // questions
  const tally = { agreed: 0, changed: 0, discuss: 0, held: 0, open: 0 };
  const summary = [];
  out.push('## Questions', '');
  for (const card of source.cards) {
    const blocks = [];
    for (const d of card.decisions) {
      const lines = card.rec.filter((r) => r.d.includes(d.id) && !r.closed);
      if (!lines.length) continue;
      const answers = lines.map((r) => ({ r, rec: live(store[r.id]) }));
      const given = answers.filter((a) => a.rec);
      const asked = (r) => (r.q != null ? [].concat(r.q).join(' ') : d.q);
      if (!given.length) { tally.open += 1; summary.push(`| ${card.id} | ${d.id} | ${lines.map((r) => r.id).join(', ')} | not answered | |`); continue; }
      const head = `### ${d.id} · ${d.code}`;
      const updated = given.map((a) => a.rec.updatedAt || '').sort().pop();
      const block = [head];
      let mark;
      if (given.length < lines.length) {
        mark = 'held';
        tally.held += 1;
        block.push(`Hold: ${given.length} of ${lines.length} questions on this entry are answered. Do not apply until the rest are.`);
        for (const a of answers) block.push(`- ${a.r.id} · ${asked(a.r)} — ${a.rec ? a.rec.v + (a.rec.n ? ': ' + String(a.rec.n).trim() : '') : 'not answered'}`);
      } else if (lines.length === 1) {
        const { r, rec } = answers[0];
        const note = rec.n ? String(rec.n).trim() : '';
        if (rec.v === 'agree') { mark = 'Agree'; tally.agreed += 1; block.push('Mark: Change', `Note: Agreed with the recommendation of ${source.generated}: ${r.text}`); }
        else if (rec.v === 'change' && note) { mark = 'Change'; tally.changed += 1; block.push('Mark: Change', `Note: ${note}`, `On the recommendation: ${r.text}`); }
        else if (rec.v === 'change') { mark = 'Change, nothing written'; tally.discuss += 1; block.push('Mark: Discuss', `Note: (Change pressed on ${r.id} with nothing written; ask the owners.)`, `On the recommendation: ${r.text}`); }
        else { mark = 'Discuss'; tally.discuss += 1; block.push('Mark: Discuss', `Note: ${note || '(Discuss pressed on ' + r.id + ' with nothing written; put it on the next call.)'}`, `On the recommendation: ${r.text}`); }
        block.push(`Question: ${r.id} · ${asked(r)}`);
      } else {
        // several questions on one entry, all answered: one block, each point in its own words
        const open = answers.filter((a) => a.rec.v === 'discuss' || (a.rec.v === 'change' && !String(a.rec.n || '').trim()));
        const changed = answers.filter((a) => a.rec.v === 'change' && String(a.rec.n || '').trim());
        const point = (a) => {
          const note = String(a.rec.n || '').trim();
          if (a.rec.v === 'agree') return `${asked(a.r)} Agreed: ${a.r.text}`;
          if (a.rec.v === 'change') return note ? `${asked(a.r)} Changed to: ${note} (the recommendation was: ${a.r.text})` : `${asked(a.r)} Change pressed with nothing written; ask the owners. (the recommendation was: ${a.r.text})`;
          return `${asked(a.r)} To discuss${note ? ': ' + note : ''}. (the recommendation was: ${a.r.text})`;
        };
        if (open.length) { mark = 'Discuss'; tally.discuss += 1; block.push('Mark: Discuss'); }
        else if (changed.length) { mark = 'Change'; tally.changed += 1; block.push('Mark: Change'); }
        else { mark = 'Agree'; tally.agreed += 1; block.push('Mark: Change'); }
        block.push(`Note: ${mark === 'Agree' ? `Agreed with the recommendation of ${source.generated} on every point. ` : ''}${answers.map((a, i) => `(${i + 1}) ${point(a)}`).join(' ')}`);
        block.push(`Questions: ${answers.map((a) => a.r.id).join(', ')}`);
      }
      block.push(`Updated: ${updated}`);
      if (addendum.has(d.id)) block.push(`Addendum: ${d.id} already carries a recorded answer; this completes its open points and is not a change request.`);
      block.push('');
      blocks.push(block.join('\n'));
      summary.push(`| ${card.id} | ${d.id} | ${lines.map((r) => r.id).join(', ')} | ${mark} | ${day(updated)} |`);
    }
    if (blocks.length) out.push(`## ${card.id} · ${card.title}`, '', ...blocks);
  }

  // what the page saved before it asked per question
  const lineIds = new Set(source.cards.flatMap((c) => c.rec.map((r) => r.id)));
  const old = Object.keys(store).filter((id) => /^A\d{2}$/.test(id) && live(store[id])).sort();
  if (old.length) {
    out.push('## Card-level answers from the earlier page (not applied)', '', 'Given when the page asked one answer per card. The page no longer reads them and nothing below is an answer to record: ask the owners to answer the questions on that card.', '');
    for (const id of old) {
      const rec = store[id];
      const card = source.cards.find((c) => c.id === id);
      out.push(`- ${id}${card ? ' · ' + card.title : ''}: ${rec.v}${rec.n ? ' — ' + String(rec.n).trim() : ', nothing written'} (${day(rec.updatedAt)})`);
    }
    out.push('');
  }
  const stray = Object.keys(store).filter((id) => LINE_ID.test(id) && !lineIds.has(id) && live(store[id])).sort();
  if (stray.length) {
    out.push('## Answers on questions the source no longer lists', '', ...stray.map((id) => `- ${id}: ${store[id].v}${store[id].n ? ' — ' + String(store[id].n).trim() : ''} (${day(store[id].updatedAt)})`), '');
  }

  out.push('## Summary', '', '| Card | Entry | Questions | Answer | Date |', '|---|---|---|---|---|', ...summary, '', `Entries agreed ${tally.agreed} · changed with a note ${tally.changed} · to discuss ${tally.discuss} · held for the rest of their questions ${tally.held} · not answered ${tally.open}`, '');
  return { text: out.join('\n'), tally, screens: count, summary, old, stray };
}

// ── Jacob's accept step and the Answered Questions tab ───────────────────────
// An owner's answer can carry a question or a condition, so nothing an owner answered leaves the
// open list until Jacob accepts it (docs/launch/register-store/accepted.json, written only from
// his own decision). An accepted answer moves to the Answered Questions tab with what will be
// built and where that stands (planned / built / live, docs/launch/owners-questions/
// answered-status.json, written at the wrap). A "reply" keeps the question open and shows our
// reply on it. Screens follow the same rule.
export const ANSWER_STATUSES = ['planned', 'built', 'live'];
const SCREEN_ID = /^S-[A-Z]\d{1,2}$/;
// A09-1b: the second half of a split line, recorded by /decide
const isAnswerId = (id) => LINE_ID.test(id) || SCREEN_ID.test(id) || /^A\d{2}-\d{1,2}b$/.test(id);
const ymd = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : '');

/** Checks accepted.json. Returns it; throws on the first thing wrong. */
export function checkAccepted(accepted) {
  if (!accepted || typeof accepted !== 'object' || Array.isArray(accepted)) throw new Error('accepted.json must be an object keyed by answer id');
  for (const [id, a] of Object.entries(accepted)) {
    if (!isAnswerId(id)) throw new Error(`accepted.json: "${id}" is not a question (A##-n) or screen (S-<code>) id`);
    if (!a || !['accept', 'reply'].includes(a.decision)) throw new Error(`accepted.json: ${id} has decision "${a && a.decision}", not accept or reply`);
    if (!ymd(a.at)) throw new Error(`accepted.json: ${id} has no date ("at")`);
    if (a.decision === 'reply' && !String(a.reply || '').trim()) throw new Error(`accepted.json: ${id} is a reply with no reply text`);
  }
  return accepted;
}

/** Checks answered-status.json (missing ids read as planned). */
export function checkAnsweredStatus(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('answered-status.json must be an object keyed by answer id');
  for (const [id, s] of Object.entries(status)) {
    if (!isAnswerId(id)) throw new Error(`answered-status.json: "${id}" is not an answer id`);
    if (!ANSWER_STATUSES.includes(s)) throw new Error(`answered-status.json: ${id} is "${s}", not ${ANSWER_STATUSES.join(' / ')}`);
  }
  return status;
}

// A note that asks something, sets a condition or says "yes, but" is an open point, not a clean answer.
// A long note (several requests at once) needs an answer back too, whatever its wording.
const OPEN_POINT = /\?|\b(but|if|unless|as long as|provided|before (?:sign ?off|we|you)|clarify|confirm|define|what did you mean|not sure|depends|instead of|however|except)\b/i;
const LONG_NOTE = 300;
const asksSomething = (note) => OPEN_POINT.test(note) || note.length > LONG_NOTE;
const firstOpenPoint = (note) => {
  const parts = String(note).split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const hit = parts.find((s) => OPEN_POINT.test(s)) || parts[0] || '';
  return hit.length > 240 ? hit.slice(0, 237) + '…' : hit;
};

/**
 * How one owner answer is sorted for Jacob: clean (recommend accept), open-point (recommend a
 * reply, drafted by the intake lane in owner wording) or discuss (recommend hold for the call).
 * A first pass only: the intake lane reads every open-point and may move it.
 */
export function sortAnswer(rec) {
  const v = rec && rec.v, note = String((rec && rec.n) || '').trim();
  if (v === 'agree' || v === 'yes') {
    if (note && asksSomething(note)) return { sort: 'open-point', recommendation: 'reply', openPoint: firstOpenPoint(note) };
    return { sort: 'clean', recommendation: 'accept', openPoint: '' };
  }
  if (v === 'change' && note) {
    return asksSomething(note) ? { sort: 'open-point', recommendation: 'reply', openPoint: firstOpenPoint(note) } : { sort: 'clean', recommendation: 'accept', openPoint: '' };
  }
  return { sort: 'discuss', recommendation: 'hold', openPoint: note ? firstOpenPoint(note) : '' };
}

/**
 * The rows of answers-to-accept-<date>.json: one per answered question line and per screen mark
 * that accepted.json does not already hold. `previous` (the same day's file, when there is one)
 * keeps the intake lane's work (its sort, its drafted reply) on an answer that has not changed.
 */
export function buildAcceptRows({ source, screens, store, accepted = {}, previous = [] }) {
  const prev = new Map((previous || []).map((r) => [r.id, r]));
  const out = [];
  const push = (row, rec) => {
    if (accepted[row.id]) return;
    const note = String(rec.n || '').trim();
    const base = Object.assign(row, { answer: rec.v, note, who: rec.by || '', at: rec.updatedAt || '' }, sortAnswer(rec), { draftReply: '' });
    const was = prev.get(row.id);
    if (was && was.answer === base.answer && (was.note || '') === note && (was.at || '') === base.at) {
      for (const k of ['sort', 'openPoint', 'recommendation', 'draftReply']) if (k in was) base[k] = was[k];
    }
    out.push(base);
  };
  if (screens && screens.features) {
    for (const f of screens.features) for (const sc of f.screens) {
      const id = sc.id || 'S-' + sc.code, rec = live(store[id]);
      if (rec) push({ id, card: sc.code, question: sc.title }, rec);
    }
  }
  for (const c of source.cards) {
    const qOf = new Map(c.decisions.map((d) => [d.id, d.q]));
    for (const r of c.rec) {
      if (r.closed) continue;
      const rec = live(store[r.id]);
      if (rec) push({ id: r.id, card: c.id, question: r.q != null ? questionsOf(r.q).join(' ') : r.d.map((id) => qOf.get(id)).join(' ') }, rec);
    }
  }
  return out;
}

/**
 * Applies Jacob's decisions to what the sync is about to publish. Returns the questions with the
 * accepted lines taken off the open list and our reply on the replied ones, the reply for each
 * replied screen, the Answered Questions list, and what was held back with the reason.
 * An accepted line moves only when the owners' answer on it is an answer (Agree, Signed off, or a
 * Change with words): a Discuss or a cleared mark stays open, whatever accepted.json says.
 */
export function applyAcceptance({ source, questions, screenSource, screens, store, accepted, status = {}, answers = new Map(), today }) {
  const held = [], answered = [], replies = { rows: {}, screens: {} };
  // what will be built: the source's own owner wording first, then the recorded answer, when it
  // passes the guards; otherwise the fallback, and the reason is reported
  const recorded = (ids, id) => {
    if (!ids.every((d) => answers.has(d))) return '';
    const text = ids.map((d) => answers.get(d)).join(' ');
    const bad = findForbidden(text);
    if (bad.length) { held.push({ id, why: `moved, but its recorded answer carries ${bad.map((b) => `"${b}"`).join(', ')}; give the line "planned" wording in the source`, moved: true }); return ''; }
    return text;
  };
  const statusOf = (id) => status[id] || 'planned';
  const moved = new Set();
  for (const c of source.cards) {
    const qOf = new Map(c.decisions.map((d) => [d.id, d.q]));
    for (const r of c.rec) {
      const a = accepted[r.id];
      if (!a) continue;
      if (a.decision === 'reply') { replies.rows[r.id] = String(a.reply).trim(); continue; }
      const rec = live(store[r.id]);
      const note = rec ? String(rec.n || '').trim() : '';
      if (!rec) { held.push({ id: r.id, why: 'accepted, but the owners\' answer is no longer in the store' }); continue; }
      const talked = rec.v === 'discuss' || (rec.v === 'change' && !note);
      // a Discuss (or a Change with nothing written) is a conversation: it moves only once its
      // outcome is recorded on every entry behind the line
      if (talked && !r.d.every((d) => answers.has(d))) { held.push({ id: r.id, why: `accepted, but the owners' mark is ${rec.v === 'change' ? 'Change with nothing written' : rec.v} and the outcome is not recorded yet: it stays open` }); continue; }
      if (!['agree', 'change', 'discuss'].includes(rec.v)) { held.push({ id: r.id, why: `accepted, but the owners' mark is "${rec.v}": it stays open` }); continue; }
      moved.add(r.id);
      const outcome = r.planned ? '' : recorded(r.d, r.id);
      answered.push({
        id: r.id, kind: 'question', card: c.title,
        qs: r.q != null ? questionsOf(r.q) : r.d.map((id) => qOf.get(id)),
        answer: talked ? 'discuss' : rec.v, rec: r.text,
        build: String(r.planned || outcome || (rec.v === 'agree' ? r.text : talked ? 'What we settled when we talked it through.' : 'Built the way you asked, in your words above.')).trim(),
        answeredOn: ymd(rec.updatedAt) || ymd(a.at), acceptedOn: ymd(a.at), status: statusOf(r.id),
      });
    }
  }
  const wording = new Map();
  if (screenSource && screenSource.features) for (const f of screenSource.features) for (const sc of f.screens) wording.set(sc.code, sc);
  if (screens && screens.features) {
    for (const f of screens.features) for (const sc of f.screens) {
      const a = accepted[sc.id];
      if (!a) continue;
      if (a.decision === 'reply') { replies.screens[sc.code] = String(a.reply).trim(); continue; }
      const rec = live(store[sc.id]);
      const note = rec ? String(rec.n || '').trim() : '';
      if (!rec) { held.push({ id: sc.id, why: 'accepted, but the owners\' mark is no longer in the store' }); continue; }
      if (!(rec.v === 'yes' || (rec.v === 'change' && note))) { held.push({ id: sc.id, why: `accepted, but the owners' mark is ${rec.v === 'change' ? 'Change with nothing written' : rec.v}: it stays open` }); continue; }
      const w = wording.get(sc.code) || {};
      answered.push({
        id: sc.id, kind: 'screen', code: sc.code, card: f.title, qs: [sc.title], answer: rec.v,
        build: String(w.planned || (rec.v === 'yes' ? 'Built as shown on the screen.' : 'Built with the changes you asked for, in your words above.')).trim(),
        url: sc.url, answeredOn: ymd(rec.updatedAt) || ymd(a.at), acceptedOn: ymd(a.at), status: statusOf(sc.id),
      });
    }
  }
  for (const [id] of Object.entries(accepted)) {
    if (LINE_ID.test(id) && !source.cards.some((c) => c.rec.some((r) => r.id === id))) held.push({ id, why: 'in accepted.json, but no question has this id' });
  }
  // the open list without the moved lines, with our replies
  const cards = [];
  for (const c of questions.cards) {
    const rows = c.rows.filter((r) => !moved.has(r.id)).map((r) => (replies.rows[r.id] ? Object.assign({}, r, { reply: replies.rows[r.id] }) : r));
    if (rows.length) cards.push(Object.assign({}, c, { rows }));
  }
  const used = new Set(cards.map((c) => c.group));
  const out = Object.assign({}, questions, {
    cards,
    groups: questions.groups.filter((g) => used.has(g.id)),
    rows: cards.reduce((n, c) => n + c.rows.length, 0),
    critical: cards.reduce((n, c) => n + c.rows.filter((r) => r.critical).length, 0),
  });
  const screensOut = screens && Object.assign({}, screens, {
    features: screens.features.map((f) => Object.assign({}, f, { screens: f.screens.map((s) => (replies.screens[s.code] ? Object.assign({}, s, { reply: replies.screens[s.code] }) : s)) })),
  });
  answered.sort((x, y) => (y.acceptedOn || '').localeCompare(x.acceptedOn || '') || x.id.localeCompare(y.id));
  return { questions: out, screens: screensOut, answered, held, replied: Object.keys(replies.rows).length + Object.keys(replies.screens).length, today };
}
