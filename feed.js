/*
 * Звідки табло бере рахунок.
 *
 * Без ?room= — з цього ж пристрою: localStorage (подія storage) +
 * BroadcastChannel від пульта в сусідньому вікні.
 * З ?room=ABC234 — з сервера трансляції (Remote), тільки читання.
 * Адресу сервера можна задати ?server=https://…, інакше — той самий сайт.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Feed = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY = "volleyball:match";
  var PREF = "volleyball:prefs";
  var CHANNEL = "volleyball";

  function param(win, name) {
    try { return new URLSearchParams(win.location.search).get(name); } catch (e) { return null; }
  }

  function read(win, key) {
    try { return win.localStorage.getItem(key); } catch (e) { return null; }
  }

  /* opts: win, onMatch(raw), onPrefs(obj|string), onTimeoutEnd(ts), onStatus(status, info) */
  function create(opts) {
    var win = opts.win || window;
    var room = (param(win, "room") || "").toUpperCase();
    var R = win.Remote;

    if (room && R && R.isRoom(room)) {
      var server = param(win, "server") || R.defaultServer(win.location);
      var link = R.connect({
        server: server, room: room, role: "viewer",
        WebSocket: win.WebSocket,
        onStatus: opts.onStatus,
        onMessage: function (msg) {
          if (msg.type === "state" && msg.match) opts.onMatch(msg.match);
          else if (msg.type === "prefs" && msg.prefs) opts.onPrefs(msg.prefs);
          else if (msg.type === "timeout-end") opts.onTimeoutEnd(msg.ts);
        }
      });
      return { mode: "remote", room: room, server: server, close: link.close };
    }

    // ---- той самий пристрій ----
    function loadAll() {
      var m = read(win, KEY), p = read(win, PREF);
      if (p) opts.onPrefs(p);
      if (m) opts.onMatch(m);
    }

    win.addEventListener("storage", function (e) {
      if (e.key === KEY && e.newValue) opts.onMatch(e.newValue);
      else if (e.key === PREF && e.newValue) opts.onPrefs(e.newValue);
      else if (e.key === null) loadAll();            // сховище очистили
    });

    var channel = null;
    if (typeof win.BroadcastChannel === "function") {
      channel = new win.BroadcastChannel(CHANNEL);
      channel.onmessage = function (e) {
        var msg = e.data || {};
        if (msg.type === "state" && msg.match) opts.onMatch(msg.match);
        else if (msg.type === "prefs" && msg.prefs) opts.onPrefs(msg.prefs);
        else if (msg.type === "timeout-end") opts.onTimeoutEnd(msg.ts);
      };
    }
    loadAll();
    // Пульт міг зберігати не в localStorage — попросимо стан напряму.
    if (channel) channel.postMessage({ type: "hello" });
    if (opts.onStatus) opts.onStatus("local");
    return { mode: "local", room: null, server: null, close: function () { if (channel) channel.close(); } };
  }

  return { create: create };
});
