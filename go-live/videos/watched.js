/* HOAhx · Product videos: every product video the owners can open today, and who has watched each.
 * One script for /answers and /hub. It mounts into <section id="product-videos"> and reads:
 *   /answers/data.json     the feature videos linked from the questions (videos: { "07": { title, seconds, url } })
 *   /answers/screens.json  the film of each screen (screens[].walk: { seconds, url })
 *   /videos/data.json      the feature videos approved for the owners (videos[]: { id, title, length, driveUrl })
 *   /api/videos            watched: { f07: { Dan: at, Tenyson: at }, sA1: { Rustin: at } }
 * A video is watched once Dan or Rustin has ticked it. Tenyson may tick too; his tick alone does not count.
 * Ticks are saved per video and per person (POST /api/videos { action: 'watched', item, who, watched }). */
(function () {
  'use strict';
  const PEOPLE = ['Dan', 'Rustin', 'Tenyson'];
  const COUNTS = ['Dan', 'Rustin'];
  const LS_KEY = 'hoahx-edit-key';
  const LS_FILTER = 'hoahx-product-videos-filter';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const len = (s) => { s = Math.round(+s || 0); return s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : ''; };
  const ls = { get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } } };

  let el, items = [], watched = {}, filter = ls.get(LS_FILTER) === 'open' ? 'open' : 'all', statusText = '', statusErr = false;
  let key = ls.get(LS_KEY) || ls.get('decision-edit-key');

  const counted = (id) => COUNTS.some((p) => watched[id] && watched[id][p]);
  const headers = (extra) => Object.assign({}, extra || {}, key ? { 'x-edit-key': key } : {});

  async function load(path) {
    try { const r = await fetch(path, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }

  /** The list, feature videos first (by number), then the film of each screen (in the screens' order). */
  function buildItems(answers, screens, approved) {
    const feat = new Map();
    for (const [id, v] of Object.entries((answers && answers.videos) || {})) {
      if (v && v.url) feat.set(id, { id: 'f' + id, num: id, title: v.title, length: len(v.seconds), url: v.url });
    }
    for (const v of (approved && approved.videos) || []) {
      if (v && v.driveUrl) feat.set(v.id, { id: 'f' + v.id, num: v.id, title: v.title, length: v.length || '', url: v.driveUrl });
    }
    const out = [...feat.values()].sort((a, b) => a.num.localeCompare(b.num)).map((v) => Object.assign(v, { kind: 'feature', label: 'Video ' + v.num }));
    for (const f of (screens && screens.features) || []) {
      for (const s of f.screens || []) {
        if (s.walk && s.walk.url && /^[A-Z]\d{1,2}$/.test(s.code)) {
          out.push({ id: 's' + s.code, kind: 'screen', label: 'Screen ' + s.code, title: s.title, length: len(s.walk.seconds), url: s.walk.url });
        }
      }
    }
    return out;
  }

  async function pull() {
    try {
      const r = await fetch('/api/videos', { headers: headers(), cache: 'no-store' });
      if (r.ok) { watched = (await r.json()).watched || {}; return true; }
    } catch (e) { /* the list still shows, without ticks */ }
    return false;
  }

  function setStatus(t, err) {
    statusText = t; statusErr = !!err;
    const s = el && el.querySelector('.pv-status');
    if (s) { s.textContent = t; s.classList.toggle('err', !!err); }
  }

  async function save(item, who, on) {
    const body = JSON.stringify({ action: 'watched', item, who, watched: on });
    let r;
    try { r = await fetch('/api/videos', { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body }); } catch (e) { r = null; }
    if (r && r.status === 401) {
      const k = window.prompt('This page is protected. Enter the passphrase you were given to save your answers.');
      if (k) { key = k.trim(); ls.set(LS_KEY, key); return save(item, who, on); }
    }
    return !!(r && r.ok);
  }

  async function onTick(input) {
    const { item, who } = input.dataset;
    const on = input.checked;
    const before = watched[item] ? Object.assign({}, watched[item]) : null;
    watched[item] = Object.assign({}, watched[item] || {});
    if (on) watched[item][who] = new Date().toISOString(); else delete watched[item][who];
    setStatus('Saving…');
    render();
    if (await save(item, who, on)) { setStatus('Saved'); render(); return; }
    if (before) watched[item] = before; else delete watched[item];
    setStatus('Not saved. Check your connection and tick it again.', true);
    render();
  }

  function pill(v) {
    if (counted(v.id)) return '<span class="pv-pill done">Watched</span>';
    if (watched[v.id] && watched[v.id].Tenyson) return '<span class="pv-pill part">Needs Dan or Rustin</span>';
    return '<span class="pv-pill open">Still to watch</span>';
  }

  function row(v) {
    const w = watched[v.id] || {};
    const boxes = PEOPLE.map((p) => `<label class="pv-who${w[p] ? ' on' : ''}"><input type="checkbox" data-item="${esc(v.id)}" data-who="${p}"${w[p] ? ' checked' : ''} aria-label="${p} watched ${esc(v.title)}"><span>${p}</span></label>`).join('');
    return `<li class="pv-row${counted(v.id) ? ' is-done' : ''}" id="pv-${esc(v.id)}">
      <div class="pv-what">
        <p class="pv-meta"><span>${esc(v.label)}${v.length ? ' · ' + esc(v.length) : ''}</span>${pill(v)}</p>
        <p class="pv-title">${esc(v.title)}</p>
        <a class="pv-watch" href="${esc(v.url)}" target="_blank" rel="noopener">Watch<span class="pv-sr"> ${esc(v.title)}</span> <span aria-hidden="true">↗</span></a>
      </div>
      <fieldset class="pv-by"><legend>Watched by</legend>${boxes}</fieldset>
    </li>`;
  }

  function group(title, list) {
    const shown = filter === 'open' ? list.filter((v) => !counted(v.id)) : list;
    if (!list.length) return '';
    const left = list.filter((v) => !counted(v.id)).length;
    return `<div class="pv-group"><h3>${esc(title)} <span>${left ? left + ' still to watch' : 'all watched'}</span></h3>
      ${shown.length ? `<ul class="pv-list">${shown.map(row).join('')}</ul>` : '<p class="pv-none">Every one of these has been watched.</p>'}</div>`;
  }

  function render() {
    const total = items.length;
    const left = items.filter((v) => !counted(v.id)).length;
    const done = total - left;
    // re-drawing replaces the controls: keep the keyboard where it was
    const a = document.activeElement, keep = a && el.contains(a) ? (a.dataset.item ? `input[data-item="${a.dataset.item}"][data-who="${a.dataset.who}"]` : a.dataset.filter ? `button[data-filter="${a.dataset.filter}"]` : '') : '';
    const tab = document.querySelector('a[href="#product-videos"]');
    if (tab) tab.textContent = left ? 'Product videos (' + left + ')' : 'Product videos';
    el.innerHTML = `<div class="pv-head">
        <p class="pv-eyebrow">Recorded from the product · sample community · HOAhx has not launched</p>
        <h2 id="product-videos-h">Product videos</h2>
        <p>Every video of the product you can open today. Watch one, then tick your name beside it. A video counts as watched once Dan or Rustin has ticked it; Tenyson is welcome to tick too, but his tick alone does not take it off the list. More than one person can tick the same video.</p>
        <div class="pv-count"><p><b class="pv-n">${left}</b> of ${total} still to watch</p>
          <div class="pv-meter" aria-hidden="true"><i style="width:${total ? (100 * done / total).toFixed(1) : 0}%"></i></div></div>
        <div class="pv-bar">
          <div class="pv-chips" role="group" aria-label="Show videos">
            <button type="button" class="pv-chip" data-filter="all" aria-pressed="${filter === 'all'}">All ${total}</button>
            <button type="button" class="pv-chip" data-filter="open" aria-pressed="${filter === 'open'}">Still to watch ${left}</button>
          </div>
          <span class="pv-status${statusErr ? ' err' : ''}" role="status" aria-live="polite">${esc(statusText)}</span>
        </div>
      </div>
      ${group('Feature videos', items.filter((v) => v.kind === 'feature'))}
      ${group('A film of each screen', items.filter((v) => v.kind === 'screen'))}`;
    if (keep) { const f = el.querySelector(keep); if (f) f.focus(); }
  }

  function style() {
    if (document.querySelector('link[href="/videos/watched.css"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/videos/watched.css'; document.head.appendChild(l);
  }

  async function run() {
    el = document.getElementById('product-videos');
    if (!el) return;
    const [answers, screens, approved] = await Promise.all([load('/answers/data.json'), load('/answers/screens.json'), load('/videos/data.json')]);
    items = buildItems(answers, screens, approved);
    if (!items.length) return; // nothing to watch yet: no empty section
    style();
    el.hidden = false;
    el.classList.add('pv');
    el.setAttribute('aria-labelledby', 'product-videos-h');
    const tab = document.querySelector('a[href="#product-videos"]'); if (tab) tab.hidden = false;
    render();
    if (!(await pull())) setStatus('Could not read who has watched what. The list is shown without ticks.', true);
    render();
    if (location.hash === '#product-videos') el.scrollIntoView({ block: 'start' });
    el.addEventListener('change', (e) => { if (e.target.matches('input[data-item]')) onTick(e.target); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter]'); if (!b) return;
      filter = b.dataset.filter; ls.set(LS_FILTER, filter); render();
    });
    // someone else may have ticked a video meanwhile: read again when the page is looked at again
    document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && await pull()) render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
