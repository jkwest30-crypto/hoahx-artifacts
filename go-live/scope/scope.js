/* HOAhx · Beyond the proposal — shared behaviour for /scope/.
   Data: ./data.json (built by the HOAhx repo's docs/launch/scripts/build-a-la-carte.py --json).
   Selection: kept in this browser (localStorage) and saved to the site's shared store
   (POST /api/picks, one record per package or feature, history kept), so the owners see the
   same selection on every device and the launch program can read it back.
   Locked: the selection of September 17 is agreed (change order 2). The store sends it as
   `_locked`; those packages and the features inside them always show as agreed, cannot be
   removed or annotated here, and the store refuses any change to them. Totals, the review and
   Send cover only what is added after it. */
(function () {
  'use strict';

  const LS_KEY = 'hoahx-scope-v2';  // v2: the Sep 17 selection is locked; v1's local copy is dropped
  const LS_EDIT_KEY = 'hoahx-edit-key';
  const API = '/api/picks';

  // ── state ────────────────────────────────────────────────────────────────
  const state = { picks: {}, notes: {}, message: '', submittedAt: '', editKey: '', locked: null };
  const lockedIds = new Set();
  const isLocked = (id) => lockedIds.has(id);
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    delete saved.locked;
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
  const fmtHours = (n) => (Number(n) > 0 ? fmtH(n) + ' h' : 'included');

  // ── totals: a picked package counts its items once; an item inside a picked package is not counted again.
  //    `agreed` is the locked selection of September 17; `pkgs`, `items`, hours and cost are only what is added after it. ──
  function selection(data) {
    const byId = {};
    [...data.core, ...data.candidates].forEach((i) => { byId[i.id] = i; });
    const agreed = data.packages.filter((p) => isLocked(p.id));
    const pkgs = data.packages.filter((p) => state.picks[p.id] === 'yes' && !isLocked(p.id));
    const inPicked = new Set(agreed.concat(pkgs).flatMap((p) => p.items).concat([...lockedIds]));
    const items = [...data.core, ...data.candidates].filter((i) => state.picks[i.id] === 'yes' && !inPicked.has(i.id));
    const hours = pkgs.reduce((s, p) => s + (Number(p.jake) || 0), 0) + items.reduce((s, i) => s + (Number(i.jake) || 0), 0);
    const count = pkgs.reduce((s, p) => s + p.n, 0) + items.length;
    const days = Math.ceil(hours / data.hoursPerDay);
    const date = addWorkdays(data.baseline, days);
    const agreedCount = agreed.reduce((s, p) => s + p.n, 0);
    return { agreed, agreedCount, pkgs, items, inPicked, hours, count, days, date, cost: hours * data.rate, byId };
  }

  // ── shared store ─────────────────────────────────────────────────────────
  const pending = [];
  let flushing = false;
  async function post(rec) {
    const body = Object.assign({}, rec);
    if (state.editKey) body.key = state.editKey;
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) { const err = new Error('unauthorized'); err.code = 401; throw err; }
    if (res.status === 423) { const err = new Error('locked'); err.code = 423; throw err; }
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
          if (e.code === 423) { pending.shift(); setStatus('That part of your selection is agreed and locked, so it was not changed.', true); continue; }
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
        if (id === '_locked') { applyLock(rec); return; }
        if (id === '_submission' || id === '_additions') { if (id !== '_additions') return; if (rec.updatedAt && rec.updatedAt !== state.submittedAt) { state.submittedAt = rec.updatedAt; state.message = rec.n || state.message; changed = true; } return; }
        if (id === '_addmsg') { if ((rec.n || '') !== state.message) { state.message = rec.n || ''; changed = true; } return; }
        const v = rec.v === 'yes' ? 'yes' : '';
        if ((state.picks[id] || '') !== v) { if (v) state.picks[id] = v; else delete state.picks[id]; changed = true; }
        if ((rec.n || '') !== (state.notes[id] || '')) { state.notes[id] = rec.n || ''; changed = true; }
      });
      if (changed) { persist(); document.dispatchEvent(new CustomEvent('scope:changed')); }
      setStatus('');
    } catch (e) { /* offline: local state stands */ }
  }

  function applyLock(lock) {
    if (!lock || !Array.isArray(lock.packages)) return;
    state.locked = lock;
    lockedIds.clear();
    lock.packages.concat(lock.features || []).forEach((id) => lockedIds.add(id));
    lock.packages.forEach((id) => { state.picks[id] = 'yes'; });
    (lock.features || []).forEach((id) => { delete state.picks[id]; });
  }

  // The banner every page shows once the store has sent the lock.
  function renderLock() {
    const host = document.querySelector('.mast-in');
    if (!host || !state.locked) return;
    let el = host.querySelector('.locked-note');
    if (!el) { el = document.createElement('div'); el.className = 'locked-note'; el.setAttribute('role', 'note'); host.appendChild(el); }
    const when = state.locked.chosenAt ? new Date(state.locked.chosenAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'September 17, 2026';
    el.innerHTML = '<b>Your selection of ' + esc(when) + ' is agreed and locked.</b> ' +
      esc(state.locked.packages.length + ' packages and every feature inside them are in the launch. ' + (state.locked.agreedIn || '') + '.') +
      ' They show as agreed on every page and cannot be removed here. You can still add a package or a feature that is not in it; anything you add is written up with its hours, cost and date before it is built.';
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
    if (isLocked(id)) return;
    const v = state.picks[id] === 'yes' ? '' : 'yes';
    if (v) state.picks[id] = v; else delete state.picks[id];
    persist();
    queue(id, v, state.notes[id] || '', { code });
    document.dispatchEvent(new CustomEvent('scope:changed'));
  }
  const noteTimers = {};
  function setNote(id, text, code) {
    if (isLocked(id)) return;
    state.notes[id] = text;
    persist();
    clearTimeout(noteTimers[id]);
    noteTimers[id] = setTimeout(() => queue(id, state.picks[id] || '', text, { code }), 700);
  }
  function setMessage(text) {
    state.message = text;
    persist();
    clearTimeout(noteTimers._message);
    noteTimers._message = setTimeout(() => queue('_addmsg', '', text), 700);
  }
  function selectMany(ids, on) {
    ids = ids.filter((id) => !isLocked(id));
    if (!ids.length) return;
    ids.forEach((id) => { if (on) state.picks[id] = 'yes'; else delete state.picks[id]; pending.push({ id, v: on ? 'yes' : '', n: state.notes[id] || '' }); });
    persist();
    flush();
    document.dispatchEvent(new CustomEvent('scope:changed'));
  }
  async function submit(data, summaryText) {
    const now = new Date().toISOString();
    await post(Object.assign({ id: '_additions', v: 'yes', n: summaryText }, state.editKey ? { key: state.editKey } : {}));
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
      (sel ? '<div class="sel"><span>' + (sel.agreed.length ? '<b>' + sel.agreed.length + '</b> agreed · ' : '') + '<b>' + sel.count + '</b> added · <b>' + fmtH(sel.hours) + '</b> h</span>' +
        (active === 'review.html' ? '' : '<a href="review.html"' + (sel.count ? '' : ' class="quiet"') + '>Review' + (sel.count ? ' and send' : '') + '</a>') + '</div>' : '') +
      '</div>';
  }

  function renderTally(data) {
    const el = document.querySelector('[data-tally]');
    if (!el) return;
    const s = selection(data);
    el.innerHTML = '<div class="wrap tally-in">' +
      (s.agreed.length ? '<div class="t"><span>Agreed Sep 17 · locked</span><b>' + s.agreed.length + ' packages</b></div>' : '') +
      '<div class="t"><span>Added since</span><b>' + s.count + ' feature' + (s.count === 1 ? '' : 's') + (s.pkgs.length ? ' in ' + s.pkgs.length + ' package' + (s.pkgs.length === 1 ? '' : 's') + (s.items.length ? ' + ' + s.items.length : '') : '') + '</b></div>' +
      '<div class="t"><span>Hours added</span><b>' + fmtH(s.hours) + '</b></div>' +
      '<div class="t"><span>Working days</span><b>' + s.days + '</b></div>' +
      '<div class="t"><span>Added cost</span><b>' + fmtMoney(s.cost) + '</b></div>' +
      '<div class="go"><span class="status" data-status></span><a class="btn' + (s.count ? '' : ' quiet') + '" href="review.html">Review and send</a></div></div>';
    statusEl = null;
  }

  async function load() {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('data.json not found');
    const data = await res.json();
    await pullServer();
    renderLock();
    window.addEventListener('online', flush);
    return data;
  }

  window.SCOPE = { state, load, selection, toggle, setNote, setMessage, selectMany, submit, renderNav, renderTally, esc, pill, stagePill, fmtDate, fmtMoney, fmtH, fmtHours, addWorkdays, isLocked, isPicked: (id) => state.picks[id] === 'yes' || isLocked(id) };
})();
