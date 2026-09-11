/* Інтерфейс табло. Уся логіка матчу — у match.js, тут лише екран і жести. */
(function () {
  "use strict";

  var M = window.Match;
  var KEY = "volleyball:match";
  var PREF = "volleyball:prefs";
  var TIMEOUT_SEC = 30;

  /* Кольори половин. ink — колір тексту, що читається на цьому фоні. */
  var PALETTES = [
    { id: "classic", label: "синій / бурштин",  a: "#1668C9", b: "#F5A310", inkA: "#FFFFFF", inkB: "#0A1F30" },
    { id: "court",   label: "червоний / бірюза", a: "#E03127", b: "#17B0A6", inkA: "#FFFFFF", inkB: "#04221F" },
    { id: "neon",    label: "фіолет / лайм",     a: "#7B3FE4", b: "#BEF224", inkA: "#FFFFFF", inkB: "#1A2405" },
    { id: "kit",     label: "малина / трава",    a: "#D61C6B", b: "#3FA82B", inkA: "#FFFFFF", inkB: "#FFFFFF" }
  ];

  function paletteById(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  function applyPalette(id) {
    var p = paletteById(id);
    var root = document.documentElement.style;
    root.setProperty("--team-a", p.a);
    root.setProperty("--team-b", p.b);
    root.setProperty("--ink-a", p.inkA);
    root.setProperty("--ink-b", p.inkB);
  }

  var match = M.createMatch();
  var prefs = { vibrate: true, timeoutSec: TIMEOUT_SEC, palette: PALETTES[0].id };
  var rotTimer = null, toTimer = null, toEndsAt = 0;

  function $(id) { return document.getElementById(id); }

  /* ---------- збереження ---------- */

  function save() {
    try {
      var raw = M.serialize(match);
      if (window.storage) window.storage.set(KEY, raw, false);
      else localStorage.setItem(KEY, raw);
    } catch (e) {}
  }

  function savePrefs() {
    try {
      var raw = JSON.stringify(prefs);
      if (window.storage) window.storage.set(PREF, raw, false);
      else localStorage.setItem(PREF, raw);
    } catch (e) {}
  }

  function load() {
    function applyMatch(raw) {
      try {
        var m = M.deserialize(raw);
        if (m) match = m;
      } catch (e) {}
    }
    function applyPrefs(raw) {
      try {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") {
          if (typeof p.vibrate === "boolean") prefs.vibrate = p.vibrate;
          if (typeof p.timeoutSec === "number") prefs.timeoutSec = p.timeoutSec;
          if (typeof p.palette === "string") prefs.palette = paletteById(p.palette).id;
        }
      } catch (e) {}
    }

    if (window.storage) {
      Promise.all([
        window.storage.get(KEY, false).catch(function () { return null; }),
        window.storage.get(PREF, false).catch(function () { return null; })
      ]).then(function (res) {
        if (res[0] && res[0].value) applyMatch(res[0].value);
        if (res[1] && res[1].value) applyPrefs(res[1].value);
        applyPalette(prefs.palette);
        render();
      });
      return;
    }
    try {
      applyMatch(localStorage.getItem(KEY));
      applyPrefs(localStorage.getItem(PREF));
    } catch (e) {}
    applyPalette(prefs.palette);
    render();
  }

  /* ---------- дії ---------- */

  function commit(next, opts) {
    var before = M.reduce(match);
    match = next;
    var after = M.reduce(match);
    render();
    save();
    if (opts && opts.feedback) feedback(before, after);
  }

  function pointOnSide(side) {
    var s = M.reduce(match);
    if (s.done) return;
    commit(M.addPoint(match, M.teamOnSide(s, side)), { feedback: true });
  }

  function takeBackOnSide(side) {
    var s = M.reduce(match);
    var team = M.teamOnSide(s, side);
    if (s.done || s.points[team] === 0) return;
    commit(M.removeLastPoint(match, team));
  }

  function timeoutOnSide(side) {
    var s = M.reduce(match);
    var team = M.teamOnSide(s, side);
    if (s.done || s.timeouts[team] <= 0) return;
    commit(M.callTimeout(match, team));
    startTimeoutClock(s.names[team]);
  }

  function feedback(before, after) {
    var lp = after.lastPoint;
    if (!lp) return;
    if (prefs.vibrate && navigator.vibrate) {
      navigator.vibrate(lp.closedMatch ? [80, 60, 80, 60, 160] : lp.closedSet ? [60, 50, 120] : 14);
    }
    if (lp.sideOut && !lp.closedSet) flashRotation(lp.team, after);
  }

  function flashRotation(team, s) {
    var side = s.flipped ? 1 - team : team;
    var on = $(side === 0 ? "rotA" : "rotB");
    var off = $(side === 0 ? "rotB" : "rotA");
    off.classList.remove("on");
    on.classList.add("on");
    clearTimeout(rotTimer);
    rotTimer = setTimeout(function () { on.classList.remove("on"); }, 2200);
  }

  /* ---------- годинник тайм-ауту ---------- */

  function startTimeoutClock(name) {
    toEndsAt = Date.now() + prefs.timeoutSec * 1000;
    $("toWho").textContent = "Тайм-аут · " + name;
    $("toOverlay").classList.add("show");
    tickTimeout();
  }

  function tickTimeout() {
    clearTimeout(toTimer);
    var left = Math.max(0, Math.round((toEndsAt - Date.now()) / 1000));
    $("toClock").textContent = left;
    if (left <= 0) {
      if (prefs.vibrate && navigator.vibrate) navigator.vibrate([120, 80, 120]);
      setTimeout(stopTimeoutClock, 600);
      return;
    }
    toTimer = setTimeout(tickTimeout, 250);
  }

  function stopTimeoutClock() {
    clearTimeout(toTimer);
    $("toOverlay").classList.remove("show");
  }

  /* ---------- малювання ---------- */

  function fmtClock(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60), sec = total % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function pips(node, won, total) {
    node.innerHTML = "";
    for (var k = 0; k < total; k++) {
      var d = document.createElement("span");
      d.className = "pip" + (k < won ? " won" : "");
      node.appendChild(d);
    }
  }

  function dots(n, of) {
    var out = "";
    for (var i = 0; i < of; i++) out += i < n ? "●" : "○";
    return out;
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function render() {
    var s = M.reduce(match);
    var sides = [M.teamOnSide(s, 0), M.teamOnSide(s, 1)];
    var tags = ["A", "B"];

    for (var side = 0; side < 2; side++) {
      var team = sides[side], t = tags[side];
      $("name" + t).textContent = s.names[team];
      $("score" + t).textContent = s.points[team];
      $("serve" + t).className = "serve" + (s.serving === team ? " on" : "");

      if (s.rules.bestOf > 1) pips($("pips" + t), s.sets[team], s.setsNeeded);
      else $("pips" + t).innerHTML = "";

      var to = $("to" + t);
      to.textContent = "тайм-аут " + dots(s.timeouts[team], s.rules.timeouts);
      var toOff = s.done || s.timeouts[team] === 0;
      to.classList.toggle("off", toOff);          // span не має disabled — клас
      to.setAttribute("aria-disabled", String(toOff));
      $("minus" + t).style.visibility = s.points[team] > 0 && !s.done ? "visible" : "hidden";
    }

    $("clock").textContent = s.startedAt === null ? "0:00" : fmtClock(M.durationMs(s));
    $("setsLog").textContent = s.setLog.length
      ? s.setLog.map(function (set) {
          return s.flipped ? set.points[1] + "–" + set.points[0] : set.points[0] + "–" + set.points[1];
        }).join("  ·  ")
      : "матч ще не почався";
    $("matchFmt").innerHTML = s.rules.bestOf > 1
      ? '<b class="ca">' + s.sets[sides[0]] + "</b>:" + '<b class="cb">' + s.sets[sides[1]] + "</b>"
      : "один сет";

    var info = s.rules.bestOf > 1
      ? s.setNumber + "-й сет · до " + s.target
      : "до " + s.target;
    var hint = "";
    if (M.sideSwapDue(s)) hint = "час міняти сторони";
    var mp = M.matchPointFor(s), sp = M.setPointFor(s);
    if (mp !== null) hint = "матчбол · " + s.names[mp];
    else if (sp !== null) hint = "сетбол · " + s.names[sp];
    $("netInfo").innerHTML = esc(info) + (hint ? "<small>" + esc(hint) + "</small>" : "");

    $("undoBtn").disabled = !M.canUndo(match);
    $("redoBtn").disabled = !M.canRedo(match);

    if (s.done) {
      $("finalWho").textContent = s.names[s.winner] + " виграла";
      $("finalWho").className = "who " + (M.teamOnSide(s, 0) === s.winner ? "ca" : "cb");
      $("finalTally").textContent = s.sets[0] + ":" + s.sets[1] + "  ·  " +
        s.setLog.map(function (set) { return set.points[0] + "–" + set.points[1]; }).join("  ·  ") +
        "  ·  " + fmtClock(M.durationMs(s));
      $("final").classList.add("show");
    } else {
      $("final").classList.remove("show");
    }

    $("live").textContent = s.names[0] + " " + s.points[0] + ", " + s.names[1] + " " + s.points[1];
  }

  /* Годинник матчу цокає окремо від дій. */
  setInterval(function () {
    var s = M.reduce(match);
    if (!s.done && s.startedAt !== null) $("clock").textContent = fmtClock(M.durationMs(s));
  }, 1000);

  /* ---------- вікна ---------- */

  function openSheet(id) {
    closeSheets();
    $(id).classList.add("show");
  }
  function closeSheets() {
    if ($("sheet").classList.contains("show") && pendingPalette !== prefs.palette) {
      applyPalette(prefs.palette);   // закрили без збереження — вертаємо колір
      pendingPalette = prefs.palette;
    }
    ["menu", "sheet", "proto", "serveAsk"].forEach(function (id) { $(id).classList.remove("show"); });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".sheet"), function (el) {
    el.addEventListener("click", function (e) { if (e.target === el) closeSheets(); });
  });

  /* ---------- протокол ---------- */

  function renderProtocol() {
    var p = M.protocol(match);
    var s = M.reduce(match);
    var rows = "";

    p.setLog.forEach(function (set, i) {
      var lead = set.winner === 0 ? "ca" : "cb";
      rows += "<tr><td>" + (i + 1) + "</td>" +
        cell(set.points[0], "ca", set.winner === 0) + cell(set.points[1], "cb", set.winner === 1) +
        "<td>" + set.rallies + "</td><td>" + Math.round(set.durationMs / 60000) + " хв</td></tr>";
    });
    if (p.current && (p.current.points[0] || p.current.points[1])) {
      rows += "<tr class=\"live\"><td>" + p.current.setNumber + "</td>" +
        cell(p.current.points[0], "ca") + cell(p.current.points[1], "cb") +
        "<td>" + s.setRallies + "</td><td>триває</td></tr>";
    }
    if (!rows) rows = "<tr><td colspan=\"5\">Ще жодного розіграшу</td></tr>";

    $("protoHead").textContent = esc(p.names[0]) + " — " + esc(p.names[1]) + "  ·  " +
      p.sets[0] + ":" + p.sets[1] + "  ·  " + fmtClock(p.durationMs);
    $("protoSets").innerHTML =
      "<tr><th>сет</th>" +
      "<th class=\"ca\">" + esc(p.names[0]) + "</th><th class=\"cb\">" + esc(p.names[1]) + "</th>" +
      "<th>розіграшів</th><th>час</th></tr>" + rows;

    $("protoStats").innerHTML = [
      statRow("Виграно очок", p.stats.pointsWon),
      statRow("Найдовша серія", p.stats.bestStreak),
      statRow("Найбільший відрив", p.stats.biggestLead),
      statRow("Тайм-аутів узято", p.stats.timeoutsUsed)
    ].join("");

    var trail = M.rallyTrail(match, Math.max(0, p.setLog.length));
    $("protoTrail").textContent = trail.length
      ? trail.map(function (x) { return x[0] + ":" + x[1]; }).join("  ")
      : "—";
  }

  function statRow(label, pair) {
    return "<tr><th>" + esc(label) + "</th>" +
      cell(pair[0], "ca", pair[0] > pair[1]) + cell(pair[1], "cb", pair[1] > pair[0]) + "</tr>";
  }

  /* Клітинка рахунку: колір команди, жирна — якщо ця сторона попереду. */
  function cell(value, cls, strong) {
    return "<td class=\"" + cls + "\">" + (strong ? "<b>" + value + "</b>" : value) + "</td>";
  }

  function downloadCSV() {
    var s = M.reduce(match);
    var blob = new Blob(["\uFEFF" + M.toCSV(match)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "протокол-" + s.names[0] + "-" + s.names[1] + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyProtocol() {
    var text = JSON.stringify(M.protocol(match), null, 2);
    var done = function () {
      var b = $("protoCopy");
      b.textContent = "Скопійовано";
      setTimeout(function () { b.textContent = "Копіювати JSON"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    }
  }

  /* ---------- налаштування ---------- */

  var pendingBestOf = null;

  function openSettings() {
    var s = M.reduce(match);
    $("inNameA").value = s.names[0];
    $("inNameB").value = s.names[1];
    $("inTarget").value = s.rules.target;
    $("inDecider").value = s.rules.decider;
    $("inCap").value = s.rules.cap || "";
    $("inTimeouts").value = s.rules.timeouts;
    $("inVibrate").checked = prefs.vibrate;
    paintPalettes();
    pendingBestOf = s.rules.bestOf;
    paintSeg();
    openSheet("sheet");
  }

  var pendingPalette = null;

  function paintPalettes() {
    if (pendingPalette === null) pendingPalette = prefs.palette;
    var box = $("palettes");
    box.innerHTML = "";
    PALETTES.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pal";
      b.title = p.label;
      b.setAttribute("aria-label", p.label);
      b.setAttribute("aria-pressed", String(p.id === pendingPalette));
      b.dataset.pal = p.id;
      b.innerHTML = '<i style="background:' + p.a + '"></i><i style="background:' + p.b + '"></i>';
      b.addEventListener("click", function () {
        pendingPalette = p.id;
        applyPalette(p.id);          // видно одразу, ще до збереження
        paintPalettes();
      });
      box.appendChild(b);
    });
  }

  function paintSeg() {
    Array.prototype.forEach.call($("segFmt").children, function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.bo) === pendingBestOf));
    });
  }

  function num(el, lo, hi, fallback) {
    var n = parseInt(el.value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function applySettings() {
    var next = match;
    next = M.rename(next, 0, $("inNameA").value.trim() || "Команда А");
    next = M.rename(next, 1, $("inNameB").value.trim() || "Команда Б");

    var cap = $("inCap").value.trim() === "" ? 0 : num($("inCap"), 0, 199, 0);
    var D = M.DEFAULT_RULES;
    var target = num($("inTarget"), 3, 99, D.target);
    var decider = num($("inDecider"), 3, 99, D.decider);
    next = M.setRules(next, {
      target: target,
      decider: decider,
      cap: cap,
      capDecider: cap ? Math.max(0, cap - (target - decider)) : 0,
      timeouts: num($("inTimeouts"), 0, 5, D.timeouts),
      bestOf: pendingBestOf
    });

    // Зміна формату перекроює сітку сетів — починаємо матч наново.
    if (pendingBestOf !== M.reduce(match).rules.bestOf) next = M.restart(next);

    prefs.vibrate = $("inVibrate").checked;
    if (pendingPalette) prefs.palette = pendingPalette;
    applyPalette(prefs.palette);
    savePrefs();
    closeSheets();
    commit(next);
  }

  /* ---------- події ---------- */

  $("sideA").addEventListener("click", function () { pointOnSide(0); });
  $("sideB").addEventListener("click", function () { pointOnSide(1); });
  $("minusA").addEventListener("click", function (e) { e.stopPropagation(); takeBackOnSide(0); });
  $("minusB").addEventListener("click", function (e) { e.stopPropagation(); takeBackOnSide(1); });
  $("toA").addEventListener("click", function (e) { e.stopPropagation(); timeoutOnSide(0); });
  $("toB").addEventListener("click", function (e) { e.stopPropagation(); timeoutOnSide(1); });

  $("undoBtn").addEventListener("click", function () { commit(M.undo(match)); });
  $("redoBtn").addEventListener("click", function () { commit(M.redo(match)); });
  $("menuBtn").addEventListener("click", function () { openSheet("menu"); });

  $("toStop").addEventListener("click", stopTimeoutClock);

  $("mProto").addEventListener("click", function () { renderProtocol(); openSheet("proto"); });
  $("mSettings").addEventListener("click", openSettings);
  $("mSwap").addEventListener("click", function () { closeSheets(); commit(M.swapSides(match)); });
  $("mServe").addEventListener("click", function () {
    var s = M.reduce(match);
    $("serveA_btn").textContent = s.names[0];
    $("serveB_btn").textContent = s.names[1];
    openSheet("serveAsk");
  });
  $("serveA_btn").addEventListener("click", function () { closeSheets(); commit(M.setServer(match, 0)); });
  $("serveB_btn").addEventListener("click", function () { closeSheets(); commit(M.setServer(match, 1)); });

  $("mNew").addEventListener("click", function () {
    var s = M.reduce(match);
    if ((s.rallies || s.setLog.length) && !confirm("Почати новий матч? Поточний рахунок зникне.")) return;
    closeSheets();
    commit(M.restart(match));
  });

  $("protoCSV").addEventListener("click", downloadCSV);
  $("protoCopy").addEventListener("click", copyProtocol);

  $("sheetSave").addEventListener("click", applySettings);
  $("sheetReset").addEventListener("click", function () {
    if (!confirm("Обнулити рахунок матчу?")) return;
    closeSheets();
    commit(M.restart(match));
  });
  $("segFmt").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    pendingBestOf = Number(b.dataset.bo);
    paintSeg();
  });

  $("finalNew").addEventListener("click", function () { commit(M.restart(match)); });
  $("finalUndo").addEventListener("click", function () { commit(M.undo(match)); });
  $("finalProto").addEventListener("click", function () { renderProtocol(); openSheet("proto"); });

  document.addEventListener("keydown", function (e) {
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === "escape") { closeSheets(); stopTimeoutClock(); }
    else if (k === "1") pointOnSide(0);
    else if (k === "2") pointOnSide(1);
    else if (k === "q") timeoutOnSide(0);
    else if (k === "p") timeoutOnSide(1);
    else if (k === "backspace") { e.preventDefault(); commit(e.shiftKey ? M.redo(match) : M.undo(match)); }
  });

  /* повний екран */
  var fsBtn = $("mFullscreen");
  if (document.documentElement.requestFullscreen) {
    fsBtn.addEventListener("click", function () {
      closeSheets();
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    });
    document.addEventListener("fullscreenchange", function () {
      fsBtn.textContent = document.fullscreenElement ? "Вийти з повного екрана" : "На весь екран";
    });
  } else {
    fsBtn.style.display = "none";
  }

  /* екран не гасне */
  var lock = null;
  function keepAwake() {
    try {
      if ("wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then(function (l) {
          lock = l;
          l.addEventListener("release", function () { lock = null; });
        }).catch(function () {});
      }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !lock) keepAwake();
  });
  keepAwake();

  /* офлайн */
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }

  load();
})();
