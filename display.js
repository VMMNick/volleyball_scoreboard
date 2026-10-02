/*
 * Табло для глядачів. Лише показує — нічого не змінює.
 *
 * Звідки брати рахунок, вирішує feed.js: з цього ж пристрою (друге вікно,
 * проєктор — без сервера) або з кімнати матчу на сервері (?room=ABC234 — будь-який
 * пристрій через server.js).
 */
(function () {
  "use strict";

  var M = window.Match;
  var P = window.Palettes;
  var U = window.UI;
  var S = window.Sounds.create(window);
  var LAYOUTS = ["arena", "strip"];
  var IDLE_MS = 3000;

  var match = M.createMatch();
  var prefs = { timeoutSec: 30, palette: P.list[0].id, showServe: true, sound: true };
  var dismissedTimeout = null;     // ts тайм-ауту, який пульт уже закрив
  var toTimer = null;
  var prev = null;                 // попередній стан — щоб помітити, що саме змінилось
  var timeoutShownTs = null;       // тайм-аут, відлік якого зараз на екрані
  var bannerTimer = null, rotTimer = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- стан із пульта ---------- */

  function takeMatch(raw) {
    try {
      var m = M.deserialize(raw);
      if (m) match = m;
    } catch (e) {}
  }

  function takePrefs(raw) {
    try {
      var p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!p || typeof p !== "object") return;
      if (typeof p.timeoutSec === "number") prefs.timeoutSec = p.timeoutSec;
      if (typeof p.palette === "string") prefs.palette = P.byId(p.palette).id;
      if (typeof p.showServe === "boolean") prefs.showServe = p.showServe;
      if (typeof p.sound === "boolean") prefs.sound = p.sound;
    } catch (e) {}
  }

  function applyPrefs(p) {
    takePrefs(p);
    P.apply(document.documentElement, prefs.palette);
    render();
  }

  function startFeed() {
    render();                                       // одразу щось на екрані, навіть без даних
    return window.Feed.create({
      win: window,
      onMatch: function (raw) { takeMatch(raw); render(); },
      onPrefs: applyPrefs,
      onTimeoutEnd: function (ts) { dismissedTimeout = ts || dismissedTimeout; render(); },
      onStatus: paintLink
    });
  }

  /* Стан звʼязку з сервером — лише коли табло дивиться в кімнату матчу. */
  var LINK_TEXT = {
    connecting: "підключення…", live: "наживо", offline: "немає звʼязку — перепідключаюсь",
    rejected: "матч не знайдено — перевірте посилання"
  };
  function paintLink(status) {
    var el = $("linkStatus");
    if (!el) return;
    el.className = "link-status " + (status === "local" ? "" : "show " + status);
    el.textContent = LINK_TEXT[status] || "";
  }

  /* ---------- допоміжне ---------- */

  function hintFor(s) {
    var mp = M.matchPointFor(s), sp = M.setPointFor(s);
    if (mp !== null) return "матчбол · " + s.names[mp];
    if (sp !== null) return "сетбол · " + s.names[sp];
    if (M.sideSwapDue(s)) return "зміна сторін";
    return "";
  }

  /* ---------- малювання ---------- */

  function render() {
    var s = M.reduce(match);
    // Як на пульті: ліва/верхня половина — та команда, що зараз на цій стороні майданчика.
    var sides = [M.teamOnSide(s, 0), M.teamOnSide(s, 1)];
    var setLabel = s.done ? "матч завершено"
      : s.rules.bestOf > 1 ? s.setNumber + "-й сет · до " + s.target
      : "до " + s.target;
    var hint = hintFor(s);

    renderArena(s, sides, setLabel, hint);
    renderStrip(s, sides, setLabel, hint);
    renderTimeout(s);
    renderFinal(s);
    tickClock();

    $("live").textContent = s.names[sides[0]] + " " + s.points[sides[0]] + ", " +
      s.names[sides[1]] + " " + s.points[sides[1]];

    S.setEnabled(prefs.sound);
    paintSoundHint();
    react(prev, s, sides);
    prev = s;
  }

  /* ---------- реакції на зміни: спалах, ротація, банер сету, звуки ---------- */

  function react(a, b, sides) {
    if (!a) return;                                  // перше малювання — без ефектів
    var lp = b.lastPoint;
    if (b.rallies > a.rallies && lp) {
      var t = sides[0] === lp.team ? "A" : "B";
      flash(t);
      if (lp.sideOut && !lp.closedSet) showRotation(t);
    }
    if (b.setLog.length > a.setLog.length) {
      if (b.done) S.play("match");
      else { showSetBanner(b, b.setLog.length - 1); S.play("set"); }
    }
    var lt = b.lastTimeout, plt = a.lastTimeout;
    if (lt && (!plt || plt.ts !== lt.ts) && !b.done) S.play("whistle");

    if (b.cards.length > a.cards.length) {
      var c = b.lastCard;
      showBanner(CARD_LABEL[c.kind], b.names[c.team], c.player ? "№" + c.player : "команді", sides[0] === c.team ? "ca" : "cb", "card-" + c.kind);
      S.play("whistle");
    } else if (b.subLog.length > a.subLog.length) {
      var x = b.lastSub;
      showBanner("Заміна", b.names[x.team], x.out + " → " + x["in"], sides[0] === x.team ? "ca" : "cb", "sub");
    }
  }

  var CARD_LABEL = { yellow: "Жовта картка", red: "Червона картка · очко суперникові",
                     expulsion: "Вилучення", disqualification: "Дискваліфікація" };

  /* Банер події: картка, заміна. Сет має свій, довший. */
  function showBanner(cap, who, line, whoCls, kind) {
    $("bannerCap").textContent = cap;
    $("bannerWho").textContent = who;
    $("bannerWho").className = "who " + whoCls;
    $("bannerPts").textContent = line;
    $("banner").className = "banner show " + kind;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { $("banner").classList.remove("show"); }, 3200);
  }

  /* Перезапуск CSS-анімації: зняти клас, змусити перерахунок, повісити знову. */
  function restartClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function flash(t) {
    restartClass($("aPanel" + t), "flash");
    restartClass($("sPts" + t), "flash");
  }

  function showRotation(t) {
    var on = $("aRot" + t), off = $("aRot" + (t === "A" ? "B" : "A"));
    off.classList.remove("on");
    on.classList.add("on");
    clearTimeout(rotTimer);
    rotTimer = setTimeout(function () { on.classList.remove("on"); }, 2200);
  }

  function showSetBanner(s, index) {
    var set = s.setLog[index], w = set.winner;
    var sides = [M.teamOnSide(s, 0), M.teamOnSide(s, 1)];
    $("bannerCap").textContent = (index + 1) + "-й сет";
    $("bannerWho").textContent = s.names[w] + " виграла";
    $("bannerWho").className = "who " + (sides[0] === w ? "ca" : "cb");
    $("bannerPts").textContent = set.points[w] + " : " + set.points[1 - w];
    $("banner").className = "banner show set";
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { $("banner").classList.remove("show"); }, 4000);
  }

  /* Підказка «клікніть, щоб увімкнути звук», поки браузер не дав дозволу. */
  function paintSoundHint() {
    $("soundHint").classList.toggle("show", prefs.sound && S.supported && !S.isUnlocked());
  }

  function unlockSound() {
    S.unlock();
    setTimeout(paintSoundHint, 150);
  }
  document.addEventListener("pointerdown", unlockSound);
  document.addEventListener("keydown", unlockSound);

  function renderArena(s, sides, setLabel, hint) {
    ["A", "B"].forEach(function (t, side) {
      var team = sides[side];
      $("aName" + t).textContent = s.names[team];
      $("aScore" + t).textContent = s.points[team];
      $("aServe" + t).className = "serve" + (prefs.showServe && s.serving === team ? " on" : "");
      if (s.rules.bestOf > 1) U.pips($("aPips" + t), s.sets[team], s.setsNeeded);
      else $("aPips" + t).innerHTML = "";
    });

    $("aTitle").textContent = s.title;
    // У вузькій смузі сітки — два рядки: номер сету і «до N очок».
    var setBox = $("aSet");
    setBox.innerHTML = "";
    setLabel.split(" · ").forEach(function (part, i) {
      var el = document.createElement(i ? "small" : "b");
      el.textContent = part;
      setBox.appendChild(el);
    });
    $("aFmt").textContent = s.rules.bestOf > 1 ? "до " + s.setsNeeded + " перемог" : "один сет";

    var multi = s.rules.bestOf > 1;
    $("aSets").innerHTML = multi
      ? '<span class="ca">' + s.sets[sides[0]] + '</span><span class="sep">:</span><span class="cb">' + s.sets[sides[1]] + "</span>"
      : "";
    $("aSetsCap").textContent = multi ? "сети" : "";
    $("aHint").textContent = hint;

    // Історія сетів: зіграні, поточний і порожні клітинки до максимуму.
    var html = "";
    s.setLog.forEach(function (set) {
      var cls = set.winner === sides[0] ? "wa" : "wb";
      html += '<span class="chip ' + cls + '">' + set.points[sides[0]] + "–" + set.points[sides[1]] + "</span>";
    });
    if (!s.done) {
      html += '<span class="chip live"><b>' + s.points[sides[0]] + "–" + s.points[sides[1]] + "</b></span>";
      for (var i = s.setLog.length + 1; i < s.rules.bestOf; i++) html += '<span class="chip empty">–</span>';
    }
    $("aHistory").innerHTML = s.rules.bestOf > 1 ? html : "";
  }

  function renderStrip(s, sides, setLabel, hint) {
    ["A", "B"].forEach(function (t, side) {
      var team = sides[side];
      $("sName" + t).textContent = s.names[team];
      $("sServe" + t).className = "bug-serve" + (prefs.showServe && s.serving === team ? " on" : "");
      $("sSets" + t).textContent = s.sets[team];
      $("sPts" + t).textContent = s.done ? "" : s.points[team];
      $("sPast" + t).innerHTML = s.setLog.map(function (set) {
        return '<span class="' + (set.winner === team ? "won" : "") + '">' + set.points[team] + "</span>";
      }).join("");
      $("sSets" + t).style.display = s.rules.bestOf > 1 ? "" : "none";
    });
    $("sTitle").textContent = s.title;
    $("sInfo").textContent = setLabel;
    $("sHint").textContent = hint;
  }

  /* Тайм-аут видно з подій матчу, тож табло підхопить його навіть відкрите посеред перерви. */
  function renderTimeout(s) {
    clearTimeout(toTimer);
    var lt = s.lastTimeout;
    var endsAt = lt ? lt.ts + prefs.timeoutSec * 1000 : 0;
    var left = Math.ceil((endsAt - Date.now()) / 1000);
    var on = lt && !s.done && left > 0 && dismissedTimeout !== lt.ts;
    $("toOverlay").classList.toggle("show", !!on);
    // Відлік дійшов до нуля сам (не закрили з пульта й не скасували) — сигнал.
    if (!on && timeoutShownTs !== null && lt && lt.ts === timeoutShownTs && left <= 0 && dismissedTimeout !== lt.ts) {
      S.play("timeoutEnd");
    }
    timeoutShownTs = on ? lt.ts : null;
    if (!on) return;
    $("toWho").textContent = lt.tech ? "Технічний тайм-аут" : "Тайм-аут · " + s.names[lt.team];
    $("toClock").textContent = left;
    toTimer = setTimeout(function () { renderTimeout(M.reduce(match)); }, 250);
  }

  function renderFinal(s) {
    $("final").classList.toggle("show", s.done);
    if (!s.done) return;
    var sides = [M.teamOnSide(s, 0), M.teamOnSide(s, 1)];
    $("finalCap").textContent = s.title || "Матч завершено";
    $("finalWho").textContent = s.names[s.winner] + " виграла";
    $("finalWho").className = "who " + (sides[0] === s.winner ? "ca" : "cb");
    // Рахунок — з боку переможця («3:2 · …»), навіть якщо він зараз на правій половині.
    var w = s.winner, l = 1 - w;
    $("finalTally").textContent = s.sets[w] + ":" + s.sets[l] + "  ·  " +
      s.setLog.map(function (set) { return set.points[w] + "–" + set.points[l]; }).join("  ·  ") +
      "  ·  " + U.fmtClock(M.durationMs(s));
  }

  function tickClock() {
    var s = M.reduce(match);
    $("aClock").textContent = s.startedAt === null ? "0:00" : U.fmtClock(M.durationMs(s));
  }
  setInterval(tickClock, 1000);

  /* ---------- макет і повний екран ---------- */

  function params() {
    try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; }
  }

  function setLayout(name, remember) {
    if (LAYOUTS.indexOf(name) < 0) name = LAYOUTS[0];
    document.body.setAttribute("data-layout", name);
    if (remember && history.replaceState) {
      var q = params();
      if (q.set) { q.set("layout", name); history.replaceState(null, "", "?" + q.toString()); }
    }
  }

  function nextLayout() {
    var cur = document.body.getAttribute("data-layout");
    setLayout(LAYOUTS[(LAYOUTS.indexOf(cur) + 1) % LAYOUTS.length], true);
  }

  function toggleFullscreen() {
    if (!document.documentElement.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  }

  document.addEventListener("dblclick", toggleFullscreen);
  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if (k === "f") toggleFullscreen();
    else if (k === "l") nextLayout();
  });

  /* Курсор і підказка ховаються, щоб не висіли на проєкторі. */
  var idleTimer = null;
  function wake() {
    document.body.classList.remove("idle");
    $("tip").classList.add("show");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      document.body.classList.add("idle");
      $("tip").classList.remove("show");
    }, IDLE_MS);
  }
  document.addEventListener("mousemove", wake);
  document.addEventListener("touchstart", wake, { passive: true });

  var q = params();
  setLayout(q.get("layout"), false);
  U.keepAwake();
  wake();
  startFeed();

  U.registerSW();
})();
