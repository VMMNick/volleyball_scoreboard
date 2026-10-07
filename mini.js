/*
 * Міні-пульт (mini.html): міні-табло зверху, кнопки під ним — окрема
 * маленька вкладка чи вікно.
 *
 * Веде той самий матч, що й основний пульт на цьому пристрої: пише в те саме
 * сховище (localStorage) і в той самий BroadcastChannel, а основний пульт
 * підхоплює зміни й, якщо створено «Посилання на матч», пересилає їх на сервер.
 * Зміни з основного пульта так само одразу видно тут.
 *
 * Якщо в цьому браузері є «Посилання на матч», міні-пульт і сам підключається
 * до матчу на сервері — тож окреме міні-табло за посиланням (стрім, інший
 * пристрій) оновлюється, навіть коли основний пульт закритий.
 */
(function () {
  "use strict";

  var M = window.Match;
  var P = window.Palettes;
  var U = window.UI;
  var KEY = "volleyball:match";
  var PREF = "volleyball:prefs";

  var match = M.createMatch();
  var prefs = { timeoutSec: 30, palette: P.list[0].id, showServe: true, vibrate: true, boardWidth: 300 };
  var dismissedTimeout = null;
  var tick = null;
  var bug = window.Scorebug.create(document, M);
  var channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("volleyball") : null;

  function $(id) { return document.getElementById(id); }
  function raw() { return M.serialize(match); }

  /* ---------- посилання на матч: той самий матч на сервері ---------- */

  var R = window.Remote;
  var link = null, conn = null;

  function linkSend(msg) { if (conn) conn.send(msg); }

  function pultPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF) || "null"); } catch (e) { return null; }
  }

  function boardUrl() { return link ? R.viewerLink(link.server, "live.html", link.room) : "./live.html"; }

  var STREAM_TEXT = { connecting: "підключення…", live: "на звʼязку", offline: "немає звʼязку", rejected: "посилання недійсне" };

  function paintStream(status) {
    $("mStream").classList.toggle("on", !!link);
    $("mBoardOut").href = boardUrl();
    if (!link) return;
    status = status || (conn ? conn.status() : "");
    $("mStreamUrl").textContent = boardUrl();
    $("mStreamUrl").href = boardUrl();
    $("mBwSize").textContent = prefs.boardWidth + "×" + Math.round(prefs.boardWidth / 3.2);
    $("mBwMinus").disabled = prefs.boardWidth <= R.BOARD_WIDTH.min;
    $("mBwPlus").disabled = prefs.boardWidth >= R.BOARD_WIDTH.max;
    $("mStreamSt").className = "st " + status;
    $("mStreamSt").textContent = STREAM_TEXT[status] || "";
  }

  function connectLink(l) {
    if (conn) conn.close();
    conn = null;
    link = l;
    if (!l || !R) { paintStream(); return; }
    conn = R.connect({
      server: l.server, room: l.room, role: "control", key: l.key,
      WebSocket: window.WebSocket,
      onStatus: function (st) {
        // Як і основний пульт: після (пере)підключення — увесь стан. Другий суддя — ні, він бере матч із сервера.
        if (st === "live" && !l.guest && conn) {
          conn.send({ type: "state", match: raw() });
          var p = pultPrefs();
          if (p) conn.send({ type: "prefs", prefs: p });
        }
        paintStream(st);
      },
      onMessage: function (msg) {
        if (!msg) return;
        if (msg.type === "state" && msg.match && take(msg.match)) { share(); render(); }
        else if (msg.type === "prefs" && msg.prefs) { takePrefs(msg.prefs); render(); }
        else if (msg.type === "timeout-end") { dismissedTimeout = msg.ts; render(); }
      }
    });
    paintStream();
  }

  /* Новий стан — у сховище й сусідні вкладки (основний пульт, велике табло). */
  function share() {
    var r = raw();
    try { localStorage.setItem(KEY, r); } catch (e) {}
    if (channel) channel.postMessage({ type: "state", match: r });
  }

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
      if (R && p.boardWidth !== undefined) prefs.boardWidth = R.boardWidthNorm(p.boardWidth);
    } catch (e) {}
    P.apply(document.documentElement, prefs.palette);
    if (R) paintStream();                                // розмір і кут накладки могли змінитись
  }

  function commit(next) {
    if (next === match) return;
    var before = M.reduce(match);
    match = next;
    share();
    linkSend({ type: "state", match: raw() });
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
      $("mPts" + t).textContent = s.done ? s.sets[team] : s.points[team];
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

  /* ---------- табло й керування: разом або окремими сторінками ---------- */

  /*
   * ?view=controls — лише кнопки (табло відкрите окремо: live.html поруч чи на
   * іншому екрані). Вибір запамʼятовується для цієї вкладки браузера.
   */
  var VIEW_KEY = "volleyball:miniView";

  function setView(controlsOnly, remember) {
    document.body.classList.toggle("controls", controlsOnly);
    $("mToggleBoard").textContent = controlsOnly ? "Показати табло" : "Сховати табло";
    if (!remember) return;
    try { localStorage.setItem(VIEW_KEY, controlsOnly ? "controls" : "both"); } catch (e) {}
    try { history.replaceState(null, "", location.pathname + (controlsOnly ? "?view=controls" : "")); } catch (e) {}
  }

  function initialView() {
    try {
      var v = new URLSearchParams(location.search).get("view");
      if (v) return v === "controls";
      return localStorage.getItem(VIEW_KEY) === "controls";
    } catch (e) { return false; }
  }

  /*
   * Табло окремо — у своєму вікні; керування лишається тут і далі веде той самий матч.
   * Сайт відкрито з сервера — табло йде за посиланням на матч, тож його адресу можна
   * вставити в програму для стріму чи відкрити на іншому пристрої.
   */
  function openBoard(e) {
    if (!link && R) {
      var l = R.ensureLink(localStorage, location);
      if (l) connectLink(l);
    }
    var w = window.open(boardUrl(), "volley-board", "popup,width=" + prefs.boardWidth + ",height=" + Math.round(prefs.boardWidth / 3.2));
    // Маленьке вікно заблоковане — тоді посилання саме відкриє табло в новій вкладці.
    if (w && e) e.preventDefault();
    setView(true, true);                                 // табло тепер окремо — тут лишаємо кнопки
  }

  $("mToggleBoard").addEventListener("click", function () {
    setView(!document.body.classList.contains("controls"), true);
  });
  $("mBoardOut").addEventListener("click", openBoard);
  function copy(btn, text) {
    var label = btn.textContent;
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = "Скопійовано";
      setTimeout(function () { btn.textContent = label; }, 1600);
    }).catch(function () {});
  }
  /*
   * Розмір окремого міні-табла змінюється звідси й без основного пульта: у спільні
   * налаштування, сусіднім вкладкам — через канал, табло в стрім-додатку — через сервер.
   */
  function setBoardWidth(w) {
    prefs.boardWidth = R.boardWidthNorm(w);
    var all = pultPrefs() || {};
    all.boardWidth = prefs.boardWidth;
    try { localStorage.setItem(PREF, JSON.stringify(all)); } catch (e) {}
    if (channel) channel.postMessage({ type: "prefs", prefs: all });
    linkSend({ type: "prefs", prefs: all });
    paintStream();
  }
  $("mBwMinus").addEventListener("click", function () { setBoardWidth(prefs.boardWidth - R.BOARD_WIDTH.step); });
  $("mBwPlus").addEventListener("click", function () { setBoardWidth(prefs.boardWidth + R.BOARD_WIDTH.step); });
  $("mStreamCopy").addEventListener("click", function () { copy($("mStreamCopy"), boardUrl()); });
  $("mStreamEmbed").addEventListener("click", function () { copy($("mStreamEmbed"), R.embedCode(boardUrl())); });

  /* ---------- зміни з основного пульта й інших вкладок ---------- */

  window.addEventListener("storage", function (e) {
    // Чужі зміни назад на сервер не шлемо: старий стан міг би перекрити новіший від другого судді.
    if (e.key === KEY && take(e.newValue)) render();
    else if (e.key === PREF && e.newValue) { takePrefs(e.newValue); render(); }
    else if (R && e.key === R.LINK_KEY) {
      // Посилання створили чи закрили в основному пульті.
      var l = R.loadLink(localStorage);
      if (!l !== !link || (l && l.room !== link.room)) connectLink(l);
    }
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
  setView(initialView(), false);
  render();
  if (R) connectLink(R.loadLink(localStorage));
  if (channel) channel.postMessage({ type: "hello" });
  U.keepAwake();
  U.registerSW();
})();
