/* Інтерфейс табло. Уся логіка матчу — у match.js, тут лише екран і жести. */
(function () {
  "use strict";

  var M = window.Match;
  var U = window.UI;
  var KEY = "volleyball:match";
  var PREF = "volleyball:prefs";
  var TIMEOUT_SEC = 30;

  /* Кольори половин — спільні з табло для глядачів, див. palettes.js. */
  var PALETTES = window.Palettes.list;
  var paletteById = window.Palettes.byId;

  function applyPalette(id) {
    window.Palettes.apply(document.documentElement, id);
  }

  /*
   * Звʼязок із табло для глядачів (display.html) на цьому ж пристрої.
   * Основний канал — сам localStorage: інші вікна отримують подію storage.
   * BroadcastChannel додає те, чого в сховищі немає, і відповідає вікну,
   * яке щойно відкрилось.
   */
  var channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("volleyball") : null;
  function post(msg) {
    if (!channel) return;
    try { channel.postMessage(msg); } catch (e) {}
  }

  var match = M.createMatch();
  var prefs = { vibrate: true, timeoutSec: TIMEOUT_SEC, palette: PALETTES[0].id, showServe: true, sound: true };
  var rotTimer = null, toTimer = null, toEndsAt = 0;

  function $(id) { return document.getElementById(id); }

  /* ---------- збереження ---------- */

  /* fromRemote — зміна прийшла з іншого пульта: зберігаємо, але назад не надсилаємо. */
  function save(fromRemote) {
    try {
      var raw = M.serialize(match);
      if (window.storage) window.storage.set(KEY, raw, false);
      else localStorage.setItem(KEY, raw);
      post({ type: "state", match: raw });
      if (!fromRemote) linkSend({ type: "state", match: raw });
    } catch (e) {}
  }

  function savePrefs(fromRemote) {
    try {
      var raw = JSON.stringify(prefs);
      if (window.storage) window.storage.set(PREF, raw, false);
      else localStorage.setItem(PREF, raw);
      post({ type: "prefs", prefs: prefs });
      if (!fromRemote) linkSend({ type: "prefs", prefs: prefs });
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
          if (typeof p.showServe === "boolean") prefs.showServe = p.showServe;
          if (typeof p.sound === "boolean") prefs.sound = p.sound;
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
    startTimeoutClock("Тайм-аут · " + s.names[team]);
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

  function startTimeoutClock(label, endsAt) {
    toEndsAt = endsAt || Date.now() + prefs.timeoutSec * 1000;
    $("toWho").textContent = label;
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

  function stopTimeoutClock(fromRemote) {
    clearTimeout(toTimer);
    if ($("toOverlay").classList.contains("show")) {
      var lt = M.reduce(match).lastTimeout;
      post({ type: "timeout-end", ts: lt ? lt.ts : null });
      if (fromRemote !== true) linkSend({ type: "timeout-end", ts: lt ? lt.ts : null });
    }
    $("toOverlay").classList.remove("show");
  }

  /* ---------- малювання ---------- */

  function dots(n, of) {
    var out = "";
    for (var i = 0; i < of; i++) out += i < n ? "●" : "○";
    return out;
  }

  /* «N-й сет · до M» → неподільні частини; в альбомі кожна стає окремим рядком. */
  function lines(text) {
    return text.split(" · ").map(function (part) {
      return '<span class="ln">' + U.esc(part) + "</span>";
    }).join('<span class="sep"> · </span>');
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

      if (s.rules.bestOf > 1) U.pips($("pips" + t), s.sets[team], s.setsNeeded);
      else $("pips" + t).innerHTML = "";

      var to = $("to" + t);
      to.textContent = "тайм-аут " + dots(s.timeouts[team], s.rules.timeouts);
      var toOff = s.done || s.timeouts[team] === 0;
      to.classList.toggle("off", toOff);          // span не має disabled — клас
      to.setAttribute("aria-disabled", String(toOff));
      $("minus" + t).style.visibility = s.points[team] > 0 && !s.done ? "visible" : "hidden";
    }

    $("clock").textContent = s.startedAt === null ? "0:00" : U.fmtClock(M.durationMs(s));
    $("setsLog").textContent = s.setLog.length
      ? s.setLog.map(function (set) {
          return s.flipped ? set.points[1] + "–" + set.points[0] : set.points[0] + "–" + set.points[1];
        }).join("  ·  ")
      : "почати матч";
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
    // « · » в альбомі стає переносом: сітка там вузька, і рядок інакше ламається будь-де.
    $("netInfo").innerHTML = lines(info) + (hint ? "<small>" + lines(hint) + "</small>" : "");

    $("techBtn").classList.toggle("on", M.techTimeoutDue(s));
    $("undoBtn").disabled = !M.canUndo(match);
    $("redoBtn").disabled = !M.canRedo(match);

    if (s.done) {
      $("finalWho").textContent = s.names[s.winner] + " виграла";
      $("finalWho").className = "who " + (M.teamOnSide(s, 0) === s.winner ? "ca" : "cb");
      $("finalTally").textContent = s.sets[0] + ":" + s.sets[1] + "  ·  " +
        s.setLog.map(function (set) { return set.points[0] + "–" + set.points[1]; }).join("  ·  ") +
        "  ·  " + U.fmtClock(M.durationMs(s));
      $("final").classList.add("show");
    } else {
      $("final").classList.remove("show");
    }

    $("live").textContent = s.names[0] + " " + s.points[0] + ", " + s.names[1] + " " + s.points[1];
  }

  /* Годинник матчу цокає окремо від дій. */
  setInterval(function () {
    var s = M.reduce(match);
    if (!s.done && s.startedAt !== null) $("clock").textContent = U.fmtClock(M.durationMs(s));
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
    ["menu", "sheet", "proto", "serveAsk", "subsSheet", "linkSheet"].forEach(function (id) { $(id).classList.remove("show"); });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".sheet"), function (el) {
    el.addEventListener("click", function (e) { if (e.target === el) closeSheets(); });
  });

  /* ---------- табло для глядачів ---------- */

  var DISPLAY_URL = "./display.html";
  var DISPLAY_LABEL = "Табло для глядачів";

  /*
   * Відкриває табло окремим вікном. Якщо підключено другий екран (проєктор,
   * ТБ) і браузер уміє Window Management API, вікно одразу стає на нього
   * на весь робочий простір. Інакше — звичайне вікно 1280×720.
   */
  function displayFeatures(screens, current) {
    var other = null;
    for (var i = 0; screens && i < screens.length; i++) {
      if (screens[i] !== current && !screens[i].isPrimary) { other = screens[i]; break; }
    }
    if (!other && screens) for (var k = 0; k < screens.length; k++) if (screens[k] !== current) { other = screens[k]; break; }
    if (!other) return "popup,width=1280,height=720";
    return "popup,left=" + other.availLeft + ",top=" + other.availTop +
      ",width=" + other.availWidth + ",height=" + other.availHeight;
  }

  function openDisplay() {
    var btn = $("mDisplay");
    function open(features) {
      var w = window.open(DISPLAY_URL, "volley-display", features);
      if (w) { closeSheets(); return; }
      // Спливні вікна заблоковані — не йдемо з пульта, а підказуємо.
      btn.textContent = "Дозвольте спливні вікна для цього сайту";
      setTimeout(function () { btn.textContent = displayLabel(); }, 3200);
    }
    if (window.screen && window.screen.isExtended && typeof window.getScreenDetails === "function") {
      window.getScreenDetails()
        .then(function (d) { open(displayFeatures(d.screens, d.currentScreen)); })
        .catch(function () { open(displayFeatures(null)); });
    } else {
      open(displayFeatures(null));
    }
  }

  function displayLabel() {
    return window.screen && window.screen.isExtended ? DISPLAY_LABEL + " → на другий екран" : DISPLAY_LABEL;
  }

  /* ---------- заміни й картки ---------- */

  var CARD_LABEL = { yellow: "жовта", red: "червона", expulsion: "вилучення", disqualification: "дискваліфікація" };
  var subsTeam = 0;

  /* Журнал замін і карток, новіші зверху. */
  function eventLines(s) {
    var all = s.subLog.map(function (x) { return { x: x, sub: true }; })
      .concat(s.cards.map(function (c) { return { x: c, sub: false }; }))
      .sort(function (a, b) { return b.x.ts - a.x.ts; });
    if (!all.length) return '<span class="muted">Замін і карток ще не було</span>';
    return all.map(function (e) {
      var x = e.x;
      var what = e.sub
        ? "заміна " + U.esc(x.out) + " → " + U.esc(x["in"])
        : "картка: " + CARD_LABEL[x.kind] + (x.player ? " · №" + U.esc(x.player) : "");
      return '<div><span class="muted">' + x.set + "-й сет " + x.score[0] + ":" + x.score[1] + "</span> · " +
        '<b class="' + (x.team === 0 ? "ca" : "cb") + '">' + U.esc(s.names[x.team]) + "</b> · " + what + "</div>";
    }).join("");
  }

  function paintSubs() {
    var s = M.reduce(match);
    $("teamBtnA").textContent = s.names[0];
    $("teamBtnB").textContent = s.names[1];
    Array.prototype.forEach.call($("segTeam").children, function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.team) === subsTeam));
    });
    var limit = s.rules.subs || 0;
    $("subBox").style.display = limit ? "" : "none";       // на пляжі замін немає
    $("subCount").textContent = "замін у сеті: " + s.subsUsed[subsTeam] + " з " + limit;
    $("subBtn").disabled = s.done || s.subsUsed[subsTeam] >= limit;
    $("evLog").innerHTML = eventLines(s);
  }

  function openSubs() {
    var s = M.reduce(match);
    // За замовчуванням — команда, що зараз на першій половині.
    subsTeam = M.teamOnSide(s, 0);
    $("inSubOut").value = $("inSubIn").value = $("inCardPlayer").value = "";
    paintSubs();
    openSheet("subsSheet");
  }

  function doSub() {
    var next = M.substitute(match, subsTeam, $("inSubOut").value, $("inSubIn").value);
    if (next === match) {
      $("subCount").textContent = "вкажіть два різні номери";
      return;
    }
    commit(next);
    $("inSubOut").value = $("inSubIn").value = "";
    paintSubs();
  }

  function doCard(kind) {
    var before = M.reduce(match);
    var next = M.giveCard(match, subsTeam, kind, $("inCardPlayer").value);
    if (next === match) return;
    commit(next, { feedback: kind === "red" });
    $("inCardPlayer").value = "";
    if (M.reduce(match).done && !before.done) closeSheets();
    else paintSubs();
  }

  /* ---------- посилання на матч: міні-табло й пульт для другого судді ---------- */

  /*
   * Обидва посилання працюють через сервер синхронізації (server.js):
   *   • міні-табло (live.html?room=…) — назви команд, сети й очки, лише перегляд;
   *   • пульт для другого судді (index.html?room=…&key=…) — той самий матч,
   *     керування з іншого телефона.
   * Код кімнати й ключ судді лежать окремо від налаштувань: налаштування
   * летять на міні-табло, а ключ — лише в пультах. Пульти рівноправні:
   * діє стан того, хто змінив рахунок останнім.
   */
  var LINK_KEY = "volleyball:link";
  var R = window.Remote;
  var link = null;            // { server, room, key, guest }
  var linkConn = null;
  var LINK_LONG_MS = 45000;   // стільки чекаємо (Render прокидається до хвилини), перш ніж пояснювати
  var linkLostAt = 0;         // відколи немає звʼязку (0 — є або посилання вимкнене)
  var linkLostTimer = null;
  var linkWhy = "";           // причина відмови сервера (rejected)
  var linkProbe = "";         // що відповів сервер на /healthz: "", "checking", "ok", "static", "down"

  function loadLink() {
    try {
      var l = JSON.parse(localStorage.getItem(LINK_KEY) || "null");
      if (l && R.isRoom(l.room) && l.key && l.server) link = l;
    } catch (e) {}
  }
  function saveLink() {
    try {
      if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link));
      else localStorage.removeItem(LINK_KEY);
    } catch (e) {}
  }

  function linkSend(msg) {
    if (linkConn) linkConn.send(msg);
  }

  /* Пульт, що створив посилання, після (пере)підключення надсилає весь стан. */
  function linkSendAll() {
    linkSend({ type: "state", match: M.serialize(match) });
    linkSend({ type: "prefs", prefs: prefs });
  }

  var LINK_TEXT = {
    connecting: "підключення до сервера…", live: "на звʼязку", offline: "немає звʼязку — перепідключаюсь",
    rejected: "сервер відмовив — посилання недійсне", closed: ""
  };

  function linkStatus(status, info) {
    trackLinkLoss(status, info);
    // Другий суддя нічого не надсилає при підключенні — він отримує матч від сервера.
    if (status === "live" && !link.guest) linkSendAll();
    if (status === "rejected" && info === "wrong-key" && !link.guest) {
      link.room = R.newRoom();                      // код зайняв хтось інший — беремо новий
      saveLink();
      setTimeout(startLinkConn, 0);
    }
    paintLink(status);
  }

  /*
   * Матч, змінений деінде: на пульті другого судді (fromRemote — назад на сервер
   * не надсилаємо) або в міні-пульті в сусідній вкладці (пересилаємо на сервер,
   * щоб другий суддя й міні-табло теж побачили).
   */
  function takeState(raw, fromRemote) {
    if (!raw || raw === M.serialize(match)) return;      // уже маємо — без луни
    var m;
    try { m = M.deserialize(raw); } catch (e) { return; }
    if (!m) return;
    var before = M.reduce(match);
    match = m;
    render();
    save(fromRemote);
    var after = M.reduce(match);
    var lt = after.lastTimeout;
    if (lt && !after.done && (!before.lastTimeout || before.lastTimeout.ts !== lt.ts)) {
      var endsAt = lt.ts + prefs.timeoutSec * 1000;
      if (endsAt > Date.now()) startTimeoutClock(lt.tech ? "Технічний тайм-аут" : "Тайм-аут · " + after.names[lt.team], endsAt);
    }
  }

  /* Зміни з іншого пульта через сервер: приймаємо, але назад не надсилаємо. */
  function adoptRemote(msg) {
    if (msg.type === "state" && msg.match) {
      takeState(msg.match, true);
    } else if (msg.type === "prefs" && msg.prefs) {
      var p = msg.prefs;
      if (typeof p.palette === "string") prefs.palette = paletteById(p.palette).id;
      if (typeof p.showServe === "boolean") prefs.showServe = p.showServe;
      if (typeof p.sound === "boolean") prefs.sound = p.sound;
      applyPalette(prefs.palette);
      savePrefs(true);
      render();
    } else if (msg.type === "timeout-end") {
      stopTimeoutClock(true);
    }
  }

  function startLinkConn() {
    if (linkConn) linkConn.close();
    linkConn = R.connect({
      server: link.server, room: link.room, role: "control", key: link.key,
      WebSocket: window.WebSocket,
      onStatus: linkStatus,
      onMessage: adoptRemote
    });
  }

  function normServer(v) {
    v = String(v || "").trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    return /^https?:\/\/[^\s/]+/i.test(v) ? v : "";
  }

  function createLink() {
    var server = normServer($("inLinkServer").value);
    if (!server) { $("linkErr").textContent = "Вкажіть адресу сервера, наприклад https://назва.onrender.com"; return; }
    $("linkErr").textContent = "";
    link = { server: server, room: R.newRoom(), key: R.newKey(), guest: false };
    saveLink();
    startLinkConn();
  }

  function closeLink() {
    if (linkConn) linkConn.close();
    linkConn = null;
    link = null;
    trackLinkLoss("closed");
    saveLink();
    paintLink("closed");
  }

  /* Відкрили посилання «пульт для другого судді» — підключаємось до того ж матчу. */
  function joinFromUrl() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var room = (q.get("room") || "").toUpperCase();
    var key = q.get("key") || "";
    if (!R.isRoom(room) || !key) return;
    link = { server: normServer(q.get("server")) || R.defaultServer(location), room: room, key: key, guest: true };
    saveLink();
    // Ключ не лишаємо в адресному рядку, щоб його випадково не переслали далі.
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }

  function boardUrl() { return R.viewerLink(link.server, "live.html", link.room); }
  function judgeUrl() { return R.viewerLink(link.server, "index.html", link.room, "key=" + encodeURIComponent(link.key)); }

  /* Відлік часу без звʼязку: після LINK_LONG_MS пульт пояснює, що сталося. */
  function trackLinkLoss(status, info) {
    linkWhy = status === "rejected" ? (info || "") : "";
    if (status === "live" || status === "closed") {
      linkLostAt = 0;
      linkProbe = "";
      clearTimeout(linkLostTimer);
      return;
    }
    if (!linkLostAt) {
      linkLostAt = Date.now();
      clearTimeout(linkLostTimer);
      linkLostTimer = setTimeout(function () { paintLink(); }, LINK_LONG_MS + 50);
    }
  }

  /*
   * Звʼязку довго немає — питаємо сервер напряму. Сайт відповідає, а /healthz — ні:
   * на хостингу лежить лише статика (напр., Static Site на Render), сервера посилань немає.
   */
  function probeServer() {
    if (!link || typeof fetch !== "function" || linkProbe) return;
    var server = link.server;
    linkProbe = "checking";
    fetch(server.replace(/\/+$/, "") + "/healthz", { cache: "no-store" }).then(function (r) {
      if (r.ok) return r.json().then(function (j) { return j && j.ok ? "ok" : "static"; }, function () { return "static"; });
      return r.status === 404 ? "static" : "down";
    }, function () { return "down"; }).then(function (res) {
      if (!link || link.server !== server || !linkLostAt) return;
      linkProbe = res;
      paintLink();
    });
  }

  function linkTrouble(status) {
    if (!link) return false;
    if (status === "rejected") return true;
    return status !== "live" && linkLostAt > 0 && Date.now() - linkLostAt >= LINK_LONG_MS;
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return String(url || ""); }
  }

  /* Найімовірніші причини — від конкретних до загальних. */
  function troubleReasons(status) {
    var why = [];
    if (status === "rejected") {
      why.push(linkWhy === "wrong-key"
        ? "Ключ судді не підходить — посилання застаріле або матч уже закрили."
        : linkWhy === "full"
          ? "Сервер перевантажений — забагато відкритих матчів. Спробуйте пізніше."
          : "Сервер відмовив у підключенні — це посилання більше не дійсне.");
      why.push("Зупиніть посилання й створіть нове.");
      return why;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      why.push("Пристрій не в інтернеті — перевірте Wi-Fi або мобільні дані.");
    }
    if (location.protocol === "file:") {
      why.push("Сайт відкрито як файл із комп'ютера — посилання працюють лише з адреси сервера.");
    } else if (/^https?:$/.test(location.protocol) && hostOf(link.server) !== location.host) {
      why.push("Посилання створене для сервера " + hostOf(link.server) + ", а сайт відкрито з " + location.host +
        ". Якщо сервер змінився — зупиніть посилання й створіть нове.");
    }
    if (linkProbe === "static") {
      why.unshift("Сайт на " + hostOf(link.server) + " працює, але сервера посилань там немає — розгорнуто лише статичні файли. " +
        "На Render потрібен Web Service (Node, команда запуску «node server.js»), а не Static Site.");
      return why;
    }
    if (linkProbe === "ok") {
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

  function paintLink(status) {
    status = status || (linkConn ? linkConn.status() : "closed");
    var on = !!link;
    $("linkSheet").classList.toggle("on", on);
    var dot = $("linkDot");
    var trouble = linkTrouble(status);
    dot.className = "link-dot" + (on ? (status === "live" ? " live" : " offline") : "") + (trouble ? " trouble" : "");
    dot.textContent = on ? (status === "live" ? "на звʼязку" : trouble ? "немає звʼязку ?" : "немає звʼязку") : "";
    dot.setAttribute("role", trouble ? "button" : "status");
    dot.title = trouble ? "Що сталося і що робити" : "";
    dot.tabIndex = trouble ? 0 : -1;
    $("linkTrouble").classList.toggle("on", trouble);
    if (trouble && status !== "rejected") probeServer();
    if (!on) {
      $("inLinkServer").value = $("inLinkServer").value || R.defaultServer(location);
      return;
    }
    var st = $("linkStatus");
    st.className = "link-status " + status;
    st.textContent = (LINK_TEXT[status] || "") + (link.guest ? " · ви — другий суддя" : "") + " · код " + link.room;
    var b = boardUrl(), j = judgeUrl();
    $("linkBoard").textContent = b;
    $("linkBoard").href = b;
    $("linkJudge").textContent = j;
    $("linkJudge").href = j;
    $("linkStop").textContent = link.guest ? "Відʼєднатися від матчу" : "Закрити посилання";
    if (trouble) {
      $("linkTroubleTitle").textContent = status === "rejected" ? "Сервер не приймає це посилання" : "Немає звʼязку із сервером";
      $("linkTroubleWhy").innerHTML = troubleReasons(status).map(function (t) { return "<li>" + U.esc(t) + "</li>"; }).join("");
      $("linkGiveUp").textContent = link.guest ? "Відʼєднатися від матчу" : "Зупинити посилання";
    }
  }

  function copyText(btn, text, label) {
    var done = function () {
      btn.textContent = "Скопійовано";
      setTimeout(function () { btn.textContent = label; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () {});
  }

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

    $("protoHead").textContent = (p.title ? p.title + "  ·  " : "") + p.names[0] + " — " + p.names[1] + "  ·  " +
      p.sets[0] + ":" + p.sets[1] + "  ·  " + U.fmtClock(p.durationMs);
    $("protoSets").innerHTML =
      "<tr><th>сет</th>" +
      "<th class=\"ca\">" + U.esc(p.names[0]) + "</th><th class=\"cb\">" + U.esc(p.names[1]) + "</th>" +
      "<th>розіграшів</th><th>час</th></tr>" + rows;

    $("protoStats").innerHTML = [
      statRow("Виграно очок", p.stats.pointsWon),
      statRow("Найдовша серія", p.stats.bestStreak),
      statRow("Найбільший відрив", p.stats.biggestLead),
      statRow("Тайм-аутів узято", p.stats.timeoutsUsed)
    ].join("");

    // Після кінця матчу показуємо перебіг останнього сету, а не порожній наступний.
    var trailSet = p.done ? p.setLog.length - 1 : p.setLog.length;
    var trail = M.rallyTrail(match, Math.max(0, trailSet));
    $("protoTrail").textContent = trail.length
      ? trail.map(function (x) { return x[0] + ":" + x[1]; }).join("  ")
      : "—";
    $("protoEvents").innerHTML = eventLines(s);
  }

  function statRow(label, pair) {
    return "<tr><th>" + U.esc(label) + "</th>" +
      cell(pair[0], "ca", pair[0] > pair[1]) + cell(pair[1], "cb", pair[1] > pair[0]) + "</tr>";
  }

  /* Клітинка рахунку: колір команди, жирна — якщо ця сторона попереду. */
  function cell(value, cls, strong) {
    return "<td class=\"" + cls + "\">" + (strong ? "<b>" + value + "</b>" : value) + "</td>";
  }

  /* «протокол-Кубок міста-Імідж-Ліцей», без символів, заборонених у Windows. */
  function fileName(s) {
    var parts = ["протокол"];
    if (s.title) parts.push(s.title);
    parts.push(s.names[0], s.names[1]);
    return parts.join("-").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function downloadCSV() {
    var s = M.reduce(match);
    var blob = new Blob(["\uFEFF" + M.toCSV(match)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName(s) + ".csv";
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
  var pendingPreset = null;      // id пресета, чиї правила зміни сторін візьмемо

  /* Підказка під пресетом — з самих правил, щоб числа жили лише в match.js. */
  function presetHint(pr) {
    if (!pr) return "Свої правила.";
    var r = pr.rules;
    var swap = r.swapEvery
      ? "сторони міняють щоразу, коли сума очок кратна " + r.swapEvery +
        (r.swapEveryDecider ? ", у вирішальному — " + r.swapEveryDecider : "")
      : "сторони міняють між сетами" + (r.deciderSwapAt ? " і на " + r.deciderSwapAt + " очках у вирішальному" : "");
    return pr.label + ": сети до " + r.target + ", вирішальний до " + r.decider +
      ", тайм-аутів " + r.timeouts + "; " + swap + ".";
  }

  /* Пресет заповнює поля форми; числа потім можна змінити вручну. */
  function choosePreset(id) {
    var pr = M.presetById(id);
    if (!pr) return;
    pendingPreset = id;
    pendingBestOf = pr.rules.bestOf;
    $("inTarget").value = pr.rules.target;
    $("inDecider").value = pr.rules.decider;
    $("inCap").value = pr.rules.cap || "";
    $("inTimeouts").value = pr.rules.timeouts;
    paintSeg();
  }

  function openSettings() {
    var s = M.reduce(match);
    $("inTitle").value = s.title;
    $("inNameA").value = s.names[0];
    $("inNameB").value = s.names[1];
    $("inTarget").value = s.rules.target;
    $("inDecider").value = s.rules.decider;
    $("inCap").value = s.rules.cap || "";
    $("inTimeouts").value = s.rules.timeouts;
    $("inVibrate").checked = prefs.vibrate;
    $("inShowServe").checked = prefs.showServe;
    $("inSound").checked = prefs.sound;
    paintPalettes();
    pendingBestOf = s.rules.bestOf;
    pendingPreset = M.presetOf(s.rules);
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
    var box = $("segPreset");
    if (!box.children.length) {
      M.PRESETS.forEach(function (pr) {
        var b = document.createElement("button");
        b.type = "button";
        b.dataset.preset = pr.id;
        b.textContent = pr.label;
        box.appendChild(b);
      });
    }
    Array.prototype.forEach.call(box.children, function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.preset === pendingPreset));
    });
    $("presetHint").textContent = presetHint(M.presetById(pendingPreset));

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
    next = M.setTitle(next, $("inTitle").value);

    var cap = $("inCap").value.trim() === "" ? 0 : num($("inCap"), 0, 199, 0);
    var D = M.DEFAULT_RULES;
    var cur = M.reduce(match).rules;
    var pr = M.presetById(pendingPreset);
    var swap = pr ? pr.rules : cur;     // правила, яких немає у формі (сторони, заміни, техн. тайм-аут), — від пресета або як були
    var target = num($("inTarget"), 3, 99, D.target);
    var decider = num($("inDecider"), 3, 99, D.decider);
    next = M.setRules(next, {
      target: target,
      decider: decider,
      cap: cap,
      capDecider: cap ? Math.max(0, cap - (target - decider)) : 0,
      timeouts: num($("inTimeouts"), 0, 5, D.timeouts),
      bestOf: pendingBestOf,
      deciderSwapAt: swap.deciderSwapAt,
      swapEvery: swap.swapEvery,
      swapEveryDecider: swap.swapEveryDecider,
      subs: swap.subs,
      techTimeoutAt: swap.techTimeoutAt
    });

    // Зміна формату перекроює сітку сетів — починаємо матч наново.
    if (pendingBestOf !== M.reduce(match).rules.bestOf) next = M.restart(next);

    prefs.vibrate = $("inVibrate").checked;
    prefs.showServe = $("inShowServe").checked;
    prefs.sound = $("inSound").checked;
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

  $("toStop").addEventListener("click", function () { stopTimeoutClock(); });

  $("mProto").addEventListener("click", function () { renderProtocol(); openSheet("proto"); });
  $("mSubs").addEventListener("click", openSubs);
  $("mMini").addEventListener("click", function () {
    closeSheets();
    // Маленьке окреме вікно: міні-табло й кнопки, поруч з іншою програмою.
    var w = window.open("./mini.html", "volley-mini", "popup,width=480,height=640");
    if (w) return;
    var btn = $("mMini");                                // спливні вікна заблоковані — підказуємо
    openSheet("menu");
    btn.textContent = "Дозвольте спливні вікна для цього сайту";
    setTimeout(function () { btn.textContent = "Міні-табло з керуванням"; }, 3200);
  });
  $("mBoard").addEventListener("click", function () {
    closeSheets();
    // Сайт відкрито з сервера — табло йде за посиланням на матч: його можна вставити
    // в програму для стріму чи відкрити на іншому пристрої. Інакше — лише цей браузер.
    if (!link) {
      var l = R.ensureLink(localStorage, location);
      if (l) { link = l; startLinkConn(); }
    }
    var w = window.open(link ? boardUrl() : "./live.html", "volley-board", "popup,width=640,height=200");
    if (link) { paintLink(); openSheet("linkSheet"); return; }   // тут же — адреса для копіювання
    if (w) return;
    var btn = $("mBoard");
    openSheet("menu");
    btn.textContent = "Дозвольте спливні вікна для цього сайту";
    setTimeout(function () { btn.textContent = "Міні-табло окремо"; }, 3200);
  });
  $("mLink").addEventListener("click", function () { paintLink(); openSheet("linkSheet"); });
  $("linkCreate").addEventListener("click", createLink);
  $("linkDot").addEventListener("click", function () {
    if (!$("linkDot").classList.contains("trouble")) return;
    paintLink(); openSheet("linkSheet");
  });
  $("linkDot").addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && $("linkDot").classList.contains("trouble")) { e.preventDefault(); paintLink(); openSheet("linkSheet"); }
  });
  $("linkRetry").addEventListener("click", function () {
    if (!link) return;
    linkLostAt = 0;                        // даємо серверу ще один повний відлік
    startLinkConn();
    paintLink();
  });
  // Тут не перепитуємо: людина вже прочитала пояснення й свідомо зупиняє.
  $("linkGiveUp").addEventListener("click", closeLink);
  $("linkStop").addEventListener("click", function () {
    var q = link && link.guest
      ? "Відʼєднатися? Цей пульт перестане отримувати зміни з матчу."
      : "Закрити посилання? Міні-табло й пульт другого судді перестануть оновлюватись.";
    if (confirm(q)) closeLink();
  });
  $("linkBoardCopy").addEventListener("click", function () { copyText($("linkBoardCopy"), boardUrl(), "Копіювати"); });
  $("linkBoardEmbed").addEventListener("click", function () { copyText($("linkBoardEmbed"), R.embedCode(boardUrl()), "Код для вставки"); });
  $("linkJudgeCopy").addEventListener("click", function () { copyText($("linkJudgeCopy"), judgeUrl(), "Копіювати"); });
  $("segTeam").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    subsTeam = Number(b.dataset.team);
    paintSubs();
  });
  $("subBtn").addEventListener("click", doSub);
  Array.prototype.forEach.call(document.querySelectorAll(".card[data-card]"), function (b) {
    b.addEventListener("click", function () { doCard(b.dataset.card); });
  });
  $("techBtn").addEventListener("click", function () {
    var next = M.takeTechTimeout(match);
    if (next === match) return;
    commit(next);
    startTimeoutClock("Технічний тайм-аут");
  });
  $("mDisplay").addEventListener("click", openDisplay);
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
  $("segPreset").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) choosePreset(b.dataset.preset);
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

  U.keepAwake();

  U.registerSW();

  /* Табло щойно відкрилось і просить поточний стан. */
  if (channel) {
    channel.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === "hello") {
        // Табло чи міні-пульт щойно відкрились і просять поточний стан.
        post({ type: "state", match: M.serialize(match) });
        post({ type: "prefs", prefs: prefs });
      } else if (d.type === "state" && d.match) {
        takeState(d.match, false);                       // міні-пульт у сусідній вкладці
      }
    };
  }
  window.addEventListener("storage", function (e) {
    if (e.key === KEY && e.newValue) takeState(e.newValue, false);
    else if (e.key === LINK_KEY) {
      // Посилання створили (напр., «Табло окремо» в міні-пульті) чи закрили в іншій вкладці.
      var l = R.loadLink(localStorage);
      if (l && (!link || l.room !== link.room)) { link = l; startLinkConn(); paintLink(); }
      else if (!l && link) { if (linkConn) linkConn.close(); linkConn = null; link = null; trackLinkLoss("closed"); paintLink("closed"); }
    }
  });

  $("mDisplay").textContent = displayLabel();
  if (window.screen && "onchange" in window.screen) {
    window.screen.addEventListener("change", function () { $("mDisplay").textContent = displayLabel(); });
  }

  load();

  // Посилання переживає перезавантаження пульта: той самий код, ті самі посилання.
  joinFromUrl();
  if (!link) loadLink();
  if (link) startLinkConn();
  paintLink();
})();
