/*
 * Ядро матчу. Чиста логіка без DOM: працює в браузері (window.Match)
 * і в Node (require) — саме тому її можна тестувати окремо.
 *
 * Матч зберігається як список подій, а стан завжди рахується з нуля.
 * Звідси безкоштовно виходять скасування, повтор, протокол і статистика.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Match = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_RULES = {
    bestOf: 5,        // 1, 3 або 5 сетів
    target: 25,       // очок у звичайному сеті
    decider: 15,      // очок у вирішальному
    winBy: 2,         // мінімальна різниця
    cap: 0,           // стеля очок у звичайному сеті (0 — без стелі)
    capDecider: 0,    // стеля у вирішальному
    timeouts: 2,      // тайм-аутів на команду в сеті
    deciderSwapAt: 8, // зала: одна зміна сторін у вирішальному, коли хтось набрав стільки
    swapEvery: 0,     // пляж: зміна сторін кожні N очок у сумі (0 — ні)
    swapEveryDecider: 0, // те саме у вирішальному сеті
    subs: 6,          // замін на команду в сеті (0 — заміни вимкнено)
    techTimeoutAt: 0  // пляж: технічний тайм-аут, коли сума очок сету досягла N (0 — ні)
  };

  /* Санкції за правилами FIVB. Червона — штраф: очко й подача суперникові. */
  var CARDS = ["yellow", "red", "expulsion", "disqualification"];
  var CARD_NAMES = { yellow: "жовта", red: "червона", expulsion: "вилучення", disqualification: "дискваліфікація" };

  /*
   * Готові набори правил. Обираються в налаштуваннях і заповнюють поля;
   * числа після цього можна підправити вручну.
   */
  var PRESETS = [
    { id: "indoor", label: "Зал",
      rules: { bestOf: 5, target: 25, decider: 15, winBy: 2, cap: 0, capDecider: 0, timeouts: 2,
               deciderSwapAt: 8, swapEvery: 0, swapEveryDecider: 0, subs: 6, techTimeoutAt: 0 } },
    { id: "beach", label: "Пляж",
      rules: { bestOf: 3, target: 21, decider: 15, winBy: 2, cap: 0, capDecider: 0, timeouts: 1,
               deciderSwapAt: 0, swapEvery: 7, swapEveryDecider: 5, subs: 0, techTimeoutAt: 21 } },
    { id: "school", label: "Шкільний",
      rules: { bestOf: 3, target: 25, decider: 15, winBy: 2, cap: 0, capDecider: 0, timeouts: 2,
               deciderSwapAt: 8, swapEvery: 0, swapEveryDecider: 0, subs: 6, techTimeoutAt: 0 } }
  ];

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  /* Який пресет збігається з правилами повністю (або null — правила свої). */
  function presetOf(rules) {
    for (var i = 0; i < PRESETS.length; i++) {
      var pr = PRESETS[i].rules, same = true;
      for (var k in pr) if (rules[k] !== pr[k]) { same = false; break; }
      if (same) return PRESETS[i].id;
    }
    return null;
  }

  var DEFAULT_NAMES = ["Команда А", "Команда Б"];

  function createMatch(opts) {
    opts = opts || {};
    var rules = {};
    for (var k in DEFAULT_RULES) rules[k] = DEFAULT_RULES[k];
    if (opts.rules) for (var j in opts.rules) if (opts.rules[j] !== undefined) rules[j] = opts.rules[j];
    return {
      v: 1,
      names: (opts.names || DEFAULT_NAMES).slice(),
      title: typeof opts.title === "string" ? opts.title : "",   // назва турніру чи матчу
      rules: rules,
      events: [],
      undone: []
    };
  }

  function clone(m) {
    return {
      v: m.v,
      names: m.names.slice(),
      title: m.title || "",
      rules: m.rules,
      events: m.events.slice(),
      undone: m.undone.slice()
    };
  }

  function push(m, ev) {
    var next = clone(m);
    next.events.push(ev);
    next.undone = [];               // нова дія обриває гілку повтору
    return next;
  }

  /* ---------- дії ---------- */

  function addPoint(m, team, ts) {
    if (team !== 0 && team !== 1) throw new Error("team має бути 0 або 1");
    if (reduce(m).done) return m;
    return push(m, { type: "point", team: team, ts: ts || Date.now() });
  }

  function callTimeout(m, team, ts) {
    var s = reduce(m);
    if (s.done || s.timeouts[team] <= 0) return m;
    return push(m, { type: "timeout", team: team, ts: ts || Date.now() });
  }

  /*
   * Заміна: гравець out іде, in заходить. Номери — рядки, як у протоколі
   * («7», «12»). Понад ліміт сету заміна не приймається.
   */
  function substitute(m, team, out, inn, ts) {
    var s = reduce(m);
    if (s.done || !s.rules.subs || s.subsUsed[team] >= s.rules.subs) return m;
    out = String(out == null ? "" : out).trim();
    inn = String(inn == null ? "" : inn).trim();
    if (!out || !inn || out === inn) return m;
    return push(m, { type: "sub", team: team, out: out, "in": inn, ts: ts || Date.now() });
  }

  /* Картка гравцю (номер) чи команді/тренеру (порожньо). */
  function giveCard(m, team, kind, player, ts) {
    if (reduce(m).done || CARDS.indexOf(kind) < 0) return m;
    return push(m, { type: "card", team: team, kind: kind,
                     player: String(player == null ? "" : player).trim(), ts: ts || Date.now() });
  }

  function swapSides(m, ts) {
    return push(m, { type: "swap", ts: ts || Date.now() });
  }

  /* Хто подає першим у поточному сеті. Діє лише до першого розіграшу сету. */
  function setServer(m, team, ts) {
    var s = reduce(m);
    if (s.done || s.points[0] || s.points[1]) return m;
    return push(m, { type: "serve", team: team, ts: ts || Date.now() });
  }

  /*
   * Зняти одне очко в команди. На відміну від скасування, прибирає саме її
   * останній розіграш, навіть якщо після нього суперник уже набрав свої.
   */
  function removeLastPoint(m, team) {
    for (var i = m.events.length - 1; i >= 0; i--) {
      var ev = m.events[i];
      if (ev.type === "point" && ev.team === team) {
        var next = clone(m);
        next.events.splice(i, 1);
        next.undone = [];
        return next;
      }
    }
    return m;
  }

  function undo(m) {
    if (!m.events.length) return m;
    var next = clone(m);
    next.undone.push(next.events.pop());
    return next;
  }

  function redo(m) {
    if (!m.undone.length) return m;
    var next = clone(m);
    next.events.push(next.undone.pop());
    return next;
  }

  function canUndo(m) { return m.events.length > 0; }
  function canRedo(m) { return m.undone.length > 0; }

  /* Новий матч із тими самими налаштуваннями й назвами. */
  function restart(m) {
    return createMatch({ names: m.names, rules: m.rules, title: m.title });
  }

  function rename(m, team, name) {
    var next = clone(m);
    next.names[team] = name;
    return next;
  }

  /* Назва турніру чи матчу — для табло, протоколу й імені файлу. */
  function setTitle(m, title) {
    var next = clone(m);
    next.title = String(title || "").trim();
    return next;
  }

  function setRules(m, rules) {
    var next = clone(m);
    var merged = {};
    for (var k in next.rules) merged[k] = next.rules[k];
    for (var j in rules) if (rules[j] !== undefined) merged[j] = rules[j];
    next.rules = merged;
    return next;
  }

  /* ---------- стан ---------- */

  function reduce(m) {
    var r = m.rules;
    var needed = r.bestOf > 1 ? Math.floor(r.bestOf / 2) + 1 : 1;

    var s = {
      names: m.names.slice(),
      title: m.title || "",
      rules: r,
      setsNeeded: needed,
      points: [0, 0],
      sets: [0, 0],
      setLog: [],
      serving: null,
      timeouts: [r.timeouts, r.timeouts],
      timeoutsUsed: [0, 0],
      subsUsed: [0, 0],               // замін у поточному сеті
      subLog: [],                     // усі заміни матчу: {team, out, in, set, score}
      cards: [],                      // усі картки матчу: {team, kind, player, set, score}
      lastSub: null,
      lastCard: null,
      techTimeoutTaken: false,
      flipped: false,
      done: false,
      winner: null,
      setNumber: 1,
      isDecider: false,
      target: r.target,
      cap: r.cap,
      rallies: 0,
      setRallies: 0,
      pointsWon: [0, 0],
      streak: { team: null, n: 0 },
      bestStreak: [0, 0],
      biggestLead: [0, 0],
      startedAt: null,
      lastAt: null,
      setStartedAt: null,
      swappedThisSet: false,
      swappedAtTotal: null,           // на якій сумі очок сету востаннє міняли сторони
      lastPoint: null,
      lastTimeout: null
    };

    function refresh() {
      s.isDecider = r.bestOf > 1 && (s.sets[0] + s.sets[1]) === r.bestOf - 1;
      s.target = s.isDecider ? r.decider : r.target;
      s.cap = s.isDecider ? (r.capDecider || 0) : (r.cap || 0);
      s.setNumber = s.setLog.length + 1;
    }
    refresh();

    for (var i = 0; i < m.events.length; i++) {
      var ev = m.events[i];
      if (s.done) break;                       // після матчу події не діють

      if (ev.type === "swap") {
        s.flipped = !s.flipped;
        s.swappedThisSet = true;
        s.swappedAtTotal = s.points[0] + s.points[1];

      } else if (ev.type === "serve") {
        if (!s.points[0] && !s.points[1]) s.serving = ev.team;

      } else if (ev.type === "timeout") {
        if (s.timeouts[ev.team] > 0) {
          s.timeouts[ev.team]--;
          s.timeoutsUsed[ev.team]++;
          s.lastTimeout = { team: ev.team, ts: ev.ts };
        }

      } else if (ev.type === "point") {
        applyPoint(ev);

      } else if (ev.type === "sub") {
        if (r.subs && s.subsUsed[ev.team] < r.subs) {
          s.subsUsed[ev.team]++;
          s.lastSub = { team: ev.team, out: ev.out, "in": ev["in"], set: s.setNumber,
                        score: [s.points[0], s.points[1]], ts: ev.ts };
          s.subLog.push(s.lastSub);
        }

      } else if (ev.type === "card") {
        s.lastCard = { team: ev.team, kind: ev.kind, player: ev.player || "", set: s.setNumber,
                       score: [s.points[0], s.points[1]], ts: ev.ts };
        s.cards.push(s.lastCard);
        // Червона — штраф: суперник отримує розіграш, тобто очко й подачу.
        if (ev.kind === "red") applyPoint({ type: "point", team: 1 - ev.team, ts: ev.ts, penalty: true });

      } else if (ev.type === "techTimeout") {
        s.techTimeoutTaken = true;
        s.lastTimeout = { team: -1, tech: true, ts: ev.ts };
      }
    }

    function applyPoint(ev) {
      var team = ev.team, other = 1 - team;

      s.points[team]++;
      s.rallies++;
      s.setRallies++;
      s.pointsWon[team]++;
      if (s.startedAt === null) s.startedAt = ev.ts;
      if (s.setStartedAt === null) s.setStartedAt = ev.ts;
      s.lastAt = ev.ts;

      s.lastPoint = {
        team: team,
        sideOut: s.serving !== null && s.serving !== team,
        closedSet: false,
        closedMatch: false
      };
      s.serving = team;

      if (s.streak.team === team) s.streak = { team: team, n: s.streak.n + 1 };
      else s.streak = { team: team, n: 1 };
      if (s.streak.n > s.bestStreak[team]) s.bestStreak[team] = s.streak.n;

      var lead = s.points[team] - s.points[other];
      if (lead > s.biggestLead[team]) s.biggestLead[team] = lead;

      if (setWonBy(s.points, team, s.target, s.cap, r.winBy)) {
        s.setLog.push({
          points: [s.points[0], s.points[1]],
          winner: team,
          rallies: s.setRallies,
          startedAt: s.setStartedAt,
          endedAt: ev.ts
        });
        s.sets[team]++;
        s.lastPoint.closedSet = true;

        s.points = [0, 0];
        s.serving = null;
        s.timeouts = [r.timeouts, r.timeouts];
        s.subsUsed = [0, 0];
        s.techTimeoutTaken = false;
        s.streak = { team: null, n: 0 };
        s.setRallies = 0;
        s.setStartedAt = null;
        s.swappedThisSet = false;
        s.swappedAtTotal = null;

        if (s.sets[team] >= needed) {
          s.done = true;
          s.winner = team;
          s.lastPoint.closedMatch = true;
        }
        refresh();
      }
    }

    return s;
  }

  function setWonBy(points, team, target, cap, winBy) {
    var other = 1 - team;
    if (cap > 0 && points[team] >= cap) return true;
    return points[team] >= target && points[team] - points[other] >= winBy;
  }

  /* ---------- похідні підказки ---------- */

  /* Команда, якій одне очко дає сет (або null). */
  function setPointFor(s) {
    if (s.done) return null;
    for (var i = 0; i < 2; i++) {
      var pts = [s.points[0], s.points[1]];
      pts[i]++;
      if (setWonBy(pts, i, s.target, s.cap, s.rules.winBy)) return i;
    }
    return null;
  }

  /* Команда, якій одне очко дає матч (або null). */
  function matchPointFor(s) {
    var i = setPointFor(s);
    if (i === null) return null;
    return s.sets[i] + 1 >= s.setsNeeded ? i : null;
  }

  /*
   * Чи час міняти сторони.
   * Зала: один раз у вирішальному, коли лідер набрав deciderSwapAt (8).
   * Пляж: щоразу, коли сума очок сету кратна swapEvery (7; у вирішальному — 5).
   */
  function sideSwapDue(s) {
    if (s.done) return false;
    var r = s.rules;
    var every = s.isDecider ? (r.swapEveryDecider || 0) : (r.swapEvery || 0);
    if (every > 0) {
      var total = s.points[0] + s.points[1];
      return total > 0 && total % every === 0 && s.swappedAtTotal !== total;
    }
    var at = r.deciderSwapAt === undefined ? 8 : r.deciderSwapAt;
    return at > 0 && s.isDecider && !s.swappedThisSet && Math.max(s.points[0], s.points[1]) >= at;
  }

  /* Пляж: технічний тайм-аут, коли сума очок сету дійшла до techTimeoutAt (не у вирішальному). */
  function techTimeoutDue(s) {
    var at = s.rules.techTimeoutAt || 0;
    return !s.done && at > 0 && !s.isDecider && !s.techTimeoutTaken && s.points[0] + s.points[1] >= at;
  }

  function takeTechTimeout(m, ts) {
    if (!techTimeoutDue(reduce(m))) return m;
    return push(m, { type: "techTimeout", ts: ts || Date.now() });
  }

  /* Індекс команди, що грає на стороні side (0 — перша сторона екрана). */
  function teamOnSide(s, side) {
    return s.flipped ? 1 - side : side;
  }

  /*
   * Пауза після кінця матчу: FINAL_HOLD_MS після останнього очка табло ще показують рахунок
   * останнього сету (напр. 25:23), і лише потім — фінальний екран. finalHoldLeft — скільки
   * ще мс триває пауза (0 — її немає: матч не завершено або вона вже минула).
   */
  var FINAL_HOLD_MS = 10000;
  function finalHoldLeft(s, now) {
    if (!s.done || !s.lastAt || !s.setLog.length) return 0;
    var hold = api.finalHoldMs;                 // можна змінити: Match.finalHoldMs = 5000 (0 — без паузи)
    var left = s.lastAt + hold - (now || Date.now());
    return left > 0 ? Math.min(left, hold) : 0;
  }
  /* Очки для показу: під час паузи — рахунок останнього сету, інакше поточні. */
  function shownPoints(s, now) {
    return finalHoldLeft(s, now) ? s.setLog[s.setLog.length - 1].points.slice() : [s.points[0], s.points[1]];
  }

  function durationMs(s, now) {
    if (s.startedAt === null) return 0;
    return (s.done ? s.lastAt : (now || Date.now())) - s.startedAt;
  }

  /* ---------- протокол ---------- */

  function protocol(m, now) {
    var s = reduce(m);
    return {
      title: s.title,
      names: s.names,
      rules: s.rules,
      sets: s.sets,
      winner: s.winner,
      done: s.done,
      durationMs: durationMs(s, now),
      setLog: s.setLog.map(function (set) {
        return {
          points: set.points,
          winner: set.winner,
          rallies: set.rallies,
          durationMs: set.endedAt && set.startedAt ? set.endedAt - set.startedAt : 0
        };
      }),
      current: s.done ? null : { points: [s.points[0], s.points[1]], setNumber: s.setNumber },
      stats: {
        rallies: s.rallies,
        pointsWon: s.pointsWon,
        bestStreak: s.bestStreak,
        biggestLead: s.biggestLead,
        timeoutsUsed: s.timeoutsUsed
      },
      subs: s.subLog,
      cards: s.cards
    };
  }

  /* Перебіг сету по очках: [[1,0],[1,1],...] — для протоколу. */
  function rallyTrail(m, setIndex) {
    var r = m.rules, needed = r.bestOf > 1 ? Math.floor(r.bestOf / 2) + 1 : 1;
    var points = [0, 0], sets = [0, 0], idx = 0, trail = [], done = false;

    for (var i = 0; i < m.events.length && !done; i++) {
      var ev = m.events[i];
      var scorer = ev.type === "point" ? ev.team
        : ev.type === "card" && ev.kind === "red" ? 1 - ev.team : -1;
      if (scorer < 0) continue;
      ev = { team: scorer };
      points[ev.team]++;
      if (idx === setIndex) trail.push([points[0], points[1]]);

      var isDecider = r.bestOf > 1 && (sets[0] + sets[1]) === r.bestOf - 1;
      var target = isDecider ? r.decider : r.target;
      var cap = isDecider ? (r.capDecider || 0) : (r.cap || 0);
      if (setWonBy(points, ev.team, target, cap, r.winBy)) {
        sets[ev.team]++;
        points = [0, 0];
        idx++;
        if (sets[ev.team] >= needed) done = true;
      }
    }
    return trail;
  }

  function toCSV(m) {
    var s = reduce(m);
    var rows = [["сет", s.names[0], s.names[1], "розіграшів", "хвилин"]];
    s.setLog.forEach(function (set, i) {
      var min = set.endedAt && set.startedAt ? Math.round((set.endedAt - set.startedAt) / 60000) : "";
      rows.push([i + 1, set.points[0], set.points[1], set.rallies, min]);
    });
    if (!s.done && (s.points[0] || s.points[1])) {
      rows.push([s.setNumber + " (триває)", s.points[0], s.points[1], s.setRallies, ""]);
    }
    rows.push(["сети", s.sets[0], s.sets[1], "", ""]);
    s.subLog.forEach(function (x) {
      rows.push(["заміна", s.names[x.team], x.out + " → " + x["in"], "сет " + x.set, x.score[0] + ":" + x.score[1]]);
    });
    s.cards.forEach(function (c) {
      rows.push(["картка: " + CARD_NAMES[c.kind], s.names[c.team], c.player || "команда", "сет " + c.set, c.score[0] + ":" + c.score[1]]);
    });
    return rows.map(function (row) {
      return row.map(function (cell) {
        var v = String(cell);
        return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(",");
    }).join("\n");
  }

  /* ---------- перевірка даних ---------- */

  /*
   * Матч приходить з localStorage, з іншої вкладки чи з сервера від другого судді.
   * Одна зіпсована подія (null, team: 7) інакше валила б reduce на всіх табло.
   * validate — сувора перевірка для сервера: будь-яка проблема → стан не приймаємо.
   * deserialize — поблажлива: викидає лише зіпсоване, щоб старі збереження відкривались.
   * Невідомі типи подій пропускаємо (reduce їх ігнорує) — так нова версія пульта
   * не зламає старе табло.
   */
  var LIMITS = { events: 5000, name: 60, title: 120, player: 12, type: 30 };
  var RULE_RANGE = {
    bestOf: [1, 7], target: [1, 99], decider: [1, 99], winBy: [1, 10], cap: [0, 199], capDecider: [0, 199],
    timeouts: [0, 10], deciderSwapAt: [0, 99], swapEvery: [0, 99], swapEveryDecider: [0, 99],
    subs: [0, 30], techTimeoutAt: [0, 199]
  };
  var TEAM_EVENTS = { point: 1, timeout: 1, serve: 1, sub: 1, card: 1 };

  function isTeam(t) { return t === 0 || t === 1; }
  function shortStr(v, max) { return typeof v === "string" && v.length <= max; }

  /* Що не так з подією, або null — усе гаразд. */
  function eventProblem(ev) {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return "подія не обʼєкт";
    if (!shortStr(ev.type, LIMITS.type) || !ev.type) return "немає типу події";
    if (ev.ts !== undefined && !(typeof ev.ts === "number" && isFinite(ev.ts) && ev.ts >= 0)) return "неправильний час події";
    if (TEAM_EVENTS[ev.type] && !isTeam(ev.team)) return ev.type + ": team має бути 0 або 1";
    if (ev.type === "sub" && !(shortStr(ev.out, LIMITS.player) && shortStr(ev["in"], LIMITS.player))) return "sub: номери гравців";
    if (ev.type === "card") {
      if (CARDS.indexOf(ev.kind) < 0) return "card: невідома картка";
      if (ev.player !== undefined && !shortStr(ev.player, LIMITS.player)) return "card: номер гравця";
    }
    return null;
  }

  function ruleOk(k, v) {
    var r = RULE_RANGE[k];
    if (!r) return true;                                     // невідоме правило — не наше, ігноруємо
    if (typeof v !== "number" || v % 1 !== 0 || v < r[0] || v > r[1]) return false;
    return k !== "bestOf" || v % 2 === 1;
  }

  /* Сувора перевірка: список проблем (порожній — можна приймати). */
  function validate(data) {
    var out = [];
    if (!data || typeof data !== "object") return ["матч не обʼєкт"];
    if (!Array.isArray(data.events)) out.push("немає списку подій");
    else if (data.events.length > LIMITS.events) out.push("забагато подій");
    if (data.undone !== undefined && !Array.isArray(data.undone)) out.push("undone не список");
    [["events", data.events], ["undone", data.undone]].forEach(function (pair) {
      if (!Array.isArray(pair[1])) return;
      for (var i = 0; i < pair[1].length; i++) {
        var p = eventProblem(pair[1][i]);
        if (p) { out.push(pair[0] + "[" + i + "]: " + p); break; }
      }
    });
    if (!Array.isArray(data.names) || data.names.length !== 2 ||
        !shortStr(data.names[0], LIMITS.name) || !shortStr(data.names[1], LIMITS.name)) out.push("назви команд");
    if (data.title !== undefined && !shortStr(data.title, LIMITS.title)) out.push("назва турніру");
    if (data.rules !== undefined) {
      if (!data.rules || typeof data.rules !== "object") out.push("правила не обʼєкт");
      else for (var k in RULE_RANGE) if (k in data.rules && !ruleOk(k, data.rules[k])) out.push("правило " + k);
    }
    return out;
  }

  function cleanEvents(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < LIMITS.events; i++) if (!eventProblem(list[i])) out.push(list[i]);
    return out;
  }

  function cleanName(v, i) {
    var n = typeof v === "string" ? v.trim().slice(0, LIMITS.name) : "";
    return n || DEFAULT_NAMES[i];
  }

  function cleanRules(r) {
    var out = {};
    if (!r || typeof r !== "object") return out;
    for (var k in RULE_RANGE) if (k in r && ruleOk(k, r[k])) out[k] = r[k];
    return out;
  }

  /* ---------- збереження ---------- */

  function serialize(m) {
    return JSON.stringify({ v: 1, names: m.names, title: m.title || "", rules: m.rules, events: m.events, undone: m.undone });
  }

  function deserialize(raw) {
    if (!raw) return null;
    var data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || !Array.isArray(data.events)) return null;
    var names = Array.isArray(data.names) ? data.names : [];
    var m = createMatch({
      names: [cleanName(names[0], 0), cleanName(names[1], 1)],
      rules: cleanRules(data.rules),
      title: typeof data.title === "string" ? data.title.slice(0, LIMITS.title) : ""
    });
    m.events = cleanEvents(data.events);
    m.undone = cleanEvents(data.undone);
    return m;
  }

  var api = {
    FINAL_HOLD_MS: FINAL_HOLD_MS,
    finalHoldMs: FINAL_HOLD_MS,
    finalHoldLeft: finalHoldLeft,
    shownPoints: shownPoints,
    DEFAULT_RULES: DEFAULT_RULES,
    PRESETS: PRESETS,
    presetById: presetById,
    presetOf: presetOf,
    createMatch: createMatch,
    addPoint: addPoint,
    removeLastPoint: removeLastPoint,
    callTimeout: callTimeout,
    swapSides: swapSides,
    substitute: substitute,
    giveCard: giveCard,
    CARDS: CARDS,
    techTimeoutDue: techTimeoutDue,
    takeTechTimeout: takeTechTimeout,
    setServer: setServer,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    restart: restart,
    rename: rename,
    setTitle: setTitle,
    setRules: setRules,
    reduce: reduce,
    setPointFor: setPointFor,
    matchPointFor: matchPointFor,
    sideSwapDue: sideSwapDue,
    teamOnSide: teamOnSide,
    durationMs: durationMs,
    protocol: protocol,
    rallyTrail: rallyTrail,
    toCSV: toCSV,
    serialize: serialize,
    deserialize: deserialize,
    validate: validate,
    eventProblem: eventProblem
  };
  return api;
});
