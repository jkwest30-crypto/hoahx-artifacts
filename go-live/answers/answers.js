/* HOAhx · Open questions, answered by recommendation — behaviour for /answers.
   Data: ./data.json (published from the HOAhx repo's docs/launch/recommendations.json).
   Answers: kept in this browser (localStorage) and saved to the site's shared store
   (POST /api/answers, one record per card, history kept), so both owners see the same
   answers on every device and the launch program can read them back. */
(function () {
  'use strict';

  const LS_KEY = 'hoahx-answers-v1';
  const LS_EDIT_KEY = 'hoahx-edit-key';
  const API = '/api/answers';
  const REGISTER = '/';

  // ── state ────────────────────────────────────────────────────────────────
  const state = { marks: {}, notes: {}, when: {}, message: '', submittedAt: '', editKey: '', filter: 'all' };
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.assign(state, saved);
    state.editKey = localStorage.getItem(LS_EDIT_KEY) || '';
  } catch (e) { /* storage unavailable: the page still works */ }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ marks: state.marks, notes: state.notes, when: state.when, message: state.message, submittedAt: state.submittedAt })); } catch (e) { /* ignore */ }
  }

  // ── shared store ─────────────────────────────────────────────────────────
  const pending = [];
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
    if (flushing) return;
    flushing = true;
    setStatus('Saving…');
    try {
      while (pending.length) {
        const rec = pending[0];
        try { await post(rec); pending.shift(); }
        catch (e) {
          if (e.code === 401 && askKey()) continue;
          setStatus(e.code === 401 ? 'Not saved: the passphrase was not accepted. Your answers are kept in this browser.' : 'Not saved yet: no connection. Your answers are kept in this browser and will be saved when it returns.', true);
          flushing = false;
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
  function queue(id, v, n, code) {
    // one queued record per id: a later change replaces an earlier one still waiting
    // (pending[0] may be mid-flight, so it is never replaced; a new record is queued behind it)
    const i = pending.findIndex((r) => r.id === id);
    const rec = { id, v, n: n || '', code: code || '' };
    if (i > 0) pending[i] = rec; else pending.push(rec);
    flush();
  }
  async function pullServer() {
    try {
      const url = state.editKey ? API + '?key=' + encodeURIComponent(state.editKey) : API;
      const res = await fetch(url, { headers: state.editKey ? { 'x-edit-key': state.editKey } : {} });
      if (res.status === 401) { if (askKey()) return pullServer(); return; }
      if (!res.ok) return;
      const live = await res.json();
      Object.entries(live).forEach(([id, rec]) => {
        if (id === '_submission') { if (rec.updatedAt) { state.submittedAt = rec.updatedAt; } return; }
        if (id === '_message') { state.message = rec.n || ''; return; }
        state.marks[id] = rec.v === 'agree' || rec.v === 'change' ? rec.v : '';
        state.notes[id] = rec.n || '';
        state.when[id] = rec.updatedAt || '';
      });
      persist();
      setStatus('');
    } catch (e) { /* offline: local state stands */ }
  }

  let statusEl = null;
  function setStatus(text, isErr) {
    if (!statusEl) statusEl = document.querySelector('[data-status]');
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('err', !!isErr);
  }

  // ── answers ──────────────────────────────────────────────────────────────
  function setMark(id, v, code) {
    const cur = state.marks[id] || '';
    const next = cur === v ? '' : v;           // pressing the lit button clears it
    state.marks[id] = next;
    state.when[id] = new Date().toISOString();
    persist();
    queue(id, next, state.notes[id] || '', code);
    return next;
  }
  const noteTimers = {};
  function setNote(id, text, code) {
    state.notes[id] = text;
    persist();
    clearTimeout(noteTimers[id]);
    noteTimers[id] = setTimeout(() => queue(id, state.marks[id] || '', text, code), 700);
  }
  function setMessage(text) {
    state.message = text;
    persist();
    clearTimeout(noteTimers._message);
    noteTimers._message = setTimeout(() => queue('_message', '', text), 700);
  }
  async function submit(summaryText) {
    await post(Object.assign({ id: '_submission', v: 'agree', n: summaryText }));
    state.submittedAt = new Date().toISOString();
    persist();
  }

  // ── rendering ────────────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
  const registerLink = (id) => REGISTER + '#' + encodeURIComponent(id);

  function tally(data) {
    let agree = 0, change = 0;
    data.cards.forEach((c) => { const v = state.marks[c.id]; if (v === 'agree') agree += 1; else if (v === 'change') change += 1; });
    return { agree, change, done: agree + change, total: data.cards.length, open: data.cards.length - agree - change };
  }

  function stateOf(id) { return state.marks[id] === 'agree' ? 'agree' : state.marks[id] === 'change' ? 'change' : 'open'; }
  function pillFor(id) {
    const s = stateOf(id);
    return '<span class="pill state ' + s + '">' + (s === 'agree' ? 'Agreed' : s === 'change' ? 'Change asked' : 'Waiting on you') + '</span>';
  }

  function cardHtml(c, n) {
    const s = stateOf(c.id);
    const codes = c.decisions.map((d) => '<a class="d" href="' + registerLink(d.id) + '" title="' + esc(d.q) + '">' + esc(d.id) + '</a>').join('');
    const rec = c.rec.map((r) => '<li>' + esc(r.text) + '<span class="tag">answers ' + r.d.map(esc).join(', ') + '</span></li>').join('');
    const qs = c.decisions.map((d) => '<li><span class="code">' + esc(d.id) + ' · ' + esc(d.code) + '</span><a href="' + registerLink(d.id) + '">' + esc(d.q) + '</a></li>').join('');
    return '<article class="card is-' + s + '" id="' + esc(c.id) + '" data-card="' + esc(c.id) + '" data-state="' + s + '">' +
      '<div class="card-h"><span class="card-n">' + String(n).padStart(2, '0') + ' of ' + TOTAL + '</span>' + pillFor(c.id) + '</div>' +
      '<div class="card-t"><h3>' + esc(c.title) + '</h3></div>' +
      '<div class="chips-d">' + codes + '</div>' +
      '<div class="card-b">' + (c.note ? '<p class="note">' + esc(c.note) + '</p>' : '') +
      '<p class="k">Recommendation</p><ul class="rec">' + rec + '</ul>' +
      '<p class="why"><b>Why</b>' + esc(c.why) + '</p>' +
      '<details class="more"><summary>The ' + (c.decisions.length === 1 ? 'question' : c.decisions.length + ' questions') + ' this answers</summary><ul class="qs">' + qs + '</ul></details></div>' +
      '<div class="card-f"><div class="act">' +
      '<button type="button" class="btn agree" data-mark="agree" aria-pressed="' + (s === 'agree') + '">Agree</button>' +
      '<button type="button" class="btn quiet change" data-mark="change" aria-pressed="' + (s === 'change') + '">Change</button>' +
      '<span class="when">' + (s !== 'open' && state.when[c.id] ? (s === 'agree' ? 'Agreed ' : 'Change asked ') + esc(fmtDay(state.when[c.id])) : '') + '</span></div>' +
      '<div class="change-panel"' + (s === 'change' ? '' : ' hidden') + '><label for="note-' + esc(c.id) + '">What should be different?</label>' +
      '<textarea id="note-' + esc(c.id) + '" data-note="' + esc(c.id) + '" placeholder="A sentence is enough: the part to change and what it should be instead.">' + esc(state.notes[c.id] || '') + '</textarea>' +
      '<span class="hint">Saved as you type. Leave it blank if you would rather talk it through.</span></div></div></article>';
  }

  let TOTAL = 0;
  function renderAll(data) {
    TOTAL = data.cards.length;
    let n = 0;
    const html = data.groups.map((g) => {
      const cards = data.cards.filter((c) => c.group === g.id);
      if (!cards.length) return '';
      return '<section class="group" data-group="' + esc(g.id) + '"><div class="sec-h"><h2 class="sec-t">' + esc(g.title) + '</h2><span class="sec-c" data-group-count></span></div>' +
        cards.map((c) => cardHtml(c, ++n)).join('') + '</section>';
    }).join('');
    document.getElementById('groups').innerHTML = html;
    applyFilter(data);
  }

  function refreshCard(data, id) {
    const c = data.cards.find((x) => x.id === id);
    const el = document.querySelector('[data-card="' + id + '"]');
    if (!c || !el) return;
    const s = stateOf(id);
    el.className = 'card is-' + s;
    el.dataset.state = s;
    el.querySelector('.state').outerHTML = pillFor(id);
    el.querySelector('[data-mark="agree"]').setAttribute('aria-pressed', String(s === 'agree'));
    el.querySelector('[data-mark="change"]').setAttribute('aria-pressed', String(s === 'change'));
    el.querySelector('.when').textContent = s !== 'open' && state.when[id] ? (s === 'agree' ? 'Agreed ' : 'Change asked ') + fmtDay(state.when[id]) : '';
    const panel = el.querySelector('.change-panel');
    panel.hidden = s !== 'change';
    if (s === 'change') panel.querySelector('textarea').focus();
  }

  function applyFilter(data) {
    const f = state.filter;
    document.querySelectorAll('.card').forEach((el) => {
      const s = el.dataset.state;
      el.hidden = !(f === 'all' || s === f);
    });
    document.querySelectorAll('.group').forEach((g) => {
      const shown = g.querySelectorAll('.card:not([hidden])').length;
      g.hidden = shown === 0;
      const total = g.querySelectorAll('.card').length;
      const agreed = g.querySelectorAll('.card[data-state="agree"]').length;
      const changed = g.querySelectorAll('.card[data-state="change"]').length;
      g.querySelector('[data-group-count]').textContent = (agreed + changed) + ' of ' + total + ' answered';
    });
    document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    renderProgress(data);
  }

  function renderProgress(data) {
    const t = tally(data);
    document.getElementById('bar').style.width = (t.total ? Math.round(100 * t.done / t.total) : 0) + '%';
    document.getElementById('count').textContent = t.done + ' of ' + t.total + ' answered · ' + t.agree + ' agreed · ' + t.change + ' to change';
    document.getElementById('nav-progress').innerHTML = '<b>' + t.done + '</b> of <b>' + t.total + '</b> answered';
    const decisions = data.cards.reduce((s, c) => s + c.decisions.length, 0);
    document.getElementById('meta').innerHTML =
      '<div><dt>Open questions</dt><dd>' + decisions + ' on the register</dd></div>' +
      '<div><dt>Recommendations</dt><dd>' + t.total + ', one per card</dd></div>' +
      '<div><dt>Prepared</dt><dd>' + esc(new Date(data.generated + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })) + '</dd></div>' +
      '<div><dt>Where you are</dt><dd>' + (t.done ? t.agree + ' agreed, ' + t.change + ' to change, ' + t.open + ' left' : 'Nothing answered yet') + '</dd></div>';
    document.getElementById('send-p').textContent = t.open === 0
      ? 'Every card is answered: ' + t.agree + ' agreed and ' + t.change + ' to change. Press Send and they are recorded.'
      : t.open + ' card' + (t.open === 1 ? '' : 's') + ' still waiting. You can send now and come back for the rest, or finish first.';
    document.getElementById('submit').disabled = t.done === 0;
    document.getElementById('sent').innerHTML = state.submittedAt ? '<div class="sent">Last sent ' + esc(new Date(state.submittedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })) + '. Sending again replaces it.</div>' : '';
    document.getElementById('next').hidden = t.open === 0;
  }

  function summaryText(data) {
    const t = tally(data);
    const lines = ['HOAhx · Open questions · answers sent ' + new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }), ''];
    data.cards.forEach((c, i) => {
      const s = stateOf(c.id);
      lines.push((i + 1) + '. ' + c.title + ' (' + c.decisions.map((d) => d.id).join(', ') + '): ' + (s === 'agree' ? 'AGREE' : s === 'change' ? 'CHANGE' : 'not answered') + (s === 'change' && state.notes[c.id] ? ' — ' + state.notes[c.id] : ''));
    });
    lines.push('', t.agree + ' agreed · ' + t.change + ' to change · ' + t.open + ' not answered');
    if (state.message) lines.push('', 'Message: ' + state.message);
    return lines.join('\n');
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  async function main() {
    const res = await fetch('/answers/data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('data.json not found');
    const data = await res.json();
    document.getElementById('title').textContent = data.title;
    document.getElementById('lede').textContent = data.lede;
    document.title = 'HOAhx · ' + data.title;
    await pullServer();
    window.addEventListener('online', flush);
    renderAll(data);

    const msg = document.getElementById('msg');
    msg.value = state.message || '';
    msg.addEventListener('input', () => setMessage(msg.value));

    document.getElementById('groups').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-mark]');
      if (!btn) return;
      const card = btn.closest('[data-card]');
      const id = card.dataset.card;
      setMark(id, btn.dataset.mark, id);
      refreshCard(data, id);
      applyFilter(data);
    });
    document.getElementById('groups').addEventListener('input', (ev) => {
      const ta = ev.target.closest('[data-note]');
      if (ta) setNote(ta.dataset.note, ta.value, ta.dataset.note);
    });
    document.querySelector('.chips').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      state.filter = chip.dataset.filter;
      applyFilter(data);
    });
    document.getElementById('next').addEventListener('click', () => {
      const y = window.scrollY + 130;
      const cards = [...document.querySelectorAll('.card[data-state="open"]:not([hidden])')];
      const next = cards.find((el) => el.getBoundingClientRect().top + window.scrollY > y) || cards[0];
      if (next) next.scrollIntoView({ block: 'start' });
    });
    document.getElementById('submit').addEventListener('click', async () => {
      const btn = document.getElementById('submit');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await submit(summaryText(data));
        btn.textContent = 'Sent';
        renderProgress(data);
        setTimeout(() => { btn.textContent = 'Send your answers'; btn.disabled = false; }, 2500);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Send your answers';
        document.getElementById('sent').innerHTML = '<div class="sent err">Not sent: ' + esc(e.message === 'unauthorized' ? 'the passphrase was not accepted. Reload the page and enter it when asked.' : 'no connection. Your answers are kept in this browser; try again in a moment.') + '</div>';
      }
    });
    document.getElementById('print').addEventListener('click', () => window.print());
  }

  main().catch((e) => { document.getElementById('groups').innerHTML = '<p class="empty">The recommendations could not be loaded (' + esc(e.message) + '). Reload the page.</p>'; });
})();
