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
  var prevPts = null;
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
    } catch (e) {}
    P.apply(document.documentElement, prefs.palette);
  }

  /* Права частина нижнього рядка: що зараз найважливіше. */
  function info(s) {
    if (s.done) {
      var w = s.winner;
      return { text: s.names[w] + " виграла " + s.sets[w] + ":" + s.sets[1 - w], cls: "done" };
    }
    var lt = s.lastTimeout;
    if (lt && dismissedTimeout !== lt.ts) {
      var left = Math.ceil((lt.ts + prefs.timeoutSec * 1000 - Date.now()) / 1000);
      if (left > 0) return { text: (lt.tech ? "технічний тайм-аут" : "тайм-аут · " + s.names[lt.team]) + " · " + left, cls: "hot" };
    }
    var mp = M.matchPointFor(s), sp = M.setPointFor(s);
    if (mp !== null) return { text: "матчбол · " + s.names[mp], cls: "hot" };
    if (sp !== null) return { text: "сетбол · " + s.names[sp], cls: "hot" };
    if (M.sideSwapDue(s)) return { text: "зміна сторін", cls: "hot" };
    if (s.startedAt === null && !s.setLog.length) return { text: "матч ще не почався", cls: "" };
    return { text: (s.rules.bestOf > 1 ? s.setNumber + "-й сет · " : "") + "до " + s.target, cls: "" };
  }

  function render() {
    document.body.classList.toggle("waiting", !match);
    clearTimeout(tick);
    if (!match) return;
    var s = M.reduce(match);
    var board = $("board");
    board.classList.toggle("no-sets", s.rules.bestOf <= 1);

    // Рядки — у порядку команд (А зверху), а не сторін майданчика: глядачу так простіше.
    [0, 1].forEach(function (team) {
      var t = team === 0 ? "A" : "B";
      $("lName" + t).textContent = s.names[team];
      $("lServe" + t).className = "serve" + (prefs.showServe && !s.done && s.serving === team ? " on" : "");
      $("lSets" + t).textContent = s.sets[team];
      var pts = s.done ? "" : String(s.points[team]);
      var el = $("lPts" + t);
      if (prevPts && prevPts[team] !== pts && pts !== "" && Number(pts) > Number(prevPts[team] || 0)) {
        el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
      }
      el.textContent = pts;
    });
    prevPts = s.done ? null : [String(s.points[0]), String(s.points[1])];

    $("lTitle").textContent = s.title;
    var i = info(s);
    $("lInfo").textContent = i.text;
    $("lInfo").className = "info num " + i.cls;
    document.title = s.names[0] + " " + s.points[0] + ":" + s.points[1] + " " + s.names[1];
    $("live").textContent = s.names[0] + " " + s.points[0] + ", " + s.names[1] + " " + s.points[1];

    // Поки йде тайм-аут — оновлюємо відлік щосекунди.
    if (i.cls === "hot" && /тайм-аут/.test(i.text)) tick = setTimeout(render, 500);
  }

  var LINK_TEXT = {
    connecting: "підключення…", live: "наживо", offline: "немає звʼязку — перепідключаюсь",
    rejected: "табло не знайдено — перевірте посилання"
  };
  function paintLink(status) {
    var el = $("linkStatus");
    el.className = "link-status " + (status === "local" ? "" : "show " + status);
    el.textContent = LINK_TEXT[status] || "";
  }


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
