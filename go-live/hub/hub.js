/* HOAhx · Hub. Draws the whole page from /hub/data.json (see scripts/publish-hub.mjs for the
   shape). Read-only: no shared store, nothing saved. Asset paths are absolute because the page
   is served at /hub with no trailing slash. */
(function () {
  'use strict';

  var KINDS = [['all', 'All'], ['page', 'Pages'], ['doc', 'Docs'], ['sheet', 'Sheets'], ['slides', 'Slides'], ['pdf', 'PDFs'], ['video', 'Videos'], ['folder', 'Folders']];
  var LABEL = { page: 'PAGE', doc: 'DOC', sheet: 'SHEET', slides: 'SLIDES', pdf: 'PDF', video: 'VIDEO', folder: 'FOLDER' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NEW_DAYS = 7;
  var NEW_MAX = 5;

  var main = document.getElementById('main');
  var rail = document.getElementById('rail');
  var kinds = document.getElementById('kinds');
  var search = document.getElementById('q');
  var state = { q: '', kind: 'all' };
  var data = null;

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
  function isNew(row) { return !!row.date && day(data.updated) - day(row.date) < NEW_DAYS; }

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
    a.appendChild(el('span', 'd', row.d));
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
      head.appendChild(el('p', '', s.about));
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

  function start(json) {
    data = json;
    document.getElementById('asof').textContent = 'List updated ' + shortDate(data.updated) + ', ' + data.updated.slice(0, 4) + '.';
    KINDS.forEach(function (k) {
      var has = k[0] === 'all' || data.sections.some(function (s) {
        return s.groups.some(function (g) { return g.rows.some(function (r) { return r.k === k[0]; }); });
      });
      if (!has) return; // no chip for a kind the list does not hold
      var b = el('button', 'chip', k[1]);
      b.type = 'button';
      b.id = 'kind-' + k[0];
      b.setAttribute('aria-pressed', k[0] === 'all' ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.kind = k[0];
        Array.prototype.forEach.call(kinds.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
        draw();
      });
      kinds.appendChild(b);
    });
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
