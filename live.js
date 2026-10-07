/*
 * Міні-табло (live.html): назви команд, сети й очки.
 * Без ?room= — рахунок із цього ж пристрою; з ?room=ABC234 — посилання
 * на матч з будь-якого пристрою через сервер. Тільки показ, нічого не змінює.
 */
(function () {
  "use strict";

  var M = window.Match;
  var P = window.Palettes;
  var U = window.UI;

  var match = null;                       // null — пульт ще нічого не надіслав
  var prefs = { timeoutSec: 30, palette: P.list[0].id, showServe: true };
  var dismissedTimeout = null;
  var tick = null;

  function $(id) { return document.getElementById(id); }

  function takeMatch(raw) {
    try { var m = M.deserialize(raw); if (m) match = m; } catch (e) {}
  }

  function takePrefs(raw) {
    try {
      var p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!p || typeof p !== "object") return;
      if (typeof p.timeoutSec === "number") prefs.timeoutSec = p.timeoutSec;
      if (typeof p.palette === "string") prefs.palette = P.byId(p.palette).id;
      if (typeof p.showServe === "boolean") prefs.showServe = p.showServe;
      if (typeof p.boardWidth === "number") prefs.boardWidth = p.boardWidth;
    } catch (e) {}
    P.apply(document.documentElement, prefs.palette);
    applySize();
  }

  /*
   * Режим сторінки: fill — на все вікно; keep — тримає пропорції в будь-якому блоці (iframe);
   * mini (типово) — сторінка сама маленька, таблиця фіксованого розміру. Ширину задає адреса
   * (&w=…) або пульт — тоді її можна міняти просто під час ефіру.
   */
  var q = {};
  try { q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) {}
  var inFrame = false;
  try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
  var mode = q.fit === "fill" ? "fill" : (q.fit === "keep" || inFrame) ? "keep" : "mini";

  function applySize() {
    if (mode !== "mini" || !window.Remote) return;
    var w = window.Remote.boardWidthNorm(q.w || prefs.boardWidth);
    var h = Math.round(w / 3.2);
    [document.documentElement, document.body].forEach(function (el) {
      el.style.width = w + "px";
      el.style.height = h + "px";
    });
    document.body.style.setProperty("--W", w + "px");
    document.body.style.setProperty("--H", h + "px");
  }

  var bug = window.Scorebug.create(document, M);

  function render() {
    document.body.classList.toggle("waiting", !match);
    clearTimeout(tick);
    if (!match) return;
    var s = M.reduce(match);
    var i = bug.render(s, prefs, dismissedTimeout);
    // Колонки сетів тут немає — після кінця матчу лічильник показує рахунок за сетами.
    if (s.done) { $("lPtsA").textContent = s.sets[0]; $("lPtsB").textContent = s.sets[1]; }
    document.title = s.names[0] + " " + s.points[0] + ":" + s.points[1] + " " + s.names[1];
    $("live").textContent = s.names[0] + " " + s.points[0] + ", " + s.names[1] + " " + s.points[1];
    if (i.ticking) tick = setTimeout(render, 500);       // відлік тайм-ауту щосекунди
  }

  var LINK_TEXT = {
    connecting: "підключення…", live: "наживо", offline: "немає звʼязку — перепідключаюсь",
    rejected: "табло не знайдено — перевірте посилання"
  };

  /* Відкрити кнопки окремим маленьким вікном; заблоковане — посилання відкриє вкладку. */
  $("lCtl").addEventListener("click", function (e) {
    var w = window.open("./mini.html?view=controls", "volley-mini", "popup,width=480,height=560");
    if (w) e.preventDefault();
  });
  function paintLink(status) {
    // Табло на цьому ж пристрої — поруч посилання на кнопки керування того ж матчу.
    document.body.classList.toggle("local", status === "local");
    var el = $("linkStatus");
    el.className = "link-status " + (status === "local" ? "" : "show " + status);
    el.textContent = LINK_TEXT[status] || "";
  }


  ["fill", "keep", "mini"].forEach(function (m) {
    document.documentElement.classList.toggle(m, m === mode);
    document.body.classList.toggle(m, m === mode);
  });
  applySize();

  P.apply(document.documentElement, prefs.palette);
  render();
  window.Feed.create({
    win: window,
    onMatch: function (raw) { takeMatch(raw); render(); },
    onPrefs: function (p) { takePrefs(p); render(); },
    onTimeoutEnd: function (ts) { dismissedTimeout = ts; render(); },
    onStatus: paintLink
  });
  U.keepAwake();
  U.registerSW();
})();
