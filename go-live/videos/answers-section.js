/* HOAhx · the "Videos to review" section on /answers. Self-contained: it reads the owners' list
 * (/videos/data.json) and their answers (/api/videos) and puts one card per video on the page, each
 * linking to that video on /videos, where the owners answer and leave notes with screenshots.
 * It mounts into <section id="videos-to-review"> if the page has one, otherwise before the send box. */
(function () {
  'use strict';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function mount() {
    let el = document.getElementById('videos-to-review');
    if (el) return el;
    el = document.createElement('section');
    el.id = 'videos-to-review';
    const send = document.getElementById('send') || document.querySelector('section.send');
    const main = document.querySelector('main');
    if (send && send.parentNode) send.parentNode.insertBefore(el, send); else if (main) main.appendChild(el); else return null;
    return el;
  }
  function state(v, answers) {
    const r = answers[v.id];
    if (!r || !r.status) return 'open';
    if (r.commit === v.commit) return r.status;
    return r.status === 'wrong' ? 'open' : 'approved';
  }
  function style() {
    if (document.querySelector('link[href="/videos/videos.css"]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/videos/videos.css'; document.head.appendChild(l);
  }
  async function run() {
    const el = mount(); if (!el) return;
    let list, answers = {};
    try { list = await (await fetch('/videos/data.json', { cache: 'no-cache' })).json(); } catch (e) { return; }
    const videos = (list && list.videos) || [];
    if (!videos.length) return; // nothing ready yet: no empty section on the owners' page
    try {
      const h = {}; try { const k = localStorage.getItem('decision-edit-key'); if (k) h['x-edit-key'] = k; } catch (e) { /* none */ }
      const r = await fetch('/api/videos', { headers: h, cache: 'no-store' });
      if (r.ok) answers = (await r.json()).owners || {};
    } catch (e) { /* the cards still show, without answers */ }
    const done = videos.filter((v) => state(v, answers) !== 'open').length;
    const pill = (s) => s === 'approved' ? '<span class="pill yes">Looks right</span>' : s === 'wrong' ? '<span class="pill wrong">Something looks wrong</span>' : '<span class="pill open">Not reviewed</span>';
    style();
    el.hidden = false;
    const tab = document.querySelector('a[href="#videos-to-review"]'); if (tab) tab.hidden = false;
    el.className = 'vreview';
    el.setAttribute('aria-labelledby', 'videos-to-review-h');
    el.innerHTML = `<div class="vreview-h"><p class="eyebrow">Recorded from the product · sample community · HOAhx has not launched</p>
      <h2 id="videos-to-review-h">Videos to review</h2>
      <p>Short recordings of what was built, one feature each. Open one to watch it, then say whether it looks right, or what looks wrong, with a screenshot if that helps. New videos appear here as they are ready.</p>
      <p class="due">${done} of ${videos.length} reviewed${list.waiting ? ` · ${list.waiting} more being checked` : ''}</p></div>
      <div class="vgrid">${videos.map((v) => { const s = state(v, answers); return `<div class="vtile${s === 'approved' ? ' is-yes' : s === 'wrong' ? ' is-wrong' : ''}">
        <div class="row"><span class="card-n">${esc(v.id)}${v.length ? ' · ' + esc(v.length) : ''}</span>${pill(s)}</div>
        <h3>${esc(v.title)}</h3><p>${esc(v.about)}</p>
        <div class="row">${v.updateComing ? '<span class="hint">A new version is coming</span>' : '<span></span>'}<a class="btn quiet" href="/videos#v-${esc(v.id)}">Review this video →</a></div></div>`; }).join('')}</div>`;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
