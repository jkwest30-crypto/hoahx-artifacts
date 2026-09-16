/* HOAhx · Beyond the proposal — shared behaviour for /scope/.
   Data: ./data.json (built by the HOAhx repo's docs/launch/scripts/build-a-la-carte.py --json).
   Selection: kept in this browser (localStorage) and saved to the site's shared store
   (POST /api/picks, one record per package or feature, history kept), so the owners see the
   same selection on every device and the launch program can read it back. */
(function () {
  'use strict';

  const LS_KEY = 'hoahx-scope-v1';
  const LS_EDIT_KEY = 'hoahx-edit-key';
  const API = '/api/picks';

  // ── state ────────────────────────────────────────────────────────────────
  const state = { picks: {}, notes: {}, message: '', submittedAt: '', editKey: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.assign(state, saved);
    state.editKey = localStorage.getItem(LS_EDIT_KEY) || '';
  } catch (e) { /* storage unavailable: the page still works */ }

  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ picks: state.picks, notes: state.notes, message: state.message, submittedAt: state.submittedAt })); } catch (e) { /* ignore */ }
  }

  // ── date and money ───────────────────────────────────────────────────────
  function addWorkdays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    let left = Math.max(0, Math.ceil(n));
    while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1; }
    return d;
  }
  const fmtDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });
  const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtH = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

  // ── totals: a picked package counts its items once; an item inside a picked package is not counted again ──
  function selection(data) {
    const byId = {};
    [...data.core, ...data.candidates].forEach((i) => { byId[i.id] = i; });
    const pkgs = data.packages.filter((p) => state.picks[p.id] === 'yes');
    const inPicked = new Set(pkgs.flatMap((p) => p.items));
    const items = [...data.core, ...data.candidates].filter((i) => state.picks[i.id] === 'yes' && !inPicked.has(i.id));
    const hours = pkgs.reduce((s, p) => s + (Number(p.jake) || 0), 0) + items.reduce((s, i) => s + (Number(i.jake) || 0), 0);
    const count = pkgs.reduce((s, p) => s + p.n, 0) + items.length;
    const days = Math.ceil(hours / data.hoursPerDay);
    const date = addWorkdays(data.baseline, days);
    return { pkgs, items, inPicked, hours, count, days, date, cost: hours * data.rate, byId };
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
          setStatus(e.code === 401 ? 'Not saved: the passphrase was not accepted. Your selection is kept in this browser.' : 'Not saved yet: no connection. Your selection is kept in this browser and will be saved when it returns.', true);
          flushing = false;
          return;
        }
      }
      setStatus('Saved');
    } finally { flushing = false; }
  }
  function askKey() {
    const k = window.prompt('This page is protected. Enter the passphrase you were given to save your selection.');
    if (!k) return false;
    state.editKey = k.trim();
    try { localStorage.setItem(LS_EDIT_KEY, state.editKey); } catch (e) { /* ignore */ }
    return true;
  }
  function queue(id, v, n, extra) {
    pending.push(Object.assign({ id, v, n: n || '' }, extra || {}));
    flush();
  }
  async function pullServer() {
    try {
      const url = state.editKey ? API + '?key=' + encodeURIComponent(state.editKey) : API;
      const res = await fetch(url, { headers: state.editKey ? { 'x-edit-key': state.editKey } : {} });
      if (res.status === 401) { if (askKey()) return pullServer(); return; }
      if (!res.ok) return;
      const live = await res.json();
      let changed = false;
      Object.entries(live).forEach(([id, rec]) => {
        if (id === '_submission') { if (rec.updatedAt && rec.updatedAt !== state.submittedAt) { state.submittedAt = rec.updatedAt; state.message = rec.n || state.message; changed = true; } return; }
        if (id === '_message') { if ((rec.n || '') !== state.message) { state.message = rec.n || ''; changed = true; } return; }
        const v = rec.v === 'yes' ? 'yes' : '';
        if ((state.picks[id] || '') !== v) { if (v) state.picks[id] = v; else delete state.picks[id]; changed = true; }
        if ((rec.n || '') !== (state.notes[id] || '')) { state.notes[id] = rec.n || ''; changed = true; }
      });
      if (changed) { persist(); document.dispatchEvent(new CustomEvent('scope:changed')); }
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

  // ── picks ────────────────────────────────────────────────────────────────
  function toggle(id, code) {
    const v = state.picks[id] === 'yes' ? '' : 'yes';
    if (v) state.picks[id] = v; else delete state.picks[id];
    persist();
    queue(id, v, state.notes[id] || '', { code });
    document.dispatchEvent(new CustomEvent('scope:changed'));
  }
  const noteTimers = {};
  function setNote(id, text, code) {
    state.notes[id] = text;
    persist();
    clearTimeout(noteTimers[id]);
    noteTimers[id] = setTimeout(() => queue(id, state.picks[id] || '', text, { code }), 700);
  }
  function setMessage(text) {
    state.message = text;
    persist();
    clearTimeout(noteTimers._message);
    noteTimers._message = setTimeout(() => queue('_message', '', text), 700);
  }
  function selectMany(ids, on) {
    ids.forEach((id) => { if (on) state.picks[id] = 'yes'; else delete state.picks[id]; pending.push({ id, v: on ? 'yes' : '', n: state.notes[id] || '' }); });
    persist();
    flush();
    document.dispatchEvent(new CustomEvent('scope:changed'));
  }
  async function submit(data, summaryText) {
    const now = new Date().toISOString();
    await post(Object.assign({ id: '_submission', v: 'yes', n: summaryText }, state.editKey ? { key: state.editKey } : {}));
    state.submittedAt = now;
    persist();
    document.dispatchEvent(new CustomEvent('scope:changed'));
    return now;
  }

  // ── rendering helpers ────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function pill(priority) {
    const p = String(priority || '').toLowerCase();
    if (p === 'high' || p === 'medium' || p === 'low') return '<span class="pill ' + p + '">' + esc(priority) + ' priority</span>';
    return '<span class="pill low">' + esc(priority) + '</span>';
  }
  function stagePill(item) {
    if (!item.stage) return '';
    return '<span class="pill stage">Stage ' + esc(item.stage) + ' · ' + esc(String(item.stageName || '').split(':')[0]) + '</span>';
  }

  function renderNav(active, data) {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const tabs = [['index.html', 'My recommendation'], ['packages.html', 'Packages'], ['features.html', 'Features'], ['review.html', 'Review and send']];
    const sel = data ? selection(data) : null;
    nav.innerHTML = '<div class="wrap nav-in"><a class="nav-brand" href="index.html">HOAhx · Beyond the proposal</a>' +
      tabs.map(([href, label]) => '<a class="tab" href="' + href + '"' + (active === href ? ' aria-current="page"' : '') + '>' + label + '</a>').join('') +
      (sel ? '<div class="sel"><span><b>' + sel.count + '</b> feature' + (sel.count === 1 ? '' : 's') + ' · <b>' + fmtH(sel.hours) + '</b> h</span>' +
        (active === 'review.html' ? '' : '<a href="review.html"' + (sel.count ? '' : ' class="quiet"') + '>Review' + (sel.count ? ' and send' : '') + '</a>') + '</div>' : '') +
      '</div>';
  }

  function renderTally(data) {
    const el = document.querySelector('[data-tally]');
    if (!el) return;
    const s = selection(data);
    el.innerHTML = '<div class="wrap tally-in">' +
      '<div class="t"><span>Selected</span><b>' + s.count + ' feature' + (s.count === 1 ? '' : 's') + (s.pkgs.length ? ' in ' + s.pkgs.length + ' package' + (s.pkgs.length === 1 ? '' : 's') + (s.items.length ? ' + ' + s.items.length : '') : '') + '</b></div>' +
      '<div class="t"><span>Hours added</span><b>' + fmtH(s.hours) + '</b></div>' +
      '<div class="t"><span>Working days</span><b>' + s.days + '</b></div>' +
      '<div class="t"><span>Launch date</span><b>' + esc(fmtDate(s.date)) + '</b></div>' +
      '<div class="t"><span>Added cost</span><b>' + fmtMoney(s.cost) + '</b></div>' +
      '<div class="go"><span class="status" data-status></span><a class="btn' + (s.count ? '' : ' quiet') + '" href="review.html">Review and send</a></div></div>';
    statusEl = null;
  }

  async function load() {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('data.json not found');
    const data = await res.json();
    await pullServer();
    window.addEventListener('online', flush);
    return data;
  }

  window.SCOPE = { state, load, selection, toggle, setNote, setMessage, selectMany, submit, renderNav, renderTally, esc, pill, stagePill, fmtDate, fmtMoney, fmtH, addWorkdays, isPicked: (id) => state.picks[id] === 'yes' };
})();
