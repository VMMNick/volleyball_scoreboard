/*
 * «Посилання на матч» без DOM: що зберігати, як розібрати адресу другого судді,
 * скільки чекати, перш ніж пояснювати збій, і які причини найімовірніші.
 *
 * Сторінка (js/pages/pult.js) лише малює те, що тут пораховано, і тримає зʼєднання
 * (Remote.connect). Усе тут працює і в браузері (window.Link), і в Node (require) —
 * тому тестується без браузера (tests/link.test.js).
 *
 * Посилання: { server, room, key, guest, proof? }
 *   guest — це пульт другого судді (прийшов за посиланням із ключем);
 *   proof — доказ власності кімнати від сервера (див. server/server.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./remote.js"));
  else root.Link = factory(root.Remote);
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  var KEY = "volleyball:link";
  var LONG_MS = 45000;   // стільки чекаємо (Render прокидається до хвилини), перш ніж пояснювати

  var STATUS_TEXT = {
    connecting: "підключення до сервера…", live: "на звʼязку", offline: "немає звʼязку — перепідключаюсь",
    rejected: "сервер відмовив — посилання недійсне", closed: ""
  };

  /* ---------- збереження ---------- */

  function valid(l) { return !!(l && R.isRoom(l.room) && l.key && l.server); }

  function load(storage) {
    try {
      var l = JSON.parse(storage.getItem(KEY) || "null");
      return valid(l) ? l : null;
    } catch (e) { return null; }
  }

  function save(storage, link) {
    try {
      if (link) storage.setItem(KEY, JSON.stringify(link));
      else storage.removeItem(KEY);
    } catch (e) {}
  }

  /* ---------- адреси ---------- */

  /* Адреса сервера з того, що ввела людина: «назва.onrender.com» → «https://назва.onrender.com». */
  function normServer(v) {
    v = String(v || "").trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    return /^https?:\/\/[^\s/]+/i.test(v) ? v : "";
  }

  /* Нове посилання цього пульта (не другого судді). */
  function create(server) {
    return { server: server, room: R.newRoom(), key: R.newKey(), guest: false };
  }

  /* Відкрили «пульт для другого судді» (index.html?room=…&key=…) — посилання з адреси, інакше null. */
  function fromUrl(search, loc) {
    var q;
    try { q = new URLSearchParams(search || ""); } catch (e) { return null; }
    var room = (q.get("room") || "").toUpperCase();
    var key = q.get("key") || "";
    if (!R.isRoom(room) || !key) return null;
    return { server: normServer(q.get("server")) || R.defaultServer(loc), room: room, key: key, guest: true };
  }

  function boardUrl(link, view) { return R.viewerLink(link.server, "live.html", link.room) + (view || ""); }
  function judgeUrl(link) { return R.viewerLink(link.server, "index.html", link.room, "key=" + encodeURIComponent(link.key)); }

  function statusText(status, link) {
    return (STATUS_TEXT[status] || "") + (link && link.guest ? " · ви — другий суддя" : "") + (link ? " · код " + link.room : "");
  }

  /* ---------- відлік часу без звʼязку ---------- */

  /*
   * Скільки вже немає звʼязку і чому. Після LONG_MS пульт пояснює, що сталося,
   * а onLong кличеться рівно тоді, щоб сторінка перемалювалась.
   * opts: now(), setTimeout, clearTimeout, onLong, longMs — для тестів.
   */
  function lossTracker(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var later = opts.setTimeout || setTimeout;
    var cancel = opts.clearTimeout || clearTimeout;
    var longMs = opts.longMs || LONG_MS;
    var t = { lostAt: 0, why: "", probe: "", timer: null };

    t.track = function (status, info) {
      t.why = status === "rejected" ? (info || "") : "";
      if (status === "live" || status === "closed") {
        t.lostAt = 0;
        t.probe = "";
        cancel(t.timer);
        return;
      }
      if (!t.lostAt) {
        t.lostAt = now();
        cancel(t.timer);
        t.timer = later(function () { if (opts.onLong) opts.onLong(); }, longMs + 50);
      }
    };

    /* Час показати людині, що щось не так. */
    t.trouble = function (status) {
      if (status === "rejected") return true;
      return status !== "live" && t.lostAt > 0 && now() - t.lostAt >= longMs;
    };

    /* Дати серверу ще один повний відлік (кнопка «Спробувати ще»). */
    t.restart = function () { t.lostAt = 0; };

    return t;
  }

  /*
   * Звʼязку довго немає — питаємо сервер напряму. Сайт відповідає, а /healthz — ні:
   * на хостингу лежить лише статика (напр., Static Site на Render), сервера посилань немає.
   * Promise: "ok" | "static" | "down".
   */
  function probe(fetchFn, server) {
    return fetchFn(String(server).replace(/\/+$/, "") + "/healthz", { cache: "no-store" }).then(function (r) {
      if (r.ok) return r.json().then(function (j) { return j && j.ok ? "ok" : "static"; }, function () { return "static"; });
      return r.status === 404 ? "static" : "down";
    }, function () { return "down"; });
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return String(url || ""); }
  }

  /*
   * Найімовірніші причини — від конкретних до загальних.
   * s: { status, why, probe, link, location, onLine }
   */
  function reasons(s) {
    var why = [];
    var link = s.link, loc = s.location || {};
    if (s.status === "rejected") {
      why.push(s.why === "wrong-key"
        ? "Ключ судді не підходить — посилання застаріле або матч уже закрили."
        : s.why === "full"
          ? "Сервер перевантажений — забагато відкритих матчів. Спробуйте пізніше."
          : "Сервер відмовив у підключенні — це посилання більше не дійсне.");
      why.push("Зупиніть посилання й створіть нове.");
      return why;
    }
    if (s.onLine === false) {
      why.push("Пристрій не в інтернеті — перевірте Wi-Fi або мобільні дані.");
    }
    if (loc.protocol === "file:") {
      why.push("Сайт відкрито як файл із комп'ютера — посилання працюють лише з адреси сервера.");
    } else if (/^https?:$/.test(loc.protocol || "") && hostOf(link.server) !== loc.host &&
               link.server !== R.defaultServer(loc)) {          // сервер із js/config.js — так і задумано
      why.push("Посилання створене для сервера " + hostOf(link.server) + ", а сайт відкрито з " + loc.host +
        ". Якщо сервер змінився — зупиніть посилання й створіть нове.");
    }
    if (s.probe === "static") {
      why.unshift("Сайт на " + hostOf(link.server) + " працює, але сервера посилань там немає — розгорнуто лише статичні файли. " +
        "На Render потрібен Web Service (Node, команда запуску «npm start»), а не Static Site. " +
        "GitHub Pages — теж лише статика: адресу сервера на Render задає змінна SYNC_SERVER.");
      return why;
    }
    if (s.probe === "ok") {
      why.push("Сервер працює, але WebSocket-зʼєднання не проходить — можливо, його блокує мережа (проксі, VPN, шкільний чи робочий Wi-Fi).");
      return why;
    }
    if (/onrender\.com$/i.test(hostOf(link.server))) {
      why.push("Безкоштовний Render засинає без відвідувачів і прокидається до хвилини. Якщо довше — сервіс не запущений: перевірте його в панелі Render.");
    } else {
      why.push("Сервер " + hostOf(link.server) + " не відповідає — він вимкнений або адреса неправильна.");
    }
    return why;
  }

  return { KEY: KEY, LONG_MS: LONG_MS, STATUS_TEXT: STATUS_TEXT, load: load, save: save, valid: valid,
           normServer: normServer, create: create, fromUrl: fromUrl, boardUrl: boardUrl, judgeUrl: judgeUrl,
           statusText: statusText, lossTracker: lossTracker, probe: probe, hostOf: hostOf, reasons: reasons };
});
