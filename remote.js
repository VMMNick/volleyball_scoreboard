/*
 * Зʼєднання з сервером синхронізації (server.js) через WebSocket.
 * Перепідключається сам із наростаючою паузою; на кожне нове зʼєднання
 * викликає onStatus("live") — пульт у цей момент надсилає повний стан,
 * тож навіть перезапуск сервера нічого не губить.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Remote = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Без I, O, 0, 1 — код диктують уголос і читають з екрана.
  var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  var FATAL = { 4000: "bad-room", 4001: "bad-key", 4003: "wrong-key", 4029: "full" };

  function random(chars, n, cryptoObj) {
    var out = "";
    var bytes = new Uint8Array(n);
    if (cryptoObj && cryptoObj.getRandomValues) cryptoObj.getRandomValues(bytes);
    else for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    for (var k = 0; k < n; k++) out += chars[bytes[k] % chars.length];
    return out;
  }

  function newRoom(c) { return random(ALPHABET, 6, c || (typeof crypto !== "undefined" ? crypto : null)); }
  function newKey(c) { return random(KEY_CHARS, 32, c || (typeof crypto !== "undefined" ? crypto : null)); }
  function isRoom(code) { return /^[A-HJ-NP-Z2-9]{6}$/.test(String(code || "")); }

  /* Адреса сервера за замовчуванням — той самий сайт, якщо він відкритий по http(s). */
  function defaultServer(loc) {
    return loc && /^https?:$/.test(loc.protocol) ? loc.origin : "";
  }

  function wsUrl(server, params) {
    var base = String(server || "").replace(/\/+$/, "").replace(/^http/, "ws");
    var q = [];
    for (var k in params) if (params[k]) q.push(k + "=" + encodeURIComponent(params[k]));
    return base + "/ws?" + q.join("&");
  }

  /*
   * Посилання на сторінку page того ж сервера з кодом кімнати.
   * extra — додаткові параметри, напр. "key=…" для пульта другого судді.
   */
  function viewerLink(server, page, room, extra) {
    return String(server || "").replace(/\/+$/, "") + "/" + page + "?room=" + room + (extra ? "&" + extra : "");
  }

  /*
   * opts: server, room, role ("control" | "viewer"), key, onMessage(msg), onStatus(status, info),
   *       WebSocket (для тестів), setTimeout.
   * status: "connecting" | "live" | "offline" | "rejected"
   */
  function connect(opts) {
    var WS = opts.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
    var later = opts.setTimeout || setTimeout;
    var ws = null, stopped = false, delay = 1000, status = "", timer = null;

    function setStatus(s, info) {
      status = s;
      if (opts.onStatus) opts.onStatus(s, info);
    }

    function open() {
      if (stopped) return;
      if (!WS || !opts.server) { setStatus("offline", "no-server"); return; }
      setStatus("connecting");
      try {
        ws = new WS(wsUrl(opts.server, { room: opts.room, role: opts.role, key: opts.key }));
      } catch (e) { retry(); return; }
      ws.onopen = function () { delay = 1000; };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg && msg.type === "hello") setStatus("live");
        if (opts.onMessage) opts.onMessage(msg);
      };
      ws.onclose = function (e) {
        ws = null;
        if (stopped) return;
        if (e && FATAL[e.code]) { setStatus("rejected", FATAL[e.code]); return; }   // повтор не допоможе
        retry();
      };
      ws.onerror = function () {};
    }

    function retry() {
      setStatus("offline");
      clearTimeout(timer);
      timer = later(open, delay);
      delay = Math.min(delay * 2, 15000);
    }

    open();

    return {
      send: function (msg) {
        if (ws && ws.readyState === 1 && status === "live") { ws.send(JSON.stringify(msg)); return true; }
        return false;
      },
      close: function () {
        stopped = true;
        clearTimeout(timer);
        if (ws) try { ws.close(); } catch (e) {}
        setStatus("closed");
      },
      status: function () { return status; }
    };
  }

  return { connect: connect, newRoom: newRoom, newKey: newKey, isRoom: isRoom,
           defaultServer: defaultServer, wsUrl: wsUrl, viewerLink: viewerLink };
});
