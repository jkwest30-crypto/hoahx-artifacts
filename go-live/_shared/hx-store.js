// hx-store.js: what claude.ai's page runtime gave Jacob's internal pages, on this site instead
// (moved 2026-11-17). A page sets <html data-store-page="gate|launch-list|signoff"> and loads this
// file before its own script; `window.claude.use("db" | "user" | "assets" | "comments")` then
// answers with the same calls the page already makes, backed by /api/store/<page>/…
// (netlify/functions/pagestore.js).
//
// db:       collection(c).doc(id).get/set/update/delete/onSnapshot, collection(c).add/get/onSnapshot,
//           collection(c).where(f, "==", v).get/onSnapshot, db.doc("c/id")
// user:     isOwner() -> true, id() -> "jacob" (the site has no sign-in; Jacob is its only user)
// assets:   upload(blob) -> { id, url }, delete(id)
// comments: sendToClaude({ text }) saves the message in collection `notifications`; the agent
//           watching the page reads it (pagestore.py wait). canSendToClaude() -> "available".
//
// Live updates poll every POLL_MS (and right after this page writes), since the site has no push.
(function () {
  "use strict";
  var PAGE = document.documentElement.getAttribute("data-store-page");
  if (!PAGE) { console.warn("hx-store: no data-store-page on <html>"); return; }
  var BASE = "/api/store/" + encodeURIComponent(PAGE) + "/";
  var POLL_MS = 15000;

  function fail(res, body) {
    var e = new Error((body && body.error) || ("HTTP " + res.status));
    e.code = (body && body.error) || ("http_" + res.status);
    e.status = res.status;
    return e;
  }
  async function call(method, path, payload) {
    var res = await fetch(BASE + path, {
      method: method,
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
    });
    var body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok) throw fail(res, body);
    return body;
  }
  var enc = encodeURIComponent;

  // Subscribers per collection, refreshed by the poll and after each local write.
  var subs = {};
  function subscribe(col, fn) {
    (subs[col] = subs[col] || []).push(fn);
    fn();
    return function () { subs[col] = (subs[col] || []).filter(function (f) { return f !== fn; }); };
  }
  function changed(col) { (subs[col] || []).forEach(function (f) { try { f(); } catch (e) {} }); }
  setInterval(function () { Object.keys(subs).forEach(changed); }, POLL_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) Object.keys(subs).forEach(changed); });

  // Every answer comes from the server (no offline cache), as Firestore-style snapshot metadata says.
  var META = { fromCache: false, hasPendingWrites: false };
  function docSnap(id, rec) {
    var data = rec ? rec.data : undefined;
    return { id: id, exists: !!rec, metadata: META, data: function () { return data === undefined ? undefined : JSON.parse(JSON.stringify(data)); } };
  }
  function querySnap(docs) {
    var list = docs.map(function (d) { return docSnap(d.id, d); });
    return { docs: list, metadata: META, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } };
  }

  function docRef(col, id) {
    var path = enc(col) + "/" + enc(id);
    return {
      id: id,
      get: async function () { var b = await call("GET", path); return docSnap(id, b.exists ? b : null); },
      set: async function (data) { await call("PUT", path, { data: data }); changed(col); },
      update: async function (data) { await call("PATCH", path, { data: data }); changed(col); },
      delete: async function () { await call("DELETE", path); changed(col); },
      onSnapshot: function (cb, err) {
        var last = null;
        return subscribe(col, function () {
          call("GET", path).then(function (b) {
            var key = JSON.stringify(b);
            if (key === last) return;
            last = key;
            cb(docSnap(id, b.exists ? b : null));
          }, function (e) { if (err) err(e); });
        });
      },
    };
  }

  function query(col, field, value) {
    var qs = field ? ("?where=" + enc(field) + "&eq=" + enc(String(value))) : "";
    function fetchDocs() { return call("GET", enc(col) + qs).then(function (b) { return b.docs || []; }); }
    return {
      get: async function () { return querySnap(await fetchDocs()); },
      onSnapshot: function (cb, err) {
        var last = null;
        return subscribe(col, function () {
          fetchDocs().then(function (docs) {
            var key = JSON.stringify(docs);
            if (key === last) return;
            last = key;
            cb(querySnap(docs));
          }, function (e) { if (err) err(e); });
        });
      },
    };
  }

  function collection(col) {
    var q = query(col);
    return {
      id: col,
      doc: function (id) { return docRef(col, id); },
      add: async function (data) { var b = await call("POST", enc(col), { data: data }); changed(col); return docRef(col, b.id); },
      where: function (field, op, value) {
        if (op !== "==") throw new Error("hx-store: only == is supported");
        return query(col, field, value);
      },
      get: q.get,
      onSnapshot: q.onSnapshot,
    };
  }

  var db = {
    collection: collection,
    doc: function (path) {
      var p = String(path).split("/");
      if (p.length !== 2) throw new Error("hx-store: doc path must be collection/id");
      return docRef(p[0], p[1]);
    },
  };

  var user = {
    isOwner: async function () { return true; },
    id: async function () { return "jacob"; },
  };

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  var assets = {
    upload: async function (blob, opts) {
      var type = (opts && opts.type) || blob.type || "image/jpeg";
      return call("POST", "_assets", { name: blob.name || "", type: type, base64: await toBase64(blob) });
    },
    delete: async function (id) { await call("DELETE", "_assets/" + enc(id)); },
  };

  var comments = {
    canSendToClaude: async function () { return "available"; },
    anchorFor: async function () { return null; },
    sendToClaude: async function (msg) {
      await call("POST", "notifications", { data: { text: String((msg && msg.text) || ""), at: new Date().toISOString(), read: false } });
    },
  };

  var api = { db: db, user: user, assets: assets, comments: comments };
  window.claude = window.claude || {};
  window.claude.use = function (name) { return Promise.resolve(api[name] || null); };
  window.claude.hxStore = { page: PAGE, base: BASE };
})();
