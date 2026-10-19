/* HOAhx · App Store listing review. Reads /app-review/data.json and the shared store at /api/app-review. */
(function () {
  'use strict';
  var S = { data: null, store: { answers: {}, shots: {}, files: [] }, who: '', editKey: '', open: {}, msg: {} };
  var API = '/api/app-review';
  var ls = {
    get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: fine */ } }
  };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function headers() { var h = { 'Content-Type': 'application/json' }; if (S.editKey) h['x-edit-key'] = S.editKey; return h; }
  function call(method, url, body) {
    return fetch(url, { method: method, headers: headers(), body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401) {
          var k = window.prompt('This page needs the passphrase you were given.');
          if (k) { S.editKey = k; ls.set('app-review-key', k); return call(method, url, body); }
          throw new Error('The passphrase was not accepted.');
        }
        if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
        return j;
      });
    });
  }
  function load() {
    return call('GET', API).then(function (j) { S.store = { answers: j.answers || {}, shots: j.shots || {}, files: j.files || [] }; });
  }
  function setMsg(k, text, err) { S.msg[k] = { text: text, err: !!err }; render(); }
  function msgNode(k) { var m = S.msg[k]; return el('div', { class: 'msg' + (m && m.err ? ' err' : ''), role: 'status', text: m ? m.text : '' }); }

  function save(action, body, key) {
    return call('POST', API, Object.assign({ action: action }, body)).then(function () { return load(); })
      .then(function () { setMsg(key, 'Saved.'); }).catch(function (e) { setMsg(key, e.message, true); });
  }
  function needName(key) { if (S.who) return false; setMsg(key, 'Choose your name at the top first.', true); return true; }

  function renderWho() {
    var box = document.getElementById('who-btns'); box.textContent = '';
    S.data.owners.forEach(function (o) {
      box.appendChild(el('button', { class: 'btn quiet', type: 'button', 'aria-pressed': S.who === o ? 'true' : 'false', text: o,
        onclick: function () { S.who = o; ls.set('app-review-who', o); render(); } }));
    });
  }

  function questionCard(q) {
    var key = q.id;
    var mine = S.store.answers[q.id + '.' + S.who] || {};
    var draft = S.open[key];
    var card = el('section', { class: 'card', id: q.id }, [
      el('div', { class: 'card-n', text: 'Question ' + parseInt(q.id.slice(1), 10) + ' of ' + S.data.questions.length }),
      el('h3', { text: q.t }),
      el('div', { class: 'rec' }, [el('b', { text: "Jacob's recommendation" }), q.rec]),
      el('p', { class: 'why', text: q.why })
    ]);
    if (q.show) card.appendChild(el('details', {}, [el('summary', { text: 'Show the full text' }), el('pre', { class: 'show', text: q.show })]));
    var act = el('div', { class: 'act' }, [
      el('button', { class: 'btn', type: 'button', 'aria-pressed': mine.v === 'agree' ? 'true' : 'false', text: 'Agree',
        onclick: function () { if (needName(key)) return; S.open[key] = false; save('answer', { q: q.id, who: S.who, v: mine.v === 'agree' ? '' : 'agree', n: '' }, key); } }),
      el('button', { class: 'btn quiet change', type: 'button', 'aria-pressed': (mine.v === 'change' || draft) ? 'true' : 'false', text: 'Change it',
        onclick: function () { if (needName(key)) return; S.open[key] = true; render(); } })
    ]);
    card.appendChild(el('div', { style: 'margin-top:12px' }, [act]));
    if (draft || mine.v === 'change') {
      var ta = el('textarea', { id: 'n-' + q.id, 'aria-label': 'What you would change it to', placeholder: 'What would you put instead?' });
      ta.value = S.open['t-' + key] != null ? S.open['t-' + key] : (mine.n || '');
      ta.addEventListener('input', function () { S.open['t-' + key] = ta.value; });
      card.appendChild(ta);
      card.appendChild(el('div', { class: 'act', style: 'margin-top:8px' }, [el('button', { class: 'btn', type: 'button', text: 'Save my change',
        onclick: function () { if (needName(key)) return; if (!ta.value.trim()) { setMsg(key, 'Say what you would change it to.', true); return; } S.open[key] = false; delete S.open['t-' + key]; save('answer', { q: q.id, who: S.who, v: 'change', n: ta.value }, key); } })]));
    }
    card.appendChild(msgNode(key));
    var list = el('div', { class: 'answers' });
    S.data.owners.forEach(function (o) {
      var a = S.store.answers[q.id + '.' + o];
      var label = a && a.v === 'agree' ? 'Agrees' : a && a.v === 'change' ? 'Changes it' : 'No answer yet';
      var cls = a && a.v ? a.v : 'none';
      var body = [el('span', { class: 'state ' + cls, text: label })];
      if (a && a.v === 'change' && a.n) body.push(el('div', { class: 'note', text: a.n }));
      list.appendChild(el('div', { class: 'ans' }, [el('span', { class: 'ans-who', text: o }), el('div', {}, body)]));
    });
    card.appendChild(list);
    return card;
  }

  function filesFor(slot) { return S.store.files.filter(function (f) { return f.slot === slot; }); }

  // Uploaded images, assembled once from the store's chunks and kept as object URLs by file id,
  // so a re-render never fetches them again.
  var IMG = {};
  function imageUrl(f) {
    if (IMG[f.id]) return IMG[f.id];
    var parts = [];
    var i = 0;
    IMG[f.id] = (function next() {
      if (i >= f.chunks) {
        var bytes = parts.map(function (d) { var s = atob(d), a = new Uint8Array(s.length); for (var k = 0; k < s.length; k++) a[k] = s.charCodeAt(k); return a; });
        return URL.createObjectURL(new Blob(bytes, { type: f.type }));
      }
      return call('GET', API + '?file=' + encodeURIComponent(f.id) + '&chunk=' + i).then(function (j) { parts.push(j.data); i++; return next(); });
    })();
    IMG[f.id].catch(function () { delete IMG[f.id]; });
    return IMG[f.id];
  }
  function when(at) {
    var d = new Date(at);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function thumb(f, title) {
    var img = el('img', { alt: f.name, loading: 'lazy', decoding: 'async' });
    var btn = el('button', { class: 'thumb', type: 'button', 'aria-label': 'View full size: ' + f.name, title: 'View full size',
      onclick: function () { openViewer(f, title); } }, [img]);
    imageUrl(f).then(function (u) { img.src = u; btn.classList.add('ready'); }, function () { btn.classList.add('failed'); img.alt = 'Could not load ' + f.name; });
    return el('figure', { class: 'shot' }, [btn, el('figcaption', {}, [el('b', { text: f.who }), ' · ' + f.name + (when(f.at) ? ' · ' + when(f.at) : '')])]);
  }

  // Full-size viewer: a native dialog (Esc closes it), the image at its full width, scrollable.
  var viewer = null;
  function openViewer(f, title) {
    if (!viewer) {
      viewer = el('dialog', { class: 'viewer', 'aria-label': 'Screenshot' });
      viewer.addEventListener('click', function (e) { if (e.target === viewer) viewer.close(); });
      document.body.appendChild(viewer);
    }
    viewer.textContent = '';
    var img = el('img', { alt: f.name });
    viewer.appendChild(el('div', { class: 'viewer-bar' }, [
      el('div', {}, [el('b', { text: title }), el('div', { class: 'viewer-sub', text: f.who + ' uploaded ' + f.name + (when(f.at) ? ' on ' + when(f.at) : '') })]),
      el('button', { class: 'btn quiet', type: 'button', text: 'Close', onclick: function () { viewer.close(); } })
    ]));
    viewer.appendChild(el('div', { class: 'viewer-img' }, [img]));
    imageUrl(f).then(function (u) { img.src = u; }, function (e) { img.alt = 'Could not load the image: ' + e.message; });
    if (viewer.showModal) viewer.showModal(); else viewer.setAttribute('open', '');
  }

  function slotCard(slot, title, cap, size) {
    var key = 'shot-' + slot;
    var mine = S.store.shots[slot + '.' + S.who] || {};
    var card = el('section', { class: 'card' }, [el('h3', { text: title })]);
    if (cap) card.appendChild(el('p', { class: 'why', text: 'Caption: ' + cap }));
    if (size) card.appendChild(el('p', { class: 'why', text: 'Size: ' + size + ' pixels, portrait.' }));
    var input = el('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': 'Upload an image for ' + title });
    input.addEventListener('change', function () { if (input.files[0]) upload(slot, input.files[0], key); });
    var act = el('div', { class: 'act', style: 'margin-top:10px' }, [
      el('button', { class: 'btn quiet', type: 'button', 'aria-pressed': mine.v === 'jacob' ? 'true' : 'false', text: 'Jacob provides this one',
        onclick: function () { if (needName(key)) return; save('shot', { slot: slot, who: S.who, v: mine.v === 'jacob' ? '' : 'jacob' }, key); } })
    ]);
    card.appendChild(act);
    card.appendChild(el('div', { style: 'margin-top:10px' }, [input]));
    card.appendChild(msgNode(key));
    var seen = el('div', { class: 'thumbs' });
    S.data.owners.forEach(function (o) {
      var s = S.store.shots[slot + '.' + o];
      if (s && s.v === 'jacob') seen.appendChild(el('span', { text: o + ': Jacob provides' }));
    });
    card.appendChild(seen);
    var mineFiles = filesFor(slot);
    if (mineFiles.length) {
      var gallery = el('div', { class: 'gallery' });
      mineFiles.forEach(function (f) { gallery.appendChild(thumb(f, title)); });
      card.insertBefore(gallery, card.children[1] || null);
    }
    return card;
  }

  function b64(buf) {
    var bin = '', bytes = new Uint8Array(buf), step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }
  function hex() { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  var CHUNK = 2.5 * 1024 * 1024;
  function upload(slot, file, key) {
    if (needName(key)) return;
    if (['image/png', 'image/jpeg'].indexOf(file.type) < 0) { setMsg(key, 'Use a PNG or a JPEG image.', true); return; }
    var chunks = Math.ceil(file.size / CHUNK);
    if (chunks > 10) { setMsg(key, 'That image is over 25 MB. Send it to Jacob instead.', true); return; }
    var id = hex(), i = 0;
    setMsg(key, 'Uploading…');
    (function next() {
      if (i >= chunks) {
        return call('POST', API, { action: 'file-done', id: id, who: S.who, slot: slot, name: file.name, type: file.type, size: file.size, chunks: chunks })
          .then(load).then(function () { setMsg(key, 'Uploaded ' + file.name + '.'); });
      }
      return file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer().then(function (buf) {
        return call('POST', API, { action: 'file-chunk', id: id, i: i, data: b64(buf) });
      }).then(function () { i++; setMsg(key, 'Uploading… ' + Math.round(i * 100 / chunks) + '%'); return next(); });
    })().catch(function (e) { setMsg(key, e.message, true); });
  }

  function render() {
    renderWho();
    var app = document.getElementById('app'); app.textContent = '';
    var d = S.data;
    app.appendChild(el('h2', { text: 'The questions' }));
    app.appendChild(el('p', { class: 'sub', text: "These are the App Store listing choices. Each one shows Jacob's recommendation. Choose Agree, or Change it and say what you would put instead." }));
    d.questions.forEach(function (q) { app.appendChild(questionCard(q)); });

    app.appendChild(el('h2', { text: 'Screenshots' }));
    app.appendChild(el('p', { class: 'sub', text: "These are the shots for the listing, in order. For each one, upload your own image (PNG or JPEG, at the size shown) or tick “Jacob provides this one”. The first three are what a person sees in search. They are taken from a practice community, never real homeowners." }));
    app.appendChild(el('h3', { text: 'iPhone (9 shots)', style: 'margin:18px 0 10px' }));
    var g1 = el('div', { class: 'grid' });
    d.shots.forEach(function (s) { if (s.iphone) g1.appendChild(slotCard('iphone-' + s.n, s.n + '. ' + s.t, s.cap, d.sizes.iphone)); });
    app.appendChild(g1);
    app.appendChild(el('h3', { text: 'iPad (5 shots)', style: 'margin:22px 0 10px' }));
    var g2 = el('div', { class: 'grid' });
    d.shots.forEach(function (s) { if (s.ipad) g2.appendChild(slotCard('ipad-' + s.n, s.n + '. ' + s.t, s.cap, d.sizes.ipad)); });
    app.appendChild(g2);
    app.appendChild(el('h3', { text: 'Anything else', style: 'margin:22px 0 10px' }));
    app.appendChild(slotCard('extra', 'Extra images', 'Any other image you would like us to consider.', ''));
  }

  function start() {
    S.who = ls.get('app-review-who'); S.editKey = ls.get('app-review-key');
    fetch('/app-review/data.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      S.data = d; if (d.owners.indexOf(S.who) < 0) S.who = '';
      return load();
    }).then(render).catch(function (e) {
      document.getElementById('app').textContent = 'The page could not load: ' + e.message + ' Reload to try again.';
    });
  }
  start();
})();
