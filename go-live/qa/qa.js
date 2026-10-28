/* HOAhx · Hands-on checks (/qa). Reads the cards from /qa/data.json (written by
   scripts/publish-qa.mjs) and keeps runs, results, screenshots and the sent summary in the
   shared store at /api/qa (netlify/functions/qa.js). The page is open: no passphrase
   (Jacob, 2026-10-09 and 2026-10-27). The sign-in details are never served here. */
(function () {
  'use strict';
  var API = '/api/qa';
  var OUTCOMES = [['pass', 'Pass'], ['fail', 'Fail'], ['blocked', 'Blocked'], ['not-provable', 'Not provable']];
  var LABEL = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', 'not-provable': 'Not provable', '': 'Not run' };
  var NEEDS_NOTES = { fail: 1, blocked: 1, 'not-provable': 1 };
  var MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  var SHOT_MAX = Math.floor(2.4 * 1024 * 1024);
  var LS_RUN = 'hoahx-qa-run', LS_TESTER = 'hoahx-qa-tester';

  var data = null, cast = {}, run = null, results = {}, submission = null, runs = [];
  var shotCache = {};

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* private window */ } }
  function say(el, text, kind) { el.textContent = text || ''; el.className = 'line' + (kind ? ' ' + kind : ''); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function when(iso) { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } }

  function api(method, query, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API + (query ? '?' + query : ''), opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('The store answered ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ── load ──────────────────────────────────────────────────────────────
  fetch('/qa/data.json', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('The checks could not be loaded (' + r.status + ').');
    return r.json();
  }).then(function (d) {
    data = d;
    (d.cast || []).forEach(function (x) { cast[x.handle] = x; });
    renderHead(); renderCast(); setupRunForm(); setupFilters(); renderCards();
    return api('GET', 'status=1').then(function (s) {
      if (s.keySet) banner('This page now asks for a passphrase on the store, so results cannot be saved from here. Tell Jacob.', true);
      return loadRuns();
    }).catch(function () { banner('The results store could not be reached: you can read the checks, but results will not save. Try again in a minute.', true); });
  }).catch(function (e) { $('groups').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });

  function banner(text, bad) { var b = $('banner'); b.textContent = text; b.className = 'banner' + (bad ? ' err' : ''); b.hidden = false; }

  function renderHead() {
    $('title').textContent = data.title || 'Hands-on checks';
    $('lede').textContent = data.lede || '';
    var mins = data.cards.reduce(function (n, c) { return n + (c.minutes || 0); }, 0);
    var env = data.environments.staging;
    var rows = [['Checks', data.cards.length + ' (about ' + Math.round(mins / 60 * 10) / 10 + ' hours)'], ['Version', data.build], ['Published', when(data.generated)]];
    $('meta').innerHTML = rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
      (env && env.url ? '<div><dt>Test site</dt><dd><a href="' + esc(env.url) + '" target="_blank" rel="noopener">' + esc(env.url.replace('https://', '')) + '</a></dd></div>' : '');
    document.title = data.title || 'HOAhx · Hands-on checks';
  }

  function renderCast() {
    var list = data.cast || [];
    $('cast-count').textContent = list.length;
    $('cast').className = 'cast';
    $('cast').innerHTML = list.map(personHtml).join('');
  }
  function personHtml(x) {
    return '<div class="person"><b>' + esc(x.name) + '</b><span class="role">' + esc(x.roleLabel) + ' · ' + esc(x.where) + '</span>' +
      (x.opening ? '<div class="small">' + esc(x.opening) + '</div>' : '') +
      (x.twoStep ? '<div class="small">Asks for a text code at sign-in.</div>' : '') + '</div>';
  }

  // ── the run ───────────────────────────────────────────────────────────
  function setupRunForm() {
    var envSel = $('run-env');
    envSel.innerHTML = Object.keys(data.environments).filter(function (k) { return data.environments[k].url; })
      .map(function (k) { return '<option value="' + esc(k) + '">' + esc(data.environments[k].label) + '</option>'; }).join('');
    var scope = '<option value="all:">Every check</option>' +
      data.features.map(function (f) { return '<option value="feature:' + esc(f.id) + '">Area: ' + esc(f.title) + '</option>'; }).join('') +
      uniq(data.cards.map(function (c) { return c.milestone; })).map(function (m) { return '<option value="milestone:' + esc(m) + '">Milestone ' + esc(m) + '</option>'; }).join('');
    $('run-scope').innerHTML = scope;
    $('run-date').value = today();
    $('run-build').value = data.build || '';
    $('run-tester').value = lsGet(LS_TESTER);
    $('run-slug').addEventListener('input', previewId);
    $('run-date').addEventListener('input', previewId);
    previewId();
    $('run-pick').addEventListener('change', function () { var id = this.value; if (id) openRun(id); else newRun(); });
    $('run-form').addEventListener('submit', saveRun);
    $('send').addEventListener('click', sendRun);
  }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }).sort(); }
  function slug() { return $('run-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
  function previewId() { $('run-id-preview').textContent = ($('run-date').value || 'YYYY-MM-DD') + '-' + (slug() || 'short-name'); }

  function loadRuns() {
    return api('GET', 'runs=1').then(function (j) {
      runs = j.runs || [];
      $('run-pick').innerHTML = '<option value="">Start a new run</option>' + runs.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.id) + ' · ' + esc(r.tester) + '</option>';
      }).join('');
      var last = lsGet(LS_RUN);
      if (last && runs.some(function (r) { return r.id === last; })) { $('run-pick').value = last; return openRun(last); }
    });
  }

  function openRun(id) {
    say($('run-status'), 'Opening ' + id + '…');
    return api('GET', 'run=' + encodeURIComponent(id)).then(function (j) {
      run = j.run; results = j.results || {}; submission = j.submission;
      lsSet(LS_RUN, run.id);
      $('f-date').hidden = true; $('f-slug').hidden = true; $('f-fixed').hidden = false;
      $('run-id-fixed').textContent = run.id;
      $('run-env').value = run.env; $('run-build').value = run.build; $('run-reset').value = run.seedReset;
      $('run-tester').value = run.tester; $('run-device').value = run.device;
      $('run-scope').value = run.scope.type + ':' + (run.scope.value || '');
      $('run-save').textContent = 'Save changes to this run';
      say($('run-status'), 'You are recording into ' + run.id + '.', 'ok');
      renderCards(); renderSummary();
    }).catch(function (e) { say($('run-status'), e.message, 'err'); });
  }

  function newRun() {
    run = null; results = {}; submission = null; lsSet(LS_RUN, '');
    $('f-date').hidden = false; $('f-slug').hidden = false; $('f-fixed').hidden = true;
    $('run-build').value = data.build || ''; $('run-reset').value = ''; $('run-device').value = '';
    $('run-scope').value = 'all:'; $('run-save').textContent = 'Start this run';
    say($('run-status'), ''); renderCards(); renderSummary();
  }

  function saveRun(ev) {
    ev.preventDefault();
    var id = run ? run.id : ($('run-date').value + '-' + slug());
    var tester = $('run-tester').value.trim();
    $('f-slug').classList.toggle('bad', !run && !slug());
    if (!run && (!$('run-date').value || !slug())) return say($('run-status'), 'Give the run a date and a short name.', 'err');
    if (!tester) return say($('run-status'), 'Add your name.', 'err');
    if (!run && runs.some(function (r) { return r.id === id; })) return say($('run-status'), 'A run called ' + id + ' already exists: pick it under "Run", or choose another short name.', 'err');
    var sc = $('run-scope').value.split(':');
    var body = { kind: 'run', run: { id: id, env: $('run-env').value, build: $('run-build').value.trim(), seedReset: $('run-reset').value.trim(), tester: tester, device: $('run-device').value.trim(), scope: { type: sc[0], value: sc[1] || '' } } };
    $('run-save').disabled = true; say($('run-status'), 'Saving…');
    api('POST', '', body).then(function () {
      lsSet(LS_TESTER, tester);
      return loadRuns().then(function () { $('run-pick').value = id; return openRun(id); });
    }).catch(function (e) { say($('run-status'), e.message, 'err'); })
      .then(function () { $('run-save').disabled = false; });
  }

  function inScope(c) {
    if (!run || run.scope.type === 'all') return true;
    return run.scope.type === 'feature' ? c.feature === run.scope.value : c.milestone === run.scope.value;
  }

  // ── filters and cards ─────────────────────────────────────────────────
  var filters = { feature: '', role: '', device: '', milestone: '', result: '' };
  var DEVICE = { any: 'Any device', desktop: 'A computer', phone: 'A phone', iphone: 'An iPhone', android: 'An Android phone', 'two-devices': 'Two devices' };

  function setupFilters() {
    var opt = function (v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; };
    $('flt-feature').innerHTML = opt('', 'Every area') + data.features.map(function (f) { return opt(f.id, f.title); }).join('');
    var roles = uniq([].concat.apply([], data.cards.map(function (c) { return (c.accounts || []).map(function (h) { return cast[h] ? cast[h].roleLabel : ''; }); })));
    $('flt-role').innerHTML = opt('', 'Everyone') + roles.map(function (r) { return opt(r, r); }).join('');
    $('flt-device').innerHTML = opt('', 'Any') + uniq(data.cards.map(function (c) { return c.device; })).map(function (d) { return opt(d, DEVICE[d] || d); }).join('');
    $('flt-milestone').innerHTML = opt('', 'Every milestone') + uniq(data.cards.map(function (c) { return c.milestone; })).map(function (m) { return opt(m, m); }).join('');
    $('flt-result').innerHTML = opt('', 'Any') + opt('none', 'Not run yet') + OUTCOMES.map(function (o) { return opt(o[0], o[1]); }).join('');
    document.querySelectorAll('[data-filter]').forEach(function (el) {
      el.addEventListener('change', function () { filters[el.getAttribute('data-filter')] = el.value; renderCards(); });
    });
  }

  function visible(c) {
    if (!inScope(c)) return false;
    if (filters.feature && c.feature !== filters.feature) return false;
    if (filters.device && c.device !== filters.device) return false;
    if (filters.milestone && c.milestone !== filters.milestone) return false;
    if (filters.role && !(c.accounts || []).some(function (h) { return cast[h] && cast[h].roleLabel === filters.role; })) return false;
    var out = results[c.id] ? results[c.id].outcome : '';
    if (filters.result === 'none' && out) return false;
    if (filters.result && filters.result !== 'none' && out !== filters.result) return false;
    return true;
  }

  function renderCards() {
    if (!data) return;
    var open = {};
    document.querySelectorAll('.card[open]').forEach(function (d) { open[d.id] = 1; });
    var shown = data.cards.filter(visible);
    var mins = shown.reduce(function (n, c) { return n + (c.minutes || 0); }, 0);
    $('count').textContent = 'Showing ' + shown.length + ' of ' + data.cards.length + ' checks · about ' + mins + ' minutes' + (run && run.scope.type !== 'all' ? ' · limited to this run’s checks' : '');
    var html = '<ul class="always" aria-label="On every check">' + (data.always || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>';
    data.features.forEach(function (f) {
      var cs = shown.filter(function (c) { return c.feature === f.id; });
      if (!cs.length) return;
      html += '<div class="group"><h3>' + esc(f.title) + '</h3><p class="blurb">' + esc(f.blurb) + '</p>' + cs.map(function (c) { return cardHtml(c, open['card-' + c.id]); }).join('') + '</div>';
    });
    if (!shown.length) html += '<p class="empty">No check matches these choices.</p>';
    $('groups').innerHTML = html;
    shown.forEach(function (c) { wireCard(c); });
    var done = data.cards.filter(function (c) { return inScope(c) && results[c.id] && results[c.id].outcome; }).length;
    var total = data.cards.filter(inScope).length;
    $('nav-progress').textContent = run ? (run.id + ': ' + done + ' of ' + total + ' recorded') : 'No run started';
  }

  function cardHtml(c, isOpen) {
    var r = results[c.id] || {};
    var env = data.environments[c.env] || {};
    var url = env.url ? env.url + c.start : '';
    var people = (c.accounts || []).map(function (h) { return cast[h] ? personHtml(cast[h]) : '<div class="person"><b>' + esc(h) + '</b></div>'; }).join('');
    var b = '<details class="card" id="card-' + esc(c.id) + '"' + (isOpen ? ' open' : '') + '><summary>' +
      '<span class="id">' + esc(c.id) + '</span><span class="t">' + esc(c.title) + '</span>' +
      '<span class="badge ' + esc(r.outcome || '') + '">' + esc(LABEL[r.outcome || '']) + '</span>' +
      '<span class="sub">' + esc(c.minutes) + ' min · ' + esc(DEVICE[c.device] || c.device) + ' · ' + esc(data.categories[c.whyManual] || '') + (c.milestone ? ' · ' + esc(c.milestone) : '') + '</span>' +
      '</summary><div class="body">';
    b += '<h4>Why a person checks this</h4><p>' + esc(c.whyManualNote) + '</p>';
    b += '<h4>Where to start</h4><p>' + esc(env.label || c.env) + ': ' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url.replace('https://', '')) + '</a>' : esc(c.start) + ' (the address is given at go / no-go)') + '</p>';
    if (people) b += '<h4>Sign in as</h4><div class="cast">' + people + '</div>';
    if (c.precondition) b += '<h4>Before you start</h4><p class="note">' + esc(c.precondition) + '</p>';
    b += '<h4>Steps</h4><ol class="steps">' + c.steps.map(function (s) { return '<li><div>' + esc(s.do) + '</div><div class="see">' + esc(s.see) + '</div></li>'; }).join('') + '</ol>';
    if (c.lookFor && c.lookFor.length) b += '<h4>Look for</h4><ul>' + c.lookFor.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (c.expectNotProvable) b += '<h4>If the test site cannot do it</h4><p class="note">' + esc(c.expectNotProvable) + '</p>';
    if (c.reset) b += '<h4>Afterwards</h4><p>' + esc(c.reset) + '</p>';
    b += resultHtml(c, r) + '</div></details>';
    return b;
  }

  function resultHtml(c, r) {
    if (!run) return '<div class="result"><p class="needs-run">To record a result, start or pick a run under <a href="#run">The run</a>.</p></div>';
    var n = 'o-' + c.id;
    return '<form class="result" data-card="' + esc(c.id) + '" novalidate>' +
      '<fieldset class="outcomes"><legend>Result</legend>' + OUTCOMES.map(function (o) {
        return '<label><input type="radio" name="' + n + '" value="' + o[0] + '"' + (r.outcome === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>';
      }).join('') + '</fieldset>' +
      '<div class="field"><label for="n-' + esc(c.id) + '">Notes</label><textarea class="input" id="n-' + esc(c.id) + '" maxlength="8000" placeholder="For Fail, Blocked or Not provable: what you did, what you saw, what you expected.">' + esc(r.notes || '') + '</textarea></div>' +
      '<div class="shots" data-shots="' + esc((r.shots || []).join(',')) + '"></div>' +
      '<div class="field"><label for="s-' + esc(c.id) + '">Add screenshots (up to 5)</label><input class="input" id="s-' + esc(c.id) + '" type="file" accept="image/*" multiple></div>' +
      '<div class="act"><button class="btn" type="submit">Save result</button><span class="line" role="status" aria-live="polite">' + (r.updatedAt ? 'Saved ' + esc(when(r.updatedAt)) : '') + '</span></div></form>';
  }

  function wireCard(c) {
    var form = document.querySelector('form.result[data-card="' + c.id + '"]');
    if (!form) return;
    var box = form.querySelector('.shots');
    var shots = box.getAttribute('data-shots') ? box.getAttribute('data-shots').split(',') : [];
    var status = form.querySelector('.act .line');
    var drawShots = function () {
      box.innerHTML = '';
      shots.forEach(function (id) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.setAttribute('aria-label', 'Open screenshot');
        box.appendChild(btn);
        loadShot(id).then(function (src) { btn.innerHTML = '<img alt="Screenshot" src="' + src + '">'; btn.onclick = function () { $('viewer-img').src = src; $('viewer').showModal(); }; })
          .catch(function () { btn.textContent = 'Not found'; });
      });
    };
    drawShots();
    form.querySelector('input[type=file]').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      if (shots.length + files.length > 5) return say(status, 'At most 5 screenshots per check.', 'err');
      say(status, 'Uploading…');
      files.reduce(function (p, f) {
        return p.then(function () { return toImage(f); }).then(function (img) {
          return api('POST', '', { kind: 'shot', run: run.id, card: c.id, mime: img.mime, data: img.data });
        }).then(function (j) { shots.push(j.id); drawShots(); });
      }, Promise.resolve()).then(function () { say(status, 'Screenshots added. Press Save result to keep them with the result.'); })
        .catch(function (e) { say(status, e.message, 'err'); });
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var picked = form.querySelector('input[type=radio]:checked');
      var outcome = picked ? picked.value : '';
      var notes = form.querySelector('textarea').value;
      if (!outcome) return say(status, 'Choose a result first.', 'err');
      if (NEEDS_NOTES[outcome] && !notes.trim()) return say(status, LABEL[outcome] + ' needs a note: what you did, what you saw, what you expected.', 'err');
      say(status, 'Saving…');
      api('POST', '', { kind: 'result', run: run.id, card: c.id, outcome: outcome, notes: notes, shots: shots, tester: run.tester })
        .then(function (j) {
          results[c.id] = j.result;
          var badge = form.closest('.card').querySelector('summary .badge');
          badge.className = 'badge ' + outcome; badge.textContent = LABEL[outcome];
          say(status, 'Saved ' + when(j.result.updatedAt), 'ok');
          renderSummary();
          var done = data.cards.filter(function (x) { return inScope(x) && results[x.id] && results[x.id].outcome; }).length;
          $('nav-progress').textContent = run.id + ': ' + done + ' of ' + data.cards.filter(inScope).length + ' recorded';
        }).catch(function (e) { say(status, e.message, 'err'); });
    });
  }

  function loadShot(id) {
    if (!shotCache[id]) shotCache[id] = api('GET', 'shot=' + id).then(function (j) { return 'data:' + j.mime + ';base64,' + j.data; });
    return shotCache[id];
  }

  // A screenshot over the size limit, or in a format the store does not take, is redrawn as a JPEG.
  function toImage(file) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onerror = function () { reject(new Error('That file could not be read.')); };
      rd.onload = function () {
        var url = rd.result;
        if (MIMES.indexOf(file.type) >= 0 && file.size <= SHOT_MAX) return resolve({ mime: file.type, data: url.split(',')[1] });
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not an image this page can use.')); };
        img.onload = function () {
          var scale = Math.min(1, 2000 / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          var out = cv.toDataURL('image/jpeg', 0.85);
          resolve({ mime: 'image/jpeg', data: out.split(',')[1] });
        };
        img.src = url;
      };
      rd.readAsDataURL(file);
    });
  }

  // ── the summary ───────────────────────────────────────────────────────
  function renderSummary() {
    var body = $('summary-body');
    $('send').disabled = !run;
    if (!run) { body.innerHTML = '<p class="panel-p">Start or pick a run to see its summary.</p>'; $('sent').innerHTML = ''; return; }
    var cards = data.cards.filter(inScope);
    var by = { pass: [], fail: [], blocked: [], 'not-provable': [], '': [] };
    cards.forEach(function (c) { var r = results[c.id]; by[r && r.outcome || ''].push(c); });
    var html = '<div class="tally">' + OUTCOMES.map(function (o) { return '<span class="badge ' + o[0] + '">' + o[1] + ': ' + by[o[0]].length + '</span>'; }).join('') +
      '<span class="badge">Not run: ' + by[''].length + '</span></div>';
    var list = function (title, cs) {
      if (!cs.length) return '';
      return '<p><b>' + esc(title) + '</b></p><ul>' + cs.map(function (c) { return '<li>' + esc(c.id) + ' · ' + esc(c.title) + (results[c.id] && results[c.id].notes ? ': ' + esc(results[c.id].notes) : '') + '</li>'; }).join('') + '</ul>';
    };
    html += list('Failed', by.fail) + list('Blocked', by.blocked) + list('Not provable (never counted as a pass)', by['not-provable']);
    body.innerHTML = html;
    $('sent').innerHTML = submission ? '<p class="line ok">Last sent ' + esc(when(submission.updatedAt)) + '.</p>' : '';
  }

  function summaryText() {
    var lines = ['Run ' + run.id, 'Where: ' + ((data.environments[run.env] || {}).label || run.env), 'Version: ' + run.build, 'Test accounts reset: ' + (run.seedReset || 'not given'),
      'Tester: ' + run.tester, 'Device: ' + (run.device || 'not given'), 'Sent: ' + new Date().toISOString(), ''];
    data.cards.filter(inScope).forEach(function (c) {
      var r = results[c.id];
      lines.push(c.id + ' · ' + LABEL[r && r.outcome || ''] + ' · ' + c.title + (r && r.notes ? '\n    ' + r.notes.replace(/\n/g, '\n    ') : '') + (r && r.shots && r.shots.length ? '\n    screenshots: ' + r.shots.length : ''));
    });
    return lines.join('\n');
  }

  function sendRun() {
    if (!run) return;
    var btn = $('send'); btn.disabled = true;
    api('POST', '', { kind: 'submission', run: run.id, text: summaryText() })
      .then(function (j) { submission = j.submission; renderSummary(); })
      .catch(function (e) { $('sent').innerHTML = '<p class="line err">' + esc(e.message) + '</p>'; })
      .then(function () { btn.disabled = !run; });
  }
})();
