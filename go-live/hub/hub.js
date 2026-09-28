/* HOAhx · Hub. Two lists, one page. /hub/data.json is the published list (the review pages and
   what is waiting on the owners; see scripts/publish-hub.mjs). /api/hub is what is in the shared
   Drive folder right now (netlify/functions/hub.js): people add a document by filing it there.
   The page draws the first at once and adds the second when it answers; if it does not answer,
   the page is the published list alone. Read-only: nothing is saved. Asset paths are absolute
   because the page is served at /hub with no trailing slash. */
(function () {
  'use strict';

  var KINDS = [['all', 'All'], ['page', 'Pages'], ['doc', 'Docs'], ['sheet', 'Sheets'], ['slides', 'Slides'], ['pdf', 'PDFs'], ['video', 'Videos'], ['folder', 'Folders'], ['file', 'Files']];
  var LABEL = { page: 'PAGE', doc: 'DOC', sheet: 'SHEET', slides: 'SLIDES', pdf: 'PDF', video: 'VIDEO', folder: 'FOLDER', file: 'FILE' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NEW_DAYS = 7;
  var NEW_MAX = 5;

  var main = document.getElementById('main');
  var rail = document.getElementById('rail');
  var kinds = document.getElementById('kinds');
  var search = document.getElementById('q');
  var state = { q: '', kind: 'all' };
  var data = null;
  var today = '';   // what "new this week" is counted from: the list's date, or the day Drive was read

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // A link to this site stays in the tab; anything else (Drive, the app) opens beside it.
  function link(cls, href) {
    var a = el('a', cls);
    a.href = href;
    var own = href.charAt(0) === '/' || href.indexOf(location.origin + '/') === 0 || href.indexOf('https://hoahx-requirements.netlify.app/') === 0;
    if (!own) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  function day(iso) { return Date.parse(iso + 'T00:00:00Z') / 86400000; }
  function shortDate(iso) {
    var p = iso.split('-');
    return MONTHS[+p[1] - 1] + ' ' + (+p[2]);
  }
  function isNew(row) { return !!row.date && day(today) - day(row.date) < NEW_DAYS; }

  function matches(row) {
    if (state.kind !== 'all' && row.k !== state.kind) return false;
    if (!state.q) return true;
    return (row.t + ' ' + row.d + ' ' + (row.by || '')).toLowerCase().indexOf(state.q) !== -1;
  }

  function drawRow(row) {
    var li = el('li');
    var a = link('row', row.href);
    a.appendChild(el('span', 'kind k-' + row.k, LABEL[row.k]));
    var t = el('span', 't', row.t);
    if (row.tag) t.appendChild(el('span', 'tag', row.tag));
    else if (isNew(row)) t.appendChild(el('span', 'tag new', 'New'));
    a.appendChild(t);
    if (row.d) a.appendChild(el('span', 'd', row.d));
    if (row.by || row.date) {
      var m = el('span', 'm');
      if (row.by) m.appendChild(el('span', '', 'Kept by ' + row.by));
      if (row.date) m.appendChild(el('span', '', 'Updated ' + shortDate(row.date)));
      a.appendChild(m);
    }
    li.appendChild(a);
    return li;
  }

  function freshRows() {
    var out = [];
    data.sections.forEach(function (s) {
      s.groups.forEach(function (g) {
        g.rows.forEach(function (r) { if (isNew(r)) out.push({ row: r, where: s.name + ' · ' + g.name }); });
      });
    });
    out.sort(function (a, b) { return a.row.date < b.row.date ? 1 : a.row.date > b.row.date ? -1 : 0; });
    return out.slice(0, NEW_MAX);
  }

  function drawNow() {
    var fresh = freshRows();
    if (!data.waiting.length && !fresh.length) return null;
    var wrap = el('section', 'now' + (data.waiting.length && fresh.length ? ' pair' : ''));
    wrap.id = 'now';
    if (data.waiting.length) {
      var need = el('div', 'panel need');
      need.appendChild(el('h2', '', 'Waiting on you'));
      var ul = el('ul');
      data.waiting.forEach(function (w) {
        var li = el('li');
        var a = link('need-row', w.href);
        var t = el('span', 't', w.t);
        if (w.due) t.appendChild(el('span', 'due', w.due));
        a.appendChild(t);
        a.appendChild(el('span', 'go', w.go));
        a.appendChild(el('span', 'd', w.d));
        li.appendChild(a);
        ul.appendChild(li);
      });
      need.appendChild(ul);
      wrap.appendChild(need);
    }
    if (fresh.length) {
      var panel = el('div', 'panel');
      panel.appendChild(el('h2', '', 'New this week'));
      var ul2 = el('ul');
      fresh.forEach(function (f) {
        var li = el('li');
        var a = link('new-row', f.row.href);
        a.appendChild(el('span', 'when', shortDate(f.row.date)));
        var t = el('span', 't', f.row.t);
        t.appendChild(el('small', '', f.where));
        a.appendChild(t);
        li.appendChild(a);
        ul2.appendChild(li);
      });
      panel.appendChild(ul2);
      wrap.appendChild(panel);
    }
    return wrap;
  }

  function jump(name, id, count) {
    var a = el('a', 'jump', name);
    a.href = '#' + id;
    a.appendChild(el('span', 'n', String(count)));
    return a;
  }

  function draw() {
    main.textContent = '';
    rail.textContent = '';
    var filtering = !!state.q || state.kind !== 'all';
    var shown = 0;

    if (!filtering) {
      var now = drawNow();
      if (now) {
        main.appendChild(now);
        if (data.waiting.length) rail.appendChild(jump('Waiting on you', 'now', data.waiting.length));
      }
    }

    data.sections.forEach(function (s) {
      var sec = el('section');
      sec.id = s.id;
      var head = el('div', 'sec-head');
      head.appendChild(el('h2', '', s.name));
      if (s.about) head.appendChild(el('p', '', s.about));
      if (s.folder) {
        var f = link('folder', s.folder);
        f.textContent = 'Open this folder in Drive';
        head.appendChild(f);
      }
      sec.appendChild(head);

      var groups = el('div', 'groups' + (s.columns === 2 ? ' two' : ''));
      var count = 0;
      s.groups.forEach(function (g) {
        var rows = g.rows.filter(matches);
        // A group with nothing in it yet is shown, so the owners see where a document will go.
        // While searching it is only noise.
        if (!rows.length && (filtering || g.rows.length)) return;
        count += rows.length;
        var box = el('div', 'group');
        var h = el('h3', '', g.name);
        h.appendChild(el('span', '', String(rows.length)));
        box.appendChild(h);
        if (rows.length) {
          var ul = el('ul', 'rows');
          rows.forEach(function (r) { ul.appendChild(drawRow(r)); });
          box.appendChild(ul);
        } else {
          box.appendChild(el('p', 'empty', 'Nothing here yet.'));
        }
        groups.appendChild(box);
      });
      sec.appendChild(groups);
      if (groups.children.length) main.appendChild(sec);
      shown += count;
      rail.appendChild(jump(s.name, s.id, count));
    });

    if (filtering && !shown) main.appendChild(el('p', 'none', 'Nothing matches. Clear the search or choose All.'));

    if (data.drive) {
      var p = el('p', 'drive');
      p.appendChild(document.createTextNode('All documents live in the shared '));
      var d = link('', data.drive);
      d.textContent = 'HOAhx Drive folder';
      p.appendChild(d);
      p.appendChild(document.createTextNode('.'));
      rail.appendChild(p);
    }
  }

  function driveId(href) {
    var m = /\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/.exec(href || '');
    return m ? m[1] : '';
  }
  function same(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

  // Adds what is in the Drive folder to the published list. A document already on the published
  // list keeps its published line, so nothing shows twice.
  function merge(live) {
    var have = {};
    function seen(href) { var id = driveId(href); return have[href] || (id && have[id]); }
    function mark(href) { have[href] = true; var id = driveId(href); if (id) have[id] = true; }
    data.sections.forEach(function (s) { s.groups.forEach(function (g) { g.rows.forEach(function (r) { mark(r.href); }); }); });
    (live.sections || []).forEach(function (ls) {
      if (!ls || typeof ls.name !== 'string' || !ls.name) return;
      var s = data.sections.filter(function (x) { return same(x.name, ls.name); })[0];
      if (!s) {
        s = { id: 's-' + (ls.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'more'), name: ls.name, about: '', folder: null, columns: 2, groups: [] };
        data.sections.push(s);
      }
      if (typeof ls.folder === 'string' && ls.folder.indexOf('https://drive.google.com/') === 0) s.folder = ls.folder;
      (ls.groups || []).forEach(function (lg) {
        if (!lg || typeof lg.name !== 'string' || !lg.name) return;
        var g = s.groups.filter(function (x) { return same(x.name, lg.name); })[0];
        if (!g) { g = { name: lg.name, rows: [] }; s.groups.push(g); }
        (lg.rows || []).forEach(function (r) {
          if (!r || typeof r.t !== 'string' || typeof r.href !== 'string' || r.href.indexOf('https://') !== 0 || seen(r.href)) return;
          mark(r.href);
          g.rows.push({ k: LABEL[r.k] ? r.k : 'file', t: r.t, d: typeof r.d === 'string' ? r.d : '', href: r.href, by: typeof r.by === 'string' ? r.by : '', date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : '' });
        });
      });
    });
    if (/^\d{4}-\d{2}-\d{2}/.test(live.fetched || '') && live.fetched.slice(0, 10) > today) today = live.fetched.slice(0, 10);
  }

  function chips() {
    kinds.textContent = '';
    KINDS.forEach(function (k) {
      var has = k[0] === 'all' || data.sections.some(function (s) {
        return s.groups.some(function (g) { return g.rows.some(function (r) { return r.k === k[0]; }); });
      });
      if (!has) return; // no chip for a kind the list does not hold
      var b = el('button', 'chip', k[1]);
      b.type = 'button';
      b.id = 'kind-' + k[0];
      b.setAttribute('aria-pressed', k[0] === state.kind ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.kind = k[0];
        Array.prototype.forEach.call(kinds.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
        draw();
      });
      kinds.appendChild(b);
    });
  }

  function start(json) {
    data = json;
    today = data.updated;
    var asof = document.getElementById('asof');
    asof.textContent = 'List updated ' + shortDate(data.updated) + ', ' + data.updated.slice(0, 4) + '.';
    chips();
    search.addEventListener('input', function () {
      state.q = search.value.trim().toLowerCase();
      draw();
    });
    draw();
    // The browser looked for #product before the section existed.
    if (location.hash.length > 1) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
    // The Drive folder, as it is now. No answer is not an error: the published list stands.
    fetch('/api/hub')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (live) {
        if (!live || !live.configured || !Array.isArray(live.sections)) return;
        merge(live);
        chips();
        draw();
        asof.textContent += ' Documents and links come straight from the shared Drive folder.';
      })
      .catch(function () { /* the published list stands */ });
  }

  fetch('/hub/data.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(start)
    .catch(function () {
      main.textContent = '';
      main.appendChild(el('p', 'none error', 'The list could not be loaded. Reload the page; if it still does not appear, tell Jacob.'));
    });
})();
