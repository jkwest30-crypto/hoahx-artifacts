/* HOAhx · Your open questions: behaviour for the page served at the site root and at /answers.
   Data: /answers/data.json (the questions, each with our recommendation, and the videos) and
   /answers/screens.json (the screens), both written by the sync in this repository.
   Answers: a question is answered here, Agree, Change or Discuss, one record per question.
   A screen is answered on the screen itself, on the test site; this page only shows where each
   one stands. Everything is kept in this browser and saved to the site's shared store
   (POST /api/answers, history kept), so both owners see the same answers on every device. */
(function () {
  'use strict';

  const LS_KEY = 'hoahx-answers-v2';
  const LS_EDIT_KEY = 'hoahx-edit-key';
  const API = '/api/answers';
  const isScreenId = (id) => /^S-[A-Z]\d{1,2}$/.test(id);
  const isQuestionId = (id) => /^A\d{2}-\d{1,2}$/.test(id);
  const QUESTION_MARKS = ['agree', 'change', 'discuss'];
  const SCREEN_MARKS = ['yes', 'change', 'discuss'];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const len = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const fmtDay = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
  const fmtDate = (ymd, month) => (ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', month === 'short' ? { month: 'short', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' }) : '');

  // ── state ────────────────────────────────────────────────────────────────
  // marks, notes, when, by: what the store holds, by id. pending: what this browser has not
  // been able to save yet; it survives a reload, so an answer given with no connection is
  // sent when the page is next opened with one.
  const state = { marks: {}, notes: {}, when: {}, by: {}, submittedAt: '', pending: [], editKey: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const k of ['marks', 'notes', 'when', 'by']) if (saved[k] && typeof saved[k] === 'object') state[k] = saved[k];
    if (typeof saved.submittedAt === 'string') state.submittedAt = saved.submittedAt;
    if (Array.isArray(saved.pending)) state.pending = saved.pending.filter((r) => r && typeof r.id === 'string');
    state.editKey = localStorage.getItem(LS_EDIT_KEY) || '';
  } catch (e) { /* storage unavailable: the page still works */ }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ marks: state.marks, notes: state.notes, when: state.when, by: state.by, submittedAt: state.submittedAt, pending: state.pending })); } catch (e) { /* ignore */ }
  }

  const ui = { open: {}, editing: null, qFilter: 'all', sFilter: 'all' };
  let DATA = null, SCREENS = null, rows = [], screens = [];

  // ── shared store ─────────────────────────────────────────────────────────
  const pending = state.pending;
  let flushing = false;
  async function post(rec) {
    const body = Object.assign({}, rec);
    if (state.editKey) body.key = state.editKey;
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) { const err = new Error('unauthorized'); err.code = 401; throw err; }
    if (!res.ok) throw new Error('save failed (' + res.status + ')');
    return res.json();
  }
  async function flush() {
    if (flushing || !pending.length) return;
    flushing = true;
    setStatus('Saving…');
    try {
      while (pending.length) {
        const rec = pending[0];
        try { await post(rec); pending.shift(); persist(); }
        catch (e) {
          if (e.code === 401 && askKey()) continue;
          setStatus(e.code === 401 ? 'Not saved: the passphrase was not accepted. Your answers are kept in this browser.' : 'Not saved yet: no connection. Your answers are kept in this browser and will be saved when it returns.', true);
          return;
        }
      }
      setStatus('Saved');
    } finally { flushing = false; }
  }
  function askKey() {
    const k = window.prompt('This page is protected. Enter the passphrase you were given to save your answers.');
    if (!k) return false;
    state.editKey = k.trim();
    try { localStorage.setItem(LS_EDIT_KEY, state.editKey); } catch (e) { /* ignore */ }
    return true;
  }
  function queue(id) {
    // one queued record per id: a later change replaces an earlier one still waiting
    // (pending[0] may be mid-flight, so it is never replaced; a new record is queued behind it)
    const rec = { id, v: state.marks[id] || '', n: state.notes[id] || '', code: id };
    const i = pending.findIndex((r, at) => r.id === id && (at > 0 || !flushing));
    if (i >= 0) pending[i] = rec; else pending.push(rec);
    persist();
    flush();
  }
  function validMark(id, v) {
    const allowed = isScreenId(id) ? SCREEN_MARKS : isQuestionId(id) ? QUESTION_MARKS : [];
    return allowed.includes(v) ? v : '';
  }
  async function pullServer() {
    try {
      const url = state.editKey ? API + '?key=' + encodeURIComponent(state.editKey) : API;
      const res = await fetch(url, { headers: state.editKey ? { 'x-edit-key': state.editKey } : {}, cache: 'no-store' });
      if (res.status === 401) { if (askKey()) return pullServer(); return false; }
      if (!res.ok) return false;
      const live = await res.json();
      // the store wins, except for what this browser still has to send
      const waiting = new Set(pending.map((r) => r.id));
      const keep = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => waiting.has(id)));
      const marks = keep(state.marks), notes = keep(state.notes), when = keep(state.when), by = keep(state.by);
      Object.entries(live).forEach(([id, rec]) => {
        if (id === '_submission') { state.submittedAt = rec.updatedAt || ''; return; }
        if (waiting.has(id) || !(isScreenId(id) || isQuestionId(id))) return;   // an answer given per card, on the earlier page, is not read
        const v = validMark(id, rec.v);
        if (!v) return;
        marks[id] = v; notes[id] = rec.n || ''; when[id] = rec.updatedAt || ''; by[id] = rec.by || '';
      });
      Object.assign(state, { marks, notes, when, by });
      persist();
      return true;
    } catch (e) { return false; /* offline: what this browser holds stands */ }
  }

  let statusEl = null;
  function setStatus(text, isErr) {
    if (!statusEl) statusEl = document.querySelector('[data-status]');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('err', !!isErr);
  }

  // ── answers ──────────────────────────────────────────────────────────────
  const noteTimers = {};
  function sendNow(id) { clearTimeout(noteTimers[id]); delete noteTimers[id]; queue(id); }
  function setMark(id, v) {
    const cur = state.marks[id] || '';
    const next = cur === v ? '' : validMark(id, v);   // pressing the lit button clears it
    if (next) state.marks[id] = next; else delete state.marks[id];
    if (next !== 'change' && next !== 'discuss') delete state.notes[id];   // a note belongs to a Change or a Discuss
    state.when[id] = new Date().toISOString();
    delete state.by[id];   // this page asks for no name
    sendNow(id);
    return next;
  }
  function setNote(id, text) {
    if (text.trim()) state.notes[id] = text; else delete state.notes[id];
    state.when[id] = new Date().toISOString();
    persist();
    setStatus('Saving…');
    clearTimeout(noteTimers[id]);
    noteTimers[id] = setTimeout(() => sendNow(id), 700);
  }
  function flushNotes() { Object.keys(noteTimers).forEach(sendNow); }
  async function submit(summary) {
    flushNotes();
    await post({ id: '_submission', v: 'agree', n: summary });
    state.submittedAt = new Date().toISOString();
    persist();
  }

  // ── what each state is called ────────────────────────────────────────────
  const Q_LABEL = { agree: 'Agreed', change: 'To change', discuss: 'To discuss', open: 'Not answered' };
  const Q_CLASS = { agree: 'keep', change: 'change', discuss: 'discuss', open: '' };
  const S_LABEL = { yes: 'Signed off', change: 'Changes suggested', discuss: 'To discuss', open: 'Not reviewed' };
  const S_CLASS = { yes: 'keep', change: 'change', discuss: 'discuss', open: '' };
  const NOTE = {
    change: { k: 'Changing our recommendation', label: 'What should it be instead?', hint: 'Saved as you type. A sentence is enough; leave it blank if you would rather talk it through.', shown: 'What you want changed', none: 'No note yet: we will ask you on the next call' },
    discuss: { k: 'To discuss', label: 'What would you like to talk through? (optional)', hint: 'Saved as you type. It goes on the agenda for the next call either way.', shown: 'Your note for the call', none: 'On the agenda for the next call' },
  };
  const stateOf = (id) => validMark(id, state.marks[id]) || 'open';

  function tallyQ() { const t = { agree: 0, change: 0, discuss: 0, open: 0 }; rows.forEach((r) => { t[stateOf(r.id)] += 1; }); return t; }
  function tallyS() { const t = { yes: 0, change: 0, discuss: 0, open: 0 }; screens.forEach((s) => { t[stateOf(s.id)] += 1; }); return t; }
  function cardState(c) {
    const s = c.rows.map((r) => stateOf(r.id));
    const done = s.filter((x) => x !== 'open').length;
    if (s.every((x) => x === 'agree')) return { k: 'agree', label: 'Agreed', done };
    if (s.includes('change')) return { k: 'change', label: 'Change asked', done };
    if (s.includes('discuss')) return { k: 'discuss', label: 'To discuss', done };
    return { k: 'open', label: done ? 'In progress' : 'Waiting on you', done };
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function watchLink(n) {
    const v = DATA.videos[n];
    return v ? '<a class="watch" href="' + esc(v.url) + '" target="_blank" rel="noopener"><span>' + esc(v.title) + '</span><i>' + len(v.seconds) + '</i></a>' : '';
  }
  function vids(nums) {
    const links = (nums || []).map(watchLink).join('');
    return links ? '<div class="vids"><span class="built">Built</span>' + links + '</div>' : '';
  }
  // A film of the screen itself, state by state: the same review as opening it, sitting still.
  // Unlike the videos above it says nothing about whether the feature is built.
  function watchScreen(x) {
    return x.walk ? '<a class="see" href="' + esc(x.walk.url) + '" target="_blank" rel="noopener">Watch it <i>' + len(x.walk.seconds) + '</i></a>' : '';
  }
  function stat(n, label, c) { return '<div class="stat"><span class="n">' + n + '</span><span class="l"><i class="dot c-' + c + '"></i>' + label + '</span></div>'; }
  function meter(parts, total) { return '<div class="meter" aria-hidden="true">' + parts.map(([n, c]) => '<i class="c-' + c + '" style="width:' + (total ? 100 * n / total : 0) + '%"></i>').join('') + '</div>'; }

  function renderWhere() {
    const q = tallyQ(), s = tallyS();
    $('where').innerHTML =
      '<a class="panel" href="#questions"><div class="panel-h"><h2>Questions</h2><span class="num">' + (rows.length - q.open) + ' of ' + rows.length + ' answered</span></div>' +
      '<div class="stats">' + stat(q.agree, 'Agreed', 'keep') + stat(q.change, 'To change', 'change') + stat(q.discuss, 'To discuss', 'discuss') + stat(q.open, 'Not answered', 'open') + '</div>' +
      meter([[q.agree, 'keep'], [q.change, 'change'], [q.discuss, 'discuss']], rows.length) + '</a>' +
      '<a class="panel" href="#screens"><div class="panel-h"><h2>Screens</h2><span class="num">' + (screens.length - s.open) + ' of ' + screens.length + ' reviewed</span></div>' +
      '<div class="stats">' + stat(s.yes, 'Signed off', 'keep') + stat(s.change, 'Changes suggested', 'change') + stat(s.discuss, 'To discuss', 'discuss') + stat(s.open, 'Not reviewed', 'open') + '</div>' +
      meter([[s.yes, 'keep'], [s.change, 'change'], [s.discuss, 'discuss']], screens.length) + '</a>';
    const left = q.open;
    $('send-p').textContent = left === 0 ? 'Every question is answered. Press Send and your answers are recorded.' : left + ' question' + (left === 1 ? '' : 's') + ' still waiting. You can send now and come back for the rest, or finish first.';
    $('send-btn').disabled = left === rows.length;
    if (!$('sent').classList.contains('err')) $('sent').textContent = state.submittedAt ? 'Last sent ' + new Date(state.submittedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) + '. Sending again replaces it.' : '';
  }

  function chip(group, key, label, n, cur) { return '<button type="button" class="chip" data-' + group + '="' + key + '" aria-pressed="' + (cur === key) + '">' + label + ' <b>' + n + '</b></button>'; }

  function critHtml(c) { return c ? '<p class="crit"><span class="crit-badge">Critical</span><span class="crit-why">' + esc(c.why) + '</span></p>' : ''; }
  // Critical first, soonest due first; the rest keep the order they came in.
  function byDue(list, dateOf) { return list.map((x, i) => [x, i]).sort((a, b) => (dateOf(a[0]) || '9999').localeCompare(dateOf(b[0]) || '9999') || a[1] - b[1]).map((e) => e[0]); }
  const CRIT_SCREENS = 'Critical: other screens or work depend on these';
  const CRIT_QUESTIONS = 'Critical: needed first';

  function screenHtml(x) {
    const s = stateOf(x.id);
    const day = s === 'open' ? '' : fmtDay(state.when[x.id]);
    const note = String(state.notes[x.id] || '').trim();
    const who = state.by[x.id] ? esc(state.by[x.id]) : '';
    const said = s === 'change' || s === 'discuss'
      ? '<div class="said c-' + S_CLASS[s] + '"><b>' + (s === 'discuss' ? (who ? who + ' wants to talk this through' : 'To talk through') : (who ? who + ' asked for a change' : 'A change was asked for')) + '</b>' + (note ? esc(note) : 'No note left.') + '</div>'
      : '';
    return '<article class="scr' + (x.critical ? ' is-critical' : '') + '" data-screen="' + esc(x.code) + '" data-state="' + s + '"' + (x.critical ? ' data-critical="true"' : '') + '><div class="scr-top"><span class="code">' + esc(x.code) + '</span><span class="pill ' + S_CLASS[s] + '">' + S_LABEL[s] + (day ? ' · ' + esc(day) : '') + '</span></div>' +
      '<h4>' + esc(x.title) + '</h4>' + critHtml(x.critical) + '<p>' + esc(x.what) + '</p>' + said +
      '<div class="scr-foot"><a class="go" href="' + esc(x.url) + '" target="_blank" rel="noopener">' + (s === 'open' ? 'Open ' + esc(x.code) + ' and review it' : 'Open ' + esc(x.code)) + '</a>' + watchScreen(x) + vids(x.videos) + '</div></article>';
  }
  function renderScreens() {
    const s = tallyS();
    $('screen-chips').innerHTML = chip('sf', 'all', 'All', screens.length, ui.sFilter) + chip('sf', 'yes', 'Signed off', s.yes, ui.sFilter) + chip('sf', 'change', 'Changes suggested', s.change, ui.sFilter) + chip('sf', 'discuss', 'To discuss', s.discuss, ui.sFilter) + chip('sf', 'open', 'Not reviewed', s.open, ui.sFilter);
    const seen = (x) => ui.sFilter === 'all' || stateOf(x.id) === ui.sFilter;
    const hot = byDue(screens.filter((x) => x.critical), (x) => x.critical.date);
    const groups = (hot.length ? [{ title: CRIT_SCREENS, critical: true, screens: hot }] : []).concat(SCREENS.features.map((f) => ({ title: f.title, screens: f.screens.filter((x) => !x.critical) })));
    $('screen-groups').innerHTML = groups.map((f) => {
      const list = f.screens.filter(seen);
      if (!list.length) return '';
      const done = f.screens.filter((x) => stateOf(x.id) === 'yes').length;
      return '<div class="group' + (f.critical ? ' group-critical' : '') + '"><div class="group-h"><h3>' + esc(f.title) + '</h3><span class="num">' + done + ' of ' + f.screens.length + ' signed off</span></div><div class="screens">' + list.map(screenHtml).join('') + '</div></div>';
    }).join('') || '<p class="empty">No screens in this view.</p>';
  }

  function inlineBox(r, s) {
    const n = NOTE[s], id = 'note-' + r.id;
    return '<div class="box c-' + s + '"><p class="box-k">' + n.k + '</p><label for="' + id + '">' + n.label + '</label>' +
      '<textarea id="' + id + '" data-note="' + esc(r.id) + '">' + esc(state.notes[r.id] || '') + '</textarea>' +
      '<div class="box-f"><button type="button" class="btn primary" data-done>Done</button><span>' + n.hint + '</span></div></div>';
  }
  function rowHtml(r) {
    const s = stateOf(r.id), exp = !!ui.open[r.id];
    const note = String(state.notes[r.id] || '').trim();
    const boxHere = ui.editing === r.id && (s === 'change' || s === 'discuss');
    const day = s === 'open' ? '' : fmtDay(state.when[r.id]);
    return '<div class="q is-' + s + (r.critical ? ' is-critical' : '') + '" data-row="' + esc(r.id) + '" data-state="' + s + '"' + (r.critical ? ' data-critical="true"' : '') + '><div class="q-main">' + critHtml(r.critical) +
      r.qs.map((q) => '<p class="q-text">' + esc(q) + '</p>').join('') +
      '<button type="button" class="rec-btn" data-toggle aria-expanded="' + exp + '"><span class="k">Our recommendation</span><span class="t">' + esc(r.rec) + '</span></button>' +
      vids(r.videos) +
      (boxHere ? inlineBox(r, s) : '') +
      (!boxHere && NOTE[s] ? '<div class="q-note c-' + s + '"><b>' + (note ? NOTE[s].shown : NOTE[s].none) + '</b>' + (note ? '<span>' + esc(note) + '</span>' : '') + '<button type="button" class="link-btn" data-edit>' + (note ? 'Edit' : 'Add a note') + '</button></div>' : '') +
      '</div><div class="q-act"><div class="btns">' +
      '<button type="button" class="btn agree" data-mark="agree" aria-pressed="' + (s === 'agree') + '">Agree</button>' +
      '<button type="button" class="btn change" data-mark="change" aria-pressed="' + (s === 'change') + '">Change</button>' +
      '<button type="button" class="btn discuss" data-mark="discuss" aria-pressed="' + (s === 'discuss') + '">Discuss</button></div>' +
      '<span class="q-when">' + (s === 'open' ? '' : Q_LABEL[s] + (day ? ' · ' + esc(day) : '')) + '</span></div></div>';
  }
  function renderQuestions() {
    const t = tallyQ();
    $('q-chips').innerHTML = chip('qf', 'all', 'All', rows.length, ui.qFilter) + chip('qf', 'open', 'Not answered', t.open, ui.qFilter) + chip('qf', 'agree', 'Agreed', t.agree, ui.qFilter) + chip('qf', 'change', 'To change', t.change, ui.qFilter) + chip('qf', 'discuss', 'To discuss', t.discuss, ui.qFilter);
    const isHot = (c) => c.rows.some((r) => r.critical);
    const hotCards = byDue(DATA.cards.filter(isHot), (c) => c.rows.reduce((d, r) => (r.critical && (!d || r.critical.date < d) ? r.critical.date : d), ''));
    const sections = (hotCards.length ? [{ title: CRIT_QUESTIONS, critical: true, cards: hotCards }] : [])
      .concat(DATA.groups.map((g) => ({ title: g.title, cards: DATA.cards.filter((c) => c.group === g.id && !isHot(c)) })));
    $('q-groups').innerHTML = sections.map((g) => {
      const all = g.cards;
      const shown = all.map((c) => ({ c, list: c.rows.filter((r) => ui.qFilter === 'all' || stateOf(r.id) === ui.qFilter || ui.editing === r.id) })).filter((x) => x.list.length);
      if (!shown.length) return '';
      const agreed = all.filter((c) => cardState(c).k === 'agree').length;
      return '<div class="group' + (g.critical ? ' group-critical' : '') + '"><div class="group-h"><h3>' + esc(g.title) + '</h3><span class="num">' + agreed + ' of ' + all.length + ' cards agreed</span></div>' +
        shown.map(({ c, list }) => {
          const cs = cardState(c);
          return '<article class="card" data-card="' + esc(c.id) + '" data-state="' + cs.k + '"><div class="card-h"><h4>' + esc(c.title) + '</h4><div class="side"><span class="pill ' + Q_CLASS[cs.k] + '">' + cs.label + '</span><small class="num">' + cs.done + ' of ' + c.rows.length + ' answered</small></div></div>' +
            (c.note ? '<p class="card-note">' + esc(c.note) + '</p>' : '') + list.map(rowHtml).join('') +
            '<details class="card-why"' + (ui.open['why-' + c.id] ? ' open' : '') + ' data-why="' + esc(c.id) + '"><summary>Why we recommend this</summary><p>' + esc(c.why) + '</p></details></article>';
        }).join('') + '</div>';
    }).join('') || '<p class="empty">Nothing in this view.</p>';
  }
  function renderAll() { renderWhere(); renderScreens(); renderQuestions(); }

  function noteField(id) { return document.getElementById('note-' + id); }
  function edit(id) {
    ui.editing = id;
    renderAll();
    const ta = noteField(id);
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); ta.closest('.q').scrollIntoView({ block: 'nearest' }); }
  }
  function done() {
    const id = ui.editing;
    ui.editing = null;
    if (id && noteTimers[id]) sendNow(id);
    renderAll();
    const back = id && document.querySelector('[data-row="' + id + '"] [data-edit]');
    if (back) back.focus({ preventScroll: true });
  }

  function summaryText() {
    const q = tallyQ(), s = tallyS();
    const lines = ['HOAhx · Your open questions · answers sent ' + new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }), '', 'QUESTIONS'];
    DATA.cards.forEach((c) => {
      lines.push('', c.title);
      c.rows.forEach((r) => {
        const st = stateOf(r.id), note = String(state.notes[r.id] || '').trim();
        lines.push('  ' + r.qs.join(' / ') + ' ' + (st === 'open' ? 'not answered' : st.toUpperCase()) + (note ? ' — ' + note : ''));
      });
    });
    lines.push('', q.agree + ' agreed · ' + q.change + ' to change · ' + q.discuss + ' to discuss · ' + q.open + ' not answered', '', 'SCREENS (answered on each screen)');
    screens.forEach((x) => {
      const st = stateOf(x.id), note = String(state.notes[x.id] || '').trim();
      lines.push('  ' + x.code + ' ' + x.title + ': ' + S_LABEL[st] + (state.by[x.id] ? ' (' + state.by[x.id] + ')' : '') + (note ? ' — ' + note : ''));
    });
    lines.push('', s.yes + ' signed off · ' + s.change + ' changes suggested · ' + s.discuss + ' to discuss · ' + s.open + ' not reviewed');
    return lines.join('\n');
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  async function load(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(path + ' not found');
    return res.json();
  }
  async function main() {
    [DATA, SCREENS] = await Promise.all([load('/answers/data.json'), load('/answers/screens.json')]);
    rows = DATA.cards.flatMap((c) => c.rows);
    screens = SCREENS.features.flatMap((f) => f.screens);
    $('lede').textContent = 'Everything HOAhx still needs from you, in one place: ' + rows.length + ' questions, each with our recommendation, and the ' + screens.length + ' new screens to sign off.';
    $('updated').textContent = fmtDate(DATA.updated, 'long');
    $('nav-updated').textContent = fmtDate(DATA.updated, 'short');
    renderAll();
    await pullServer();
    renderAll();
    if (pending.length) flush();
    if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ block: 'start' }); }

    window.addEventListener('online', flush);
    window.addEventListener('pagehide', flushNotes);
    // a screen is answered on another page: when this one is looked at again, read the store again
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || ui.editing || pending.length || flushing) return;
      if (await pullServer()) renderAll();
    });

    $('q-groups').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-row]');
      if (!row) return;
      const id = row.dataset.row;
      if (ev.target.closest('[data-done]')) { done(); return; }
      if (ev.target.closest('[data-toggle]')) {
        ui.open[id] = !ui.open[id];
        renderQuestions();
        const again = ui.editing ? noteField(ui.editing) : document.querySelector('[data-row="' + id + '"] [data-toggle]');
        if (again) again.focus({ preventScroll: true });
        return;
      }
      if (ev.target.closest('[data-edit]')) { edit(id); return; }
      const b = ev.target.closest('[data-mark]');
      if (!b) return;
      const before = ui.editing;
      if (before && before !== id && noteTimers[before]) sendNow(before);
      const next = setMark(id, b.dataset.mark);
      if (next === 'change' || next === 'discuss') { ui.open[id] = true; edit(id); return; }
      if (next === 'agree') ui.open[id] = true;
      if (ui.editing === id) ui.editing = null;
      renderAll();
      const again = document.querySelector('[data-row="' + id + '"] [data-mark="' + b.dataset.mark + '"]');
      if (again) again.focus({ preventScroll: true });
    });
    $('q-groups').addEventListener('input', (ev) => { const ta = ev.target.closest('[data-note]'); if (ta) setNote(ta.dataset.note, ta.value); });
    $('q-groups').addEventListener('toggle', (ev) => { const d = ev.target.closest && ev.target.closest('[data-why]'); if (d) ui.open['why-' + d.dataset.why] = d.open; }, true);
    $('q-chips').addEventListener('click', (ev) => { const c = ev.target.closest('[data-qf]'); if (!c) return; if (ui.editing) done(); ui.qFilter = c.dataset.qf; renderQuestions(); const again = document.querySelector('[data-qf="' + ui.qFilter + '"]'); if (again) again.focus({ preventScroll: true }); });
    $('screen-chips').addEventListener('click', (ev) => { const c = ev.target.closest('[data-sf]'); if (!c) return; ui.sFilter = c.dataset.sf; renderScreens(); const again = document.querySelector('[data-sf="' + ui.sFilter + '"]'); if (again) again.focus({ preventScroll: true }); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.editing) done(); });
    $('send-btn').addEventListener('click', async () => {
      const btn = $('send-btn'), sent = $('sent');
      if (ui.editing) done();
      btn.disabled = true; btn.textContent = 'Sending…';
      sent.classList.remove('err');
      try {
        await submit(summaryText());
        btn.textContent = 'Sent';
        renderWhere();
        setTimeout(() => { btn.textContent = 'Send your answers'; renderWhere(); }, 2500);
      } catch (e) {
        btn.textContent = 'Send your answers';
        sent.classList.add('err');
        sent.textContent = 'Not sent: ' + (e.code === 401 ? 'the passphrase was not accepted. Reload the page and enter it when asked.' : 'no connection. Your answers are kept in this browser; try again in a moment.');
        btn.disabled = false;
      }
    });
  }

  main().catch((e) => {
    const where = $('q-groups');
    if (where) where.innerHTML = '<p class="empty">The questions could not be loaded (' + esc(e.message) + '). Reload the page.</p>';
  });
})();
