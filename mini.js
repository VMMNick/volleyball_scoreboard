/*
 * Міні-пульт (mini.html): міні-табло зверху, кнопки під ним — окрема
 * маленька вкладка чи вікно.
 *
 * Веде той самий матч, що й основний пульт на цьому пристрої: пише в те саме
 * сховище (localStorage) і в той самий BroadcastChannel, а основний пульт
 * підхоплює зміни й, якщо створено «Посилання на матч», пересилає їх на сервер.
 * Зміни з основного пульта так само одразу видно тут.
 */
(function () {
  "use strict";

  var M = window.Match;
  var P = window.Palettes;
  var U = window.UI;
  var KEY = "volleyball:match";
  var PREF = "volleyball:prefs";

  var match = M.createMatch();
  var prefs = { timeoutSec: 30, palette: P.list[0].id, showServe: true, vibrate: true };
  var dismissedTimeout = null;
  var tick = null;
  var bug = window.Scorebug.create(document, M);
  var channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("volleyball") : null;

  function $(id) { return document.getElementById(id); }
  function raw() { return M.serialize(match); }

  /* Прийняти стан ззовні; true — якщо він справді новий. */
  function take(r) {
    if (!r || r === raw()) return false;
    try {
      var m = M.deserialize(r);
      if (m) { match = m; return true; }
    } catch (e) {}
    return false;
  }

  function takePrefs(p) {
    try {
      p = typeof p === "string" ? JSON.parse(p) : p;
      if (!p || typeof p !== "object") return;
      if (typeof p.timeoutSec === "number") prefs.timeoutSec = p.timeoutSec;
      if (typeof p.palette === "string") prefs.palette = P.byId(p.palette).id;
      if (typeof p.showServe === "boolean") prefs.showServe = p.showServe;
      if (typeof p.vibrate === "boolean") prefs.vibrate = p.vibrate;
    } catch (e) {}
    P.apply(document.documentElement, prefs.palette);
  }

  function commit(next) {
    if (next === match) return;
    var before = M.reduce(match);
    match = next;
    var r = raw();
    try { localStorage.setItem(KEY, r); } catch (e) {}
    if (channel) channel.postMessage({ type: "state", match: r });
    var after = M.reduce(match);
    if (prefs.vibrate && navigator.vibrate && after.rallies > before.rallies) {
      var lp = after.lastPoint;
      navigator.vibrate(lp && lp.closedMatch ? [80, 60, 80, 60, 160] : lp && lp.closedSet ? [60, 50, 120] : 14);
    }
    render();
  }

  function dots(n, of) {
    var out = "";
    for (var i = 0; i < of; i++) out += i < n ? "●" : "○";
    return out;
  }

  function render() {
    clearTimeout(tick);
    var s = M.reduce(match);
    var i = bug.render(s, prefs, dismissedTimeout);

    [0, 1].forEach(function (team) {
      var t = team === 0 ? "A" : "B";
      $("mName" + t).textContent = s.names[team];
      $("mPlus" + t).disabled = s.done;
      $("mMinus" + t).disabled = s.done || s.points[team] === 0;
      var to = $("mTo" + t);
      to.textContent = "тайм-аут " + dots(s.timeouts[team], s.rules.timeouts);
      to.disabled = s.done || s.timeouts[team] <= 0;
    });
    $("mUndo").disabled = !M.canUndo(match);
    $("mRedo").disabled = !M.canRedo(match);

    // Першого подавача можна обрати лише до першого розіграшу сету.
    var canPick = !s.done && !s.points[0] && !s.points[1];
    var who = s.serving === null ? null : s.names[s.serving];
    $("mServe").disabled = !canPick;
    $("mServe").textContent = canPick ? (who ? "Подає: " + who + " ⇄" : "Хто подає? ⇄") : (who ? "Подає: " + who : "Подача");

    document.title = s.names[0] + " " + s.points[0] + ":" + s.points[1] + " " + s.names[1] + " — міні-пульт";
    $("live").textContent = s.names[0] + " " + s.points[0] + ", " + s.names[1] + " " + s.points[1];
    if (i.ticking) tick = setTimeout(render, 500);
  }

  /* ---------- дії ---------- */

  function point(team) { commit(M.addPoint(match, team)); }
  function takeBack(team) { commit(M.removeLastPoint(match, team)); }
  function timeout(team) {
    var next = M.callTimeout(match, team);
    if (next !== match) dismissedTimeout = null;
    commit(next);
  }
  function switchServe() {
    var s = M.reduce(match);
    commit(M.setServer(match, s.serving === 0 ? 1 : 0));
  }

  $("mPlusA").addEventListener("click", function () { point(0); });
  $("mPlusB").addEventListener("click", function () { point(1); });
  $("mMinusA").addEventListener("click", function () { takeBack(0); });
  $("mMinusB").addEventListener("click", function () { takeBack(1); });
  $("mToA").addEventListener("click", function () { timeout(0); });
  $("mToB").addEventListener("click", function () { timeout(1); });
  $("mUndo").addEventListener("click", function () { commit(M.undo(match)); });
  $("mRedo").addEventListener("click", function () { commit(M.redo(match)); });
  $("mServe").addEventListener("click", switchServe);

  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if (k === "1") point(0);
    else if (k === "2") point(1);
    else if (k === "q") timeout(0);
    else if (k === "p") timeout(1);
    else if (k === "backspace") { e.preventDefault(); commit(e.shiftKey ? M.redo(match) : M.undo(match)); }
  });

  /* ---------- зміни з основного пульта й інших вкладок ---------- */

  window.addEventListener("storage", function (e) {
    if (e.key === KEY && take(e.newValue)) render();
    else if (e.key === PREF && e.newValue) { takePrefs(e.newValue); render(); }
  });

  if (channel) {
    channel.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === "state" && take(msg.match)) render();
      else if (msg.type === "prefs" && msg.prefs) { takePrefs(msg.prefs); render(); }
      else if (msg.type === "timeout-end") { dismissedTimeout = msg.ts; render(); }
      // Велике табло щойно відкрилось, а основного пульта може й не бути.
      else if (msg.type === "hello") channel.postMessage({ type: "state", match: raw() });
    };
  }

  try {
    take(localStorage.getItem(KEY));
    takePrefs(localStorage.getItem(PREF));
  } catch (e) {}
  P.apply(document.documentElement, prefs.palette);
  render();
  if (channel) channel.postMessage({ type: "hello" });
  U.keepAwake();
  U.registerSW();
})();
