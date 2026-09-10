// Shared helpers for the Decision Register scripts: parse decisions.md, talk to the
// shared store, keep snapshots. No dependencies beyond Node 18.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SITE = 'https://hoahx-requirements.netlify.app';
export const PRIORITY_AREAS = new Set(['dues', 'ledger', 'platform billing', 'enforcement']);
const QUESTION_MARKERS = /\s*\((money and enforcement set|yes\/no or a short choice)\)\s*$/;

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

// decisions.md -> { domains: [{num, name, note?}], questions: [...], answeredCount, headerCount }
export function parseDecisions(md, sourceName = 'decisions.md') {
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
      d: e.d, dn: e.dn, p: PRIORITY_AREAS.has(area) ? 1 : 0,
    };
    if (f['Planned']) x.plan = f['Planned'];
    if (f['Options']) x.opts = f['Options'].split('|').map((s) => s.trim()).filter(Boolean);
    if (answered) x.ans = shortDate(f['Answered']);
    else if (neededBy.has(e.id)) x.need = neededBy.get(e.id);
    if (e.id === 'D-001') x.b = 1;
    x._answer = answer; x._area = area; x._line = e.line;
    return x;
  });

  const header = /Answers: \*\*(\d+) of (\d+)\*\*/.exec(md);
  return {
    domains, questions, problems,
    answeredCount: questions.filter((x) => x.ans).length,
    headerCount: header ? { answered: +header[1], total: +header[2] } : null,
  };
}

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
