/* HOAhx · Videos to review. One script for two pages:
 *   /videos          the owners: Looks right / Something looks wrong, a note with screenshots
 *   /videos/review   Jacob (not linked from anywhere): Approve for the owners / Needs a fix
 * The page's <body data-mode="owners|jacob"> says which. Store: /api/videos (netlify/functions/videos.js).
 * The list comes from a file the publish step writes: /videos/data.json (owners), /videos/review/all.json (Jacob).
 */
(function () {
  'use strict';
  const MODE = document.body.dataset.mode === 'jacob' ? 'jacob' : 'owners';
  const API = '/api/videos';
  const $ = (s, el) => (el || document).querySelector(s);
  const app = $('#app');
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: fine */ } },
  };
  const fmtDay = (iso) => { const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso + 'T12:00:00' : iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const ROLE = { homeowner: 'For a homeowner', board: 'For a board', 'management company': 'For a management company', 'community staff': 'For community staff' };

  const S = {
    videos: [], updated: '', waiting: 0,
    owners: {}, jacob: {}, notes: [],
    filter: store.get('videos-filter-' + MODE) || 'all',
    name: store.get('videos-name'),
    reviewKey: store.get('videos-review-key'),
    editKey: store.get('decision-edit-key'),
    open: {},          // vid -> note form open
    pending: {},       // vid -> [{ full, preview, w, h, ow, oh, results, ok, zoom }]
    unsent: {},        // ref -> [{ i, data }] full-size copies still to upload
    busy: {},          // vid -> message while saving
    error: '',
  };

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (S.editKey) h['x-edit-key'] = S.editKey;
    if (MODE === 'jacob' && S.reviewKey) h['x-review-key'] = S.reviewKey;
    return h;
  }
  async function call(body) {
    const res = await fetch(API + (body ? '' : MODE === 'jacob' ? '?side=jacob' : ''), body ? { method: 'POST', headers: headers(), body: JSON.stringify(body) } : { headers: headers(), cache: 'no-store' });
    let data = {}; try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) { const err = new Error(data.error || 'HTTP ' + res.status); err.status = res.status; throw err; }
    return data;
  }

  // ---- state helpers ---------------------------------------------------------------------------
  const side = MODE === 'jacob' ? 'jacob' : 'owners';
  const byId = (vid) => S.videos.find((v) => v.id === vid);
  /** Jacob: not reviewed / approved / fix, at the current recording. */
  function jacobState(v) {
    const r = S.jacob[v.id];
    if (!r || !r.status || r.commit !== v.commit) return 'open';
    return r.status;
  }
  /** Owners: their answer, and whether the video changed since they gave it. */
  function ownersState(v) {
    const r = S.owners[v.id];
    if (!r || !r.status) return { state: 'open' };
    if (r.commit === v.commit) return { state: r.status };
    // A new recording since they answered: a flag becomes "please check again", an approval stays.
    return r.status === 'wrong' ? { state: 'open', recheck: true } : { state: 'approved', updated: true };
  }
  const notesFor = (vid, who) => S.notes.filter((n) => n.vid === vid && (!who || n.side === who));
  const onOwnersPage = (v) => !!v.owners;

  // ---- screenshot checks (same rules as the mock-up) ---------------------------------------------
  function sharpness(img) {
    const s = Math.min(1, 800 / img.width), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0, sq = 0, n = 0;
    for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; sum += l; sq += l * l; n++; }
    return n ? sq / n - (sum / n) ** 2 : 0;
  }
  function shrink(img, maxW, q) {
    const s = Math.min(1, maxW / img.width), c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', q), w: c.width, h: c.height };
  }
  const kb = (u) => Math.round(u.length * 3 / 4 / 1024);
  function checkImage(img) {
    let full = shrink(img, 1600, 0.82);
    if (full.url.length > 3.9e6) full = shrink(img, 1280, 0.72);
    let preview = shrink(img, 480, 0.6);
    if (preview.url.length > 88000) preview = shrink(img, 400, 0.5);
    const sh = sharpness(img), res = [];
    res.push(img.width < 700 ? ['bad', `Small picture (${img.width} px wide). Words may be hard to read. A full-screen screenshot works best.`] : ['good', `Big enough: ${img.width} px wide.`]);
    res.push(sh < 40 ? ['bad', 'Looks blurry. If it is a photo of a screen, a screenshot will be clearer.'] : ['good', 'Sharp: the edges of the words are clear.']);
    if (img.width / img.height > 3.5 || img.height / img.width > 3.5) res.push(['bad', 'Very long and thin. The small preview may be hard to make out; the full copy is kept.']);
    res.push(['info', `Full copy ${kb(full.url)} KB, small preview ${kb(preview.url)} KB.`]);
    return { full: full.url, preview: preview.url, w: full.w, h: full.h, ow: img.width, oh: img.height, results: res, ok: false, zoom: false };
  }
  function addFiles(vid, files) {
    const list = [...files].filter((f) => /^image\//.test(f.type)).slice(0, 6 - (S.pending[vid] || []).length);
    if (!list.length) return;
    S.pending[vid] = S.pending[vid] || [];
    let left = list.length;
    list.forEach((f) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { S.pending[vid].push(checkImage(img)); URL.revokeObjectURL(url); if (--left === 0) keepText(vid, render); };
      img.onerror = () => { URL.revokeObjectURL(url); S.error = `${f.name} could not be opened as a picture.`; if (--left === 0) keepText(vid, render); };
      img.src = url;
    });
  }
  function keepText(vid, fn) {
    const ta = $(`#t-${vid}`); const txt = ta ? ta.value : null;
    fn();
    const t2 = $(`#t-${vid}`); if (t2 && txt != null) t2.value = txt;
  }

  // ---- rendering -------------------------------------------------------------------------------
  const driveIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3h7v7M13 3 5 11M3 6v7h7"/></svg>';

  function noteHtml(n) {
    const who = n.side === 'jacob' ? 'Jacob' : n.by || 'An owner';
    const imgs = (n.images || []).map((im) => {
      const link = MODE === 'jacob' && im.drive ? `https://drive.google.com/file/d/${esc(im.drive.id)}/view` : '';
      const pic = `<img src="${esc(im.preview)}" alt="Screenshot ${im.i} on note ${esc(n.ref)}" width="${Math.min(160, im.w)}">`;
      return link ? `<a href="${link}" target="_blank" rel="noopener" title="Full size in Drive">${pic}</a>` : pic;
    }).join('');
    let where = '';
    if (MODE === 'jacob' && (n.images || []).length) {
      const moved = n.images.filter((im) => im.drive).length, waiting = n.images.filter((im) => im.full && !im.drive).length, lost = n.images.length - moved - waiting;
      where = `<div class="hint">${moved ? `${moved} full size in Drive (click a picture). ` : ''}${waiting ? `${waiting} waiting for the next pull. ` : ''}${lost ? `${lost} full-size copy never arrived; only the preview. ` : ''}</div>`;
    }
    const v = byId(n.vid);
    const old = v && n.commit !== v.commit ? ' · on an earlier recording' : '';
    const retry = S.unsent[n.ref] ? `<div class="err-line">A full-size screenshot did not upload. <button type="button" class="link-btn" data-retry="${esc(n.ref)}">Try again</button></div>` : '';
    return `<div class="note-item"><div class="note-meta"><span class="ref" title="Quote this to ask about the note">${esc(n.ref)}</span> <b>${esc(who)}</b> · ${esc(fmtWhen(n.at))}${esc(old)}</div>
      ${n.text ? `<p>${esc(n.text)}</p>` : ''}${imgs ? `<div class="thumbs">${imgs}</div>` : ''}${where}${retry}</div>`;
  }

  function formHtml(v) {
    const vid = v.id, p = S.pending[vid] || [];
    const blocked = p.some((it) => !it.ok);
    const needName = MODE === 'owners';
    return `<form class="note-form" data-form="${vid}">
      ${needName ? `<label for="n-${vid}">Your name</label><input type="text" id="n-${vid}" class="name-in" value="${esc(S.name)}" autocomplete="name" placeholder="So we know who to ask" maxlength="60">` : ''}
      <label for="t-${vid}">What looks wrong? Say when in the video, if you can.</label>
      <textarea id="t-${vid}" maxlength="4000" placeholder="At 0:31 the caption covers the tab it is talking about"></textarea>
      <div class="drop" data-drop="${vid}"><label class="file-btn" for="f-${vid}">Add screenshots</label><input type="file" id="f-${vid}" accept="image/*" multiple><span class="hint">or drop them here · up to 6</span></div>
      ${p.length ? `<div class="checks">${p.map((it, i) => `<div class="check${it.results.some((r) => r[0] === 'bad') ? ' warn' : ''}">
        <button type="button" class="check-img" data-zoom="${vid}:${i}" aria-label="Switch between the small preview and the full size"><img src="${it.zoom ? it.full : it.preview}" alt="Screenshot ${i + 1}, ${it.zoom ? 'full size' : 'small preview'}"></button>
        <div class="check-body"><div class="check-h">Screenshot ${i + 1} · ${it.ow}×${it.oh}, saved at ${it.w}×${it.h}</div>
          <ul class="check-list">${it.results.map((r) => `<li class="${r[0]}">${esc(r[1])}</li>`).join('')}</ul>
          <p class="hint">${it.zoom ? 'Showing the full size. Click the picture for the small preview.' : 'Showing the small preview, which is what stays on this page. Click it for the full size.'}</p>
          <label class="confirm"><input type="checkbox" data-ok="${vid}:${i}" ${it.ok ? 'checked' : ''}> I can read what matters in this picture</label>
          <button type="button" class="link-btn" data-remove="${vid}:${i}">Remove</button></div></div>`).join('')}</div>` : ''}
      <div class="form-row"><button type="submit" class="btn" ${blocked || S.busy[vid] ? 'disabled' : ''}>${S.busy[vid] ? esc(S.busy[vid]) : 'Save note'}</button>
        <span class="hint">${blocked ? 'Tick “I can read what matters” on each picture, or remove it, first.' : MODE === 'owners' ? 'Saving a note marks the video “Something looks wrong”. Everyone who opens this page sees it.' : 'Saving a note marks the video “Needs a fix”.'}</span></div>
    </form>`;
  }

  function ownersCard(v, companion) {
    const o = ownersState(v), notes = notesFor(v.id, 'owners');
    const cls = o.state === 'approved' ? ' is-yes' : o.state === 'wrong' ? ' is-wrong' : '';
    const pill = o.state === 'approved' ? '<span class="pill yes">Looks right</span>' : o.state === 'wrong' ? '<span class="pill wrong">Something looks wrong</span>' : '<span class="pill open">Not reviewed</span>';
    const banner = v.updateComing ? '<p class="banner">A new version of this video is being checked. It will replace this one here, on the same link.</p>'
      : o.recheck ? '<p class="banner">This video was recorded again after your note. Please watch it once more and say whether it is fixed.</p>'
      : o.updated ? '<p class="banner quiet">Recorded again since you said it looks right. Watching it again is optional.</p>' : '';
    const showForm = S.open[v.id] || (o.state === 'wrong' && !notes.length);
    return `<article class="card vcard${cls}${companion ? ' companion' : ''}" id="v-${v.id}">
      <div class="card-h"><span class="card-n">${v.id}${v.length ? ' · ' + esc(v.length) : ''}</span>${companion ? '<span class="sub">What else can happen</span>' : ''}<span class="state">${pill}</span></div>
      <div class="card-t"><h3>${esc(v.title)}</h3></div>
      <div class="card-b"><p class="about">${esc(v.about)}</p>${banner}</div>
      <div class="card-f"><div class="act">
        <a class="btn quiet watch" href="${esc(v.driveUrl)}" target="_blank" rel="noopener">${driveIcon}Watch the video</a>
        <button type="button" class="btn yes" data-status="approved" data-vid="${v.id}" aria-pressed="${o.state === 'approved'}">Looks right</button>
        <button type="button" class="btn wrong" data-status="wrong" data-vid="${v.id}" aria-pressed="${o.state === 'wrong' || !!S.open[v.id]}">Something looks wrong</button>
        ${notes.length && !showForm ? `<button type="button" class="link-btn" data-add="${v.id}">Add a note</button>` : ''}
      </div>
      ${notes.length || showForm ? `<div class="notes">${notes.map(noteHtml).join('')}${notes.length ? '<p class="hint">To ask about a note, quote its reference, for example ' + esc(notes[0].ref) + '.</p>' : ''}${showForm ? formHtml(v) : ''}</div>` : ''}
      </div></article>`;
  }

  function jacobCard(v) {
    const j = jacobState(v), o = ownersState(v);
    const onPage = v.owners;
    let pill = '<span class="pill open">Not reviewed</span>';
    if (j === 'approved') pill = onPage && onPage.commit === v.commit ? '<span class="pill sent">With the owners</span>' : '<span class="pill yes">Approved · not sent</span>';
    if (j === 'fix') pill = '<span class="pill wrong">Needs a fix</span>';
    const r = S.jacob[v.id];
    const reset = r && r.status && r.commit !== v.commit ? `<p class="banner">Recorded again (${esc(v.commit)}). You ${r.status === 'approved' ? 'approved' : 'flagged'} ${esc(r.commit)}; this recording needs your look.</p>` : '';
    const ownersLine = onPage ? `Owners have ${esc(onPage.commit)}${onPage.updateComing ? ' (update waiting on you)' : ''}: ${o.state === 'approved' ? 'looks right' : o.state === 'wrong' ? 'something looks wrong' : o.recheck ? 'asked to check again' : 'not answered'}` : 'Not on the owners\' page';
    const ownerNotes = notesFor(v.id, 'owners'), myNotes = notesFor(v.id, 'jacob');
    const showForm = S.open[v.id] || (j === 'fix' && !myNotes.length);
    return `<article class="card vcard${j === 'approved' ? ' is-yes' : j === 'fix' ? ' is-wrong' : ''}" id="v-${v.id}">
      <div class="card-h"><span class="card-n">${v.id}${v.length ? ' · ' + esc(v.length) : ''}</span>${v.companionOf ? `<span class="sub">Companion of ${esc(v.companionOf)}</span>` : ''}<span class="state">${pill}</span></div>
      <div class="card-t"><h3>${esc(v.title)}</h3></div>
      <div class="card-b"><p class="about">${esc(v.about)}</p>
        <p class="facts"><span>${esc(ROLE[v.role] || v.role)}</span><span class="mono">${esc(v.file)}</span><span class="mono">recording ${esc(v.commit)} · ${esc(fmtDay(v.recordedAt))}</span><span>${ownersLine}</span></p>${reset}</div>
      <div class="card-f"><div class="act">
        <a class="btn quiet watch" href="${esc(v.driveUrl)}" target="_blank" rel="noopener">${driveIcon}Watch this recording</a>
        <button type="button" class="btn yes" data-status="approved" data-vid="${v.id}" aria-pressed="${j === 'approved'}">Approve for the owners</button>
        <button type="button" class="btn wrong" data-status="fix" data-vid="${v.id}" aria-pressed="${j === 'fix' || !!S.open[v.id]}">Needs a fix</button>
        ${myNotes.length && !showForm ? `<button type="button" class="link-btn" data-add="${v.id}">Add a note</button>` : ''}
        ${j !== 'open' ? `<button type="button" class="link-btn" data-status="" data-vid="${v.id}">Clear</button>` : ''}
      </div>
      ${ownerNotes.length ? `<div class="notes owners-notes"><div class="notes-h">The owners' notes</div>${ownerNotes.map(noteHtml).join('')}</div>` : ''}
      ${myNotes.length || showForm ? `<div class="notes"><div class="notes-h">Your notes</div>${myNotes.map(noteHtml).join('')}${showForm ? formHtml(v) : ''}</div>` : ''}
      </div></article>`;
  }

  const FILTERS = MODE === 'jacob'
    ? [['all', 'All'], ['open', 'Not reviewed'], ['ready', 'Approved, not sent'], ['fix', 'Needs a fix'], ['sent', 'With the owners'], ['owner-notes', 'Owners flagged']]
    : [['all', 'All'], ['open', 'Not reviewed'], ['approved', 'Looks right'], ['wrong', 'Something looks wrong']];
  function passes(v) {
    const f = S.filter;
    if (f === 'all') return true;
    if (MODE === 'jacob') {
      const j = jacobState(v), sent = v.owners && v.owners.commit === v.commit;
      return (f === 'open' && j === 'open') || (f === 'ready' && j === 'approved' && !sent) || (f === 'fix' && j === 'fix') || (f === 'sent' && !!v.owners) || (f === 'owner-notes' && ownersState(v).state === 'wrong');
    }
    return ownersState(v).state === f;
  }

  function stats() {
    if (MODE === 'jacob') {
      const n = (fn) => S.videos.filter(fn).length;
      return [['Recorded', S.videos.length], ['Not reviewed', n((v) => jacobState(v) === 'open')], ['Approved, not sent', n((v) => jacobState(v) === 'approved' && !(v.owners && v.owners.commit === v.commit))],
        ['With the owners', n((v) => !!v.owners)], ['Owners flagged', n((v) => ownersState(v).state === 'wrong')]];
    }
    const n = (st) => S.videos.filter((v) => ownersState(v).state === st).length;
    return [['Ready for you', S.videos.length], ['Looks right', n('approved')], ['With notes', n('wrong')], ['Still being checked', S.waiting]];
  }

  function render() {
    const statsHtml = stats().map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`).join('');
    $('#stats').innerHTML = statsHtml;
    $('#updated').textContent = S.updated ? 'Updated ' + fmtDay(S.updated) : '';
    const list = S.videos.filter(passes);
    let body = '';
    if (S.error) body += `<p class="sent err" role="alert">${esc(S.error)}</p>`;
    if (MODE === 'jacob') {
      const ready = S.videos.filter((v) => jacobState(v) === 'approved' && !(v.owners && v.owners.commit === v.commit)).length;
      if (ready) body += `<p class="sent">${ready} approved, not yet with the owners. They reach the owners' page the next time the update-documentation sync and publish run (<code>/wrap</code> runs it).</p>`;
    }
    body += `<div class="chips" role="group" aria-label="Show">${FILTERS.map(([k, label]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${S.filter === k}">${label}</button>`).join('')}</div>`;
    if (!S.videos.length) {
      body += `<p class="empty">${MODE === 'owners' ? 'No videos are ready yet. They appear here once they have been checked.' : 'No recordings listed yet. The publish step writes this list from the recorder.'}</p>`;
    } else if (!list.length) {
      body += '<p class="empty">Nothing here with this filter.</p>';
    } else if (MODE === 'owners') {
      // A "what else can happen" video sits under its main video when both are here.
      const ids = new Set(list.map((v) => v.id));
      for (const v of list) {
        if (v.companionOf && ids.has(v.companionOf)) continue;
        body += ownersCard(v, false);
        for (const c of list.filter((x) => x.companionOf === v.id)) body += ownersCard(c, true);
      }
    } else {
      body += list.map(jacobCard).join('');
    }
    if (MODE === 'owners' && S.waiting) body += `<p class="empty">${S.waiting} more video${S.waiting === 1 ? ' is' : 's are'} being checked and will appear here when ready.</p>`;
    app.innerHTML = body;
  }

  function scrollToHash() {
    const id = location.hash.slice(1);
    if (!/^v-\d{2}$/.test(id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }

  // ---- actions ---------------------------------------------------------------------------------
  async function setStatus(vid, status) {
    const v = byId(vid);
    const current = MODE === 'jacob' ? jacobState(v) : ownersState(v).state;
    const flag = MODE === 'jacob' ? 'fix' : 'wrong';
    if (status === flag && current === flag && notesFor(vid, side).length) { S.open[vid] = true; render(); return; }
    const next = current === status && status ? '' : status;
    if (status === (MODE === 'jacob' ? 'fix' : 'wrong') && current !== status) S.open[vid] = true;
    try {
      const saved = await call({ action: 'status', side, vid, status: next, commit: v.commit, by: S.name });
      (MODE === 'jacob' ? S.jacob : S.owners)[vid] = saved;
      S.error = '';
    } catch (e) { S.error = explain(e); }
    keepText(vid, render);
  }

  async function uploadFull(ref, items) {
    const left = [];
    for (const it of items) {
      try { await call({ action: 'image', side, ref, i: it.i, data: it.data }); } catch (e) { left.push(it); }
    }
    if (left.length) S.unsent[ref] = left; else delete S.unsent[ref];
  }

  async function saveNote(vid) {
    const v = byId(vid);
    const ta = $(`#t-${vid}`), nameIn = $(`#n-${vid}`);
    const text = (ta && ta.value || '').trim();
    const items = S.pending[vid] || [];
    if (MODE === 'owners') {
      const name = (nameIn && nameIn.value || '').trim();
      if (!name) { S.error = 'Add your name before saving, so we know who to ask.'; keepText(vid, render); $(`#n-${vid}`) && $(`#n-${vid}`).focus(); return; }
      S.name = name; store.set('videos-name', name);
    }
    if (!text && !items.length) { S.error = 'Write what looks wrong, or add a screenshot, before saving.'; keepText(vid, render); return; }
    if (items.some((it) => !it.ok)) return;
    S.busy[vid] = 'Saving…'; S.error = ''; keepText(vid, render);
    try {
      const note = await call({ action: 'note', side, vid, text, commit: v.commit, by: S.name, images: items.map((it) => ({ preview: it.preview, w: it.w, h: it.h })) });
      S.notes.push(note);
      const fulls = items.map((it, k) => ({ i: k + 1, data: it.full.replace(/^data:image\/jpeg;base64,/, '') }));
      if (fulls.length) { S.busy[vid] = `Uploading ${fulls.length} screenshot${fulls.length === 1 ? '' : 's'}…`; render(); await uploadFull(note.ref, fulls); }
      const flagged = MODE === 'jacob' ? 'fix' : 'wrong';
      const cur = MODE === 'jacob' ? jacobState(v) : ownersState(v).state;
      if (cur !== flagged) (MODE === 'jacob' ? S.jacob : S.owners)[vid] = await call({ action: 'status', side, vid, status: flagged, commit: v.commit, by: S.name });
      delete S.pending[vid]; S.open[vid] = false;
      const fresh = await call(null); S.notes = fresh.notes;
    } catch (e) {
      S.error = explain(e);
    }
    delete S.busy[vid];
    render();
    const el = $(`#v-${vid}`); if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function explain(e) {
    if (e.status === 401) {
      if (MODE === 'jacob') { S.reviewKey = ''; store.set('videos-review-key', ''); showKeyPrompt(e.message); return 'The passphrase was not accepted.'; }
      return 'This page needs the passphrase you were given. Reload the page and enter it.';
    }
    if (e.status === 413) return 'A screenshot was too large to send. Try a smaller one.';
    return `Not saved: ${e.message}. Check your connection and try again; nothing you wrote is lost until you leave the page.`;
  }

  app.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.add) { S.open[t.dataset.add] = true; render(); const ta = $(`#t-${t.dataset.add}`); if (ta) ta.focus(); return; }
    if (t.dataset.filter) { S.filter = t.dataset.filter; store.set('videos-filter-' + MODE, S.filter); render(); return; }
    if (t.dataset.status !== undefined && t.dataset.vid) { setStatus(t.dataset.vid, t.dataset.status); return; }
    if (t.dataset.zoom || t.dataset.remove) {
      const [vid, i] = (t.dataset.zoom || t.dataset.remove).split(':');
      const list = S.pending[vid] || [];
      if (t.dataset.zoom && list[+i]) list[+i].zoom = !list[+i].zoom;
      if (t.dataset.remove) list.splice(+i, 1);
      keepText(vid, render); return;
    }
    if (t.dataset.retry) { const ref = t.dataset.retry; uploadFull(ref, S.unsent[ref] || []).then(async () => { const fresh = await call(null); S.notes = fresh.notes; render(); }); }
  });
  app.addEventListener('submit', (ev) => { const f = ev.target.closest('form[data-form]'); if (!f) return; ev.preventDefault(); saveNote(f.dataset.form); });
  app.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.ok) { const [vid, i] = t.dataset.ok.split(':'); const it = (S.pending[vid] || [])[+i]; if (it) { it.ok = t.checked; keepText(vid, render); } return; }
    if (t.type === 'file') { const vid = t.closest('[data-drop]').dataset.drop; addFiles(vid, t.files); t.value = ''; }
    if (t.classList.contains('name-in')) { S.name = t.value.trim(); store.set('videos-name', S.name); }
  });
  app.addEventListener('dragover', (ev) => { const d = ev.target.closest('.drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
  app.addEventListener('dragleave', (ev) => { const d = ev.target.closest('.drop'); if (d) d.classList.remove('over'); });
  app.addEventListener('drop', (ev) => { const d = ev.target.closest('.drop'); if (d) { ev.preventDefault(); d.classList.remove('over'); addFiles(d.dataset.drop, ev.dataTransfer.files); } });
  window.addEventListener('beforeunload', (ev) => { if (Object.values(S.pending).some((l) => l.length) || Object.keys(S.unsent).length) { ev.preventDefault(); ev.returnValue = ''; } });

  // ---- passphrase (Jacob's page) ---------------------------------------------------------------
  function showKeyPrompt(msg) {
    const box = $('#key-box'); if (!box) return;
    box.hidden = false;
    $('#key-msg').textContent = msg && msg !== 'unauthorized' ? msg : '';
    $('#key-in').focus();
  }
  const keyForm = $('#key-form');
  if (keyForm) keyForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    S.reviewKey = $('#key-in').value.trim(); store.set('videos-review-key', S.reviewKey);
    $('#key-box').hidden = true; load();
  });

  // ---- load ------------------------------------------------------------------------------------
  async function load() {
    try {
      const listRes = await fetch(MODE === 'jacob' ? '/videos/review/all.json' : '/videos/data.json', { cache: 'no-cache' });
      const list = await listRes.json();
      S.videos = list.videos || []; S.updated = list.updated || ''; S.waiting = list.waiting || 0;
    } catch (e) {
      S.error = 'The list of videos could not be loaded. Reload the page to try again.';
    }
    if (MODE === 'jacob' && !S.reviewKey) { render(); showKeyPrompt(); return; }
    try {
      const data = await call(null);
      S.owners = data.owners || {}; S.jacob = data.jacob || {}; S.notes = data.notes || [];
    } catch (e) {
      S.error = explain(e);
    }
    render();
    scrollToHash();
  }
  window.addEventListener('hashchange', scrollToHash);
  load();
})();
