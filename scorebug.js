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
    if (s.startedAt === null && !s.setLog.length) return { text: "матч ще не почався", cls: "" };
    return { text: (s.rules.bestOf > 1 ? s.setNumber + "-й сет · " : "") + "до " + s.target, cls: "" };
  }

  function create(doc, M) {
    var prevPts = null;
    function $(id) { return doc.getElementById(id); }

    /* Рядки — у порядку команд (А зверху), а не сторін майданчика. Повертає info. */
    function render(s, prefs, dismissedTimeout) {
      $("board").classList.toggle("no-sets", s.rules.bestOf <= 1);
      [0, 1].forEach(function (team) {
        var t = team === 0 ? "A" : "B";
        $("lName" + t).textContent = s.names[team];
        $("lServe" + t).className = "serve" + (prefs.showServe && !s.done && s.serving === team ? " on" : "");
        $("lSets" + t).textContent = s.sets[team];
        var pts = s.done ? "" : String(s.points[team]);
        var el = $("lPts" + t);
        if (prevPts && pts !== "" && Number(pts) > Number(prevPts[team] || 0)) {
          el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
        }
        el.textContent = pts;
      });
      prevPts = s.done ? null : [String(s.points[0]), String(s.points[1])];
      $("lTitle").textContent = s.title;
      var i = info(M, s, prefs, dismissedTimeout);
      $("lInfo").textContent = i.text;
      $("lInfo").className = "info num " + i.cls;
      return i;
    }

    return { render: render };
  }

  return { create: create, info: info };
});
