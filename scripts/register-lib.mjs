// Shared helpers for the Decision Register scripts: parse decisions.md, talk to the
// shared store, keep snapshots. No dependencies beyond Node 18.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SITE = 'https://hoahx-requirements.netlify.app';
const QUESTION_MARKERS = /\s*\((money and enforcement set|yes\/no or a short choice)\)\s*$/;

// Launch: the release test of scope-triage-plan.md section 2. The page shows three groups; the
// short codes travel in the data so the template stays small.
export const LAUNCH_CODE = { 'in the launch': 'l', candidate: 'c', 'not planned': 'n' };
export const LAUNCH_LABEL = { l: 'In the release', c: 'Candidate', n: 'Not planned' };
// Sources render as small labels. An F-id links to the demo page; an R-line is the owners' own
// Core list, by area and bullet. An S0 row is a step-0 triage row and is internal: it never
// renders (session 1's hand-off).
const SOURCE_RE = { f: /^F-\d{3}$/, r: /^R-\d{1,2}\.\d{1,2}$/ };

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// The owners' own names for the workflows, from the workflow map beside decisions.md. Missing is
// not an error: the page falls back to a plain sentence, so the builder runs anywhere.
export function loadWorkflowNames(file) {
  const names = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const w of data.workflows || []) if (w && w.id && w.title) names.set(w.id, w.title);
  } catch { /* no map on hand */ }
  return names;
}

