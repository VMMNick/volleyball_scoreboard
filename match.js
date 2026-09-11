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
    timeouts: 2       // тайм-аутів на команду в сеті
  };

  var DEFAULT_NAMES = ["Команда А", "Команда Б"];

  function createMatch(opts) {
    opts = opts || {};
    var rules = {};
    for (var k in DEFAULT_RULES) rules[k] = DEFAULT_RULES[k];
    if (opts.rules) for (var j in opts.rules) if (opts.rules[j] !== undefined) rules[j] = opts.rules[j];
    return {
      v: 1,
      names: (opts.names || DEFAULT_NAMES).slice(),
      rules: rules,
      events: [],
      undone: []
    };
  }

  function clone(m) {
    return {
      v: m.v,
      names: m.names.slice(),
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
    return createMatch({ names: m.names, rules: m.rules });
  }

  function rename(m, team, name) {
    var next = clone(m);
    next.names[team] = name;
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
      rules: r,
      setsNeeded: needed,
      points: [0, 0],
      sets: [0, 0],
      setLog: [],
      serving: null,
      timeouts: [r.timeouts, r.timeouts],
      timeoutsUsed: [0, 0],
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
        s.streak = { team: null, n: 0 };
        s.setRallies = 0;
        s.setStartedAt = null;
        s.swappedThisSet = false;

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

  /* У вирішальному сеті сторони міняють на 8 очках. */
  function sideSwapDue(s) {
    return !s.done && s.isDecider && !s.swappedThisSet &&
           Math.max(s.points[0], s.points[1]) >= 8;
  }

  /* Індекс команди, що грає на стороні side (0 — перша сторона екрана). */
  function teamOnSide(s, side) {
    return s.flipped ? 1 - side : side;
  }

  function durationMs(s, now) {
    if (s.startedAt === null) return 0;
    return (s.done ? s.lastAt : (now || Date.now())) - s.startedAt;
  }

  /* ---------- протокол ---------- */

  function protocol(m, now) {
    var s = reduce(m);
    return {
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
      }
    };
  }

  /* Перебіг сету по очках: [[1,0],[1,1],...] — для протоколу. */
  function rallyTrail(m, setIndex) {
    var r = m.rules, needed = r.bestOf > 1 ? Math.floor(r.bestOf / 2) + 1 : 1;
    var points = [0, 0], sets = [0, 0], idx = 0, trail = [], done = false;

    for (var i = 0; i < m.events.length && !done; i++) {
      var ev = m.events[i];
      if (ev.type !== "point") continue;
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
    return rows.map(function (row) {
      return row.map(function (cell) {
        var v = String(cell);
        return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(",");
    }).join("\n");
  }

  /* ---------- збереження ---------- */

  function serialize(m) {
    return JSON.stringify({ v: 1, names: m.names, rules: m.rules, events: m.events, undone: m.undone });
  }

  function deserialize(raw) {
    if (!raw) return null;
    var data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || !Array.isArray(data.events)) return null;
    var m = createMatch({ names: data.names, rules: data.rules });
    m.events = data.events;
    m.undone = Array.isArray(data.undone) ? data.undone : [];
    return m;
  }

  return {
    DEFAULT_RULES: DEFAULT_RULES,
    createMatch: createMatch,
    addPoint: addPoint,
    removeLastPoint: removeLastPoint,
    callTimeout: callTimeout,
    swapSides: swapSides,
    setServer: setServer,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    restart: restart,
    rename: rename,
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
    deserialize: deserialize
  };
});
