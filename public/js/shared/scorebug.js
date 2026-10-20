/*
 * Малює міні-табло («скорбаг», scorebug.css): назви команд, подачу, сети,
 * очки й нижній рядок. Спільне для live.html і mini.html — щоб обидва
 * виглядали й поводились однаково.
 *
 * Розмітка: board, lNameA/B, lServeA/B, lSetsA/B, lPtsA/B, lTitle, lInfo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scorebug = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Що зараз найважливіше — для правої частини нижнього рядка. */
  function info(M, s, prefs, dismissedTimeout) {
    if (s.done) {
      var w = s.winner;
      return { text: s.names[w] + " виграла " + s.sets[w] + ":" + s.sets[1 - w], cls: "done" };
    }
    var lt = s.lastTimeout;
    if (lt && dismissedTimeout !== lt.ts) {
      var left = Math.ceil((lt.ts + prefs.timeoutSec * 1000 - Date.now()) / 1000);
      if (left > 0) return { text: (lt.tech ? "технічний тайм-аут" : "тайм-аут · " + s.names[lt.team]) + " · " + left, cls: "hot", ticking: true };
    }
    var mp = M.matchPointFor(s), sp = M.setPointFor(s);
    if (mp !== null) return { text: "матчбол · " + s.names[mp], cls: "hot" };
    if (sp !== null) return { text: "сетбол · " + s.names[sp], cls: "hot" };
    if (M.sideSwapDue(s)) return { text: "зміна сторін", cls: "hot" };
    if (s.startedAt === null && !s.setLog.length) return { text: "почати матч", cls: "" };
    return { text: (s.rules.bestOf > 1 ? s.setNumber + "-й сет · " : "") + "до " + s.target, cls: "" };
  }

  function create(doc, M) {
    var prevPts = null;
    function $(id) { return doc.getElementById(id); }

    /*
     * Колонки зіграних сетів, як у волейбольних таблицях: очки кожної команди в кожному сеті,
     * у переможця сету — клас win. Малюються, лише якщо в розмітці є lPerA / lPerB
     * (lPerHead — номери сетів у шапці).
     */
    function paintSetColumns(s) {
      [0, 1].forEach(function (team) {
        var el = $("lPer" + (team === 0 ? "A" : "B"));
        if (!el) return;
        el.innerHTML = s.setLog.map(function (set) {
          return '<b class="' + (set.winner === team ? "win" : "") + '">' + Number(set.points[team]) + "</b>";
        }).join("");
      });
      var head = $("lPerHead");
      if (head) head.innerHTML = s.setLog.map(function (set, i) { return "<b>" + (i + 1) + "</b>"; }).join("");
    }

    /* Рядки — у порядку команд (А зверху), а не сторін майданчика. Повертає info. */
    function render(s, prefs, dismissedTimeout) {
      $("board").classList.toggle("no-sets", s.rules.bestOf <= 1);
      // Перші 10 с після кінця матчу — ще рахунок останнього сету (див. Match.finalHoldLeft).
      var hold = M.finalHoldLeft ? M.finalHoldLeft(s) : 0;
      var shown = hold ? M.shownPoints(s) : s.points;
      [0, 1].forEach(function (team) {
        var t = team === 0 ? "A" : "B";
        $("lName" + t).textContent = s.names[team];
        $("lServe" + t).className = "serve" + (prefs.showServe && !s.done && s.serving === team ? " on" : "");
        $("lSets" + t).textContent = s.sets[team];
        var pts = s.done && !hold ? "" : String(shown[team]);
        var el = $("lPts" + t);
        if (prevPts && pts !== "" && Number(pts) > Number(prevPts[team] || 0)) {
          el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
        }
        el.textContent = pts;
      });
      prevPts = s.done ? null : [String(s.points[0]), String(s.points[1])];
      if (hold) { prevPts = null; doc.body.classList.add("final-hold"); } else doc.body.classList.remove("final-hold");
      paintSetColumns(s);
      $("lTitle").textContent = s.title;
      var i = info(M, s, prefs, dismissedTimeout);
      $("lInfo").textContent = i.text;
      $("lInfo").className = "info num " + i.cls;
      i.hold = hold;                                 // сторінка перемалює себе, коли пауза мине
      return i;
    }

    return { render: render };
  }

  return { create: create, info: info };
});