// decisions.md -> { domains: [{num, name, note?}], questions: [...], answeredCount, headerCount }
export function parseDecisions(md, sourceName = 'decisions.md', workflowNames = new Map()) {
  const lines = md.split(/\r?\n/);
  const domains = [];
  const entries = [];
  const neededBy = new Map();
  let fence = false, inQueue = false, dom = null, cur = null, noteOpen = false;
  const problems = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\s+$/, '');
    if (l.startsWith('```')) { fence = !fence; continue; }
    if (fence) continue;

    if (/^## Priority queue/.test(l)) { inQueue = true; continue; }
    if (inQueue) {
      if (/^## /.test(l)) inQueue = false;
      else {
        const m = /^\|\s*\d+\s*\|\s*(D-\d{3})\s*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(l);
        if (m) neededBy.set(m[1], m[2]);
        continue;
      }
    }

    let m;
    if ((m = /^## (\d{2}) · (.+)$/.exec(l))) {
      dom = { num: m[1], name: m[2].trim() };
      domains.push(dom); cur = null; noteOpen = true;
      continue;
    }
    if (dom && noteOpen && /^> /.test(l)) {
      dom.note = (dom.note ? dom.note + ' ' : '') + l.slice(2).trim();
      continue;
    }
    if (l.trim() !== '' && !/^> /.test(l)) noteOpen = false;

    if ((m = /^### (D-\d{3}) · (Q-[A-Z]+-\d+) · (.+)$/.exec(l))) {
      if (!dom) problems.push(`${sourceName}:${i + 1}: entry ${m[1]} appears before any "## NN · Area" header`);
      cur = { id: m[1], code: m[2], title: m[3].trim(), d: dom ? dom.num : '', dn: dom ? dom.name : '', line: i + 1, fields: {} };
      entries.push(cur);
      continue;
    }
    if (cur && (m = /^- ([A-Za-z ]+): (.*)$/.exec(l))) {
      cur.fields[m[1]] = m[2].trim();
      continue;
    }
    if (cur && l.trim() !== '' && !/^#/.test(l)) {
      problems.push(`${sourceName}:${i + 1}: unexpected line inside ${cur.id} (fields must be single "- Key: value" lines): ${l.slice(0, 80)}`);
    }
  }

  const seenId = new Set(), seenCode = new Set();
  const questions = entries.map((e) => {
    const f = e.fields;
    for (const k of ['Area', 'Why', 'Today the platform', 'Question', 'Answer', 'Answered']) {
      if (!f[k]) problems.push(`${sourceName}:${e.line}: ${e.id} is missing "- ${k}:"`);
    }
    if (seenId.has(e.id)) problems.push(`${sourceName}:${e.line}: duplicate id ${e.id}`);
    if (seenCode.has(e.code)) problems.push(`${sourceName}:${e.line}: duplicate code ${e.code}`);
    seenId.add(e.id); seenCode.add(e.code);

    let q = (f['Question'] || e.title).replace(QUESTION_MARKERS, '').trim();
    if (!/[?.!]$/.test(q)) q += '?';
    const answer = f['Answer'] || 'pending';
    const answered = answer.toLowerCase() !== 'pending' && /^\d{4}-\d{2}-\d{2}/.test(f['Answered'] || '');
    const area = (f['Area'] || '').toLowerCase();
    const x = {
      id: e.id, code: e.code, q,
      why: f['Why'] || '', now: f['Today the platform'] || '',
      d: e.d, dn: e.dn,
    };
    if (f['Planned']) x.plan = f['Planned'];
    if (f['Options']) x.opts = f['Options'].split('|').map((s) => s.trim()).filter(Boolean);
    if (answered) { x.planned = shortDate(f['Answered']); x.pd = f['Answered'].slice(0, 10); }
    // "Start here" used to mean four money-and-enforcement areas. It is now the gating set: the
    // entries a launch task is actually waiting on, which is exactly the Priority queue
    // (scope-triage-plan.md section 7), so the area flag is gone.
    if (neededBy.has(e.id)) { x.need = neededBy.get(e.id); x.gate = 1; }
    if (e.id === 'D-001') x.b = 1;

    // Launch (section 3 of the triage plan). Absent is not "in the launch": an entry that has not
    // been classified yet shows no pill at all, so a missing field can never read as a promise.
    if (f['Launch']) {
      const code = LAUNCH_CODE[f['Launch'].trim().toLowerCase()];
      if (code) x.lx = code;
      else problems.push(`${sourceName}:${e.line}: ${e.id} has "- Launch: ${f['Launch']}", which is not one of ${Object.keys(LAUNCH_CODE).join(', ')}`);
    }

    // Sources: F-ids and R-lines only. Step-0 rows (S0-A#/S0-B#) are internal triage rows and are
    // dropped here rather than in the template, so they cannot reach the page by any route.
    if (f['Sources'] && f['Sources'].trim().toLowerCase() !== 'none') {
      const fs_ = [], rs = [];
      for (const raw of f['Sources'].split(';')) {
        const t = raw.trim();
        if (!t) continue;
        if (SOURCE_RE.f.test(t)) fs_.push(t);
        else if (SOURCE_RE.r.test(t)) rs.push(t);
      }
      if (fs_.length) x.sf = fs_;
      if (rs.length) x.sr = rs;
    }

    // Value: the page shows the word and the sentence, never the per-criterion scores.
    if (f['Value']) {
      const m = /(Low|Medium|High)\s*(?:—|--|-|·)?\s*(.*)$/i.exec(f['Value']);
      if (m) {
        x.vw = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
        const sentence = m[2].trim().replace(/^[—–\-·]\s*/, '');
        if (sentence) x.vs = sentence;
      }
    }

    // Test renders as "Proven by". Nothing raw reaches the page: a workflow id becomes the
    // workflow's own plain-language name (resolved below from the workflow map), a test path
    // becomes a plain sentence, and a `none → <task>` is proof still to come — the task id is
    // ours and stays here.
    if (f['Test']) {
      const t = f['Test'].trim();
      x.tk = 1;
      const wf = /^workflow:([A-Za-z0-9._-]+)/.exec(t);
      if (/^none\b/i.test(t)) x.tp = '';
      else if (wf) x._wf = wf[1];
      else if (/^tests?\//.test(t)) x.tp = 'An automated test that runs on every release';
      else if (t) x.tp = t;
    }

    // Follows: the later half of a split. The page draws the link both ways, so only this one
    // directional field is authored (section 3).
    if (f['Follows']) {
      const m = /^(D-\d{3})\s*(?:·|-|—)?\s*(.*)$/.exec(f['Follows'].trim());
      if (m && m[1] !== e.id) x.fl = { id: m[1], t: m[2].trim() };
      else if (m) problems.push(`${sourceName}:${e.line}: ${e.id} has "- Follows:" pointing at itself`);
      else problems.push(`${sourceName}:${e.line}: ${e.id} has "- Follows: ${f['Follows']}", which does not start with a D-number`);
    }

    x._answer = answer; x._area = area; x._line = e.line;
    return x;
  });

  // A workflow id is ours; the owners' own name for that workflow is on the workflow map, which
  // is written for them. Where the map is not on hand, say the plain thing rather than the id.
  for (const q of questions) {
    if (!q._wf) continue;
    const name = workflowNames.get(q._wf);
    q.tp = name ? `Walking through "${name}"` : 'A walk-through of this workflow on every release';
    delete q._wf;
  }

  // Resolve Follows both ways and drop any that points at an entry the page does not have.
  const questionById = new Map(questions.map((q) => [q.id, q]));
  for (const q of questions) {
    if (!q.fl) continue;
    const target = questionById.get(q.fl.id);
    if (!target) {
      problems.push(`${sourceName}:${q._line}: ${q.id} follows ${q.fl.id}, which is not an entry`);
      delete q.fl;
      continue;
    }
    (target.fb = target.fb || []).push({ id: q.id, t: q.fl.t });   // "Continues in"
  }

  const header = /Answers: \*\*(\d+) of (\d+)\*\*/.exec(md);
  const count = (code) => questions.filter((x) => x.lx === code).length;
  return {
    domains, questions, problems,
    answeredCount: questions.filter((x) => x.pd).length,
    launch: { l: count('l'), c: count('c'), n: count('n'), unset: questions.filter((x) => !x.lx).length },
    gating: questions.filter((x) => x.gate && !x.pd).length,
    headerCount: header ? { answered: +header[1], total: +header[2] } : null,
  };
}

// Denver calendar day of an ISO timestamp, the day the owners and the page reason in.
export function dayOf(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); } catch { return String(iso || '').slice(0, 10); }
}

// A mark saved after an item's answer was recorded. It never reopens the entry (Jacob,
// 2026-09-14): on an entry in the release a Change is a CHANGE REQUESTED, which /decide splits
// into a new `Follows:` candidate while the recorded answer and the work in flight stand; on a
// candidate or a not-planned entry every mark is RANK, the owners' ordering, never an answer that
// creates launch work. Returns '' when the mark is on or before the recorded date, which is the
// input that led to the record.
export function laterMark(rec, q) {
  if (!q || !rec || !rec.v) return '';
  if (q.lx === 'c' || q.lx === 'n') return 'rank';
  if (!q.pd || !rec.updatedAt || dayOf(rec.updatedAt) <= q.pd) return '';
  return rec.v === 'change' || rec.v === 'discuss' ? 'change-requested' : '';
}

export const LATER_MARK_LABEL = {
  'change-requested': 'CHANGE REQUESTED',
  rank: 'RANK',
};

export function isLive(rec) {
  return !!(rec && (rec.v || (rec.n && String(rec.n).trim())));
}

export async function fetchStore(site, key, { full = true } = {}) {
  const url = site.replace(/\/$/, '') + '/api/decisions' + (full ? '?full=1' : '');
  const res = await fetch(url, { headers: key ? { 'x-edit-key': key } : {}, cache: 'no-store' });
  if (res.status === 401) throw new Error('The shared register requires its passphrase: pass --key <passphrase> or set DECISION_EDIT_KEY.');
  if (!res.ok) throw new Error(`Could not read the shared register (${res.status}) from ${url}`);
  const data = await res.json();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected store shape from ' + url);
  return data;
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function latestSnapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^store-\d{8}-\d{6}\.json$/.test(f)).sort();
  if (!files.length) return null;
  const file = path.join(dir, files[files.length - 1]);
  try { return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { file, data: null }; }
}

// Writes a timestamped snapshot unless the store is byte-identical to the latest one.
export function snapshotStore(dir, site, store) {
  fs.mkdirSync(dir, { recursive: true });
  const prev = latestSnapshot(dir);
  const body = { site, pulledAt: new Date().toISOString(), store };
  if (prev && prev.data && JSON.stringify(prev.data.store) === JSON.stringify(store)) {
    return { file: prev.file, wrote: false, prev };
  }
  const file = path.join(dir, `store-${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  return { file, wrote: true, prev };
}

export const FORBIDDEN = [
  [/Stripe/, 'Stripe'], [/Claude/, 'Claude'], [/\bAI\b/, 'AI'], [/workshop/i, 'workshop'],
  [/customer/i, 'customer'], [/as today/i, 'as today'], [/already handles/i, 'already handles'],
];

export function forbiddenWords(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [re, label] of FORBIDDEN) {
      if (re.test(line)) hits.push({ line: i + 1, label, text: line.trim().slice(0, 140) });
    }
  });
  return hits;
}
