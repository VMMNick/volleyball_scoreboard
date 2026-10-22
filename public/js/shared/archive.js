/*
 * Архів матчів на цьому пристрої: завершені й перервані матчі з повним протоколом.
 *
 * Матч потрапляє сюди, коли він закінчився або коли суддя починає новий, а в старому
 * вже були розіграші. Зберігається лише на цьому пристрої (localStorage), до MAX
 * останніх. Той самий матч (mid) записується один раз — оновлюється, а не дублюється.
 * Працює в браузері (window.Archive) і в Node (require) — тести без браузера.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../core/match.js"));
  else root.Archive = factory(root.Match);
})(typeof self !== "undefined" ? self : this, function (M) {
  "use strict";

  var KEY = "volleyball:archive";
  var MAX = 30;

  /* Коротко про матч — для списку, без повторного розбору всіх подій. */
  function summarize(m, now) {
    var s = M.reduce(m);
    var scores = s.setLog.map(function (x) { return [x.points[0], x.points[1]]; });
    if (!s.done && (s.points[0] || s.points[1])) scores.push([s.points[0], s.points[1]]);
    return {
      mid: m.mid,
      savedAt: now || Date.now(),
      startedAt: s.startedAt,
      done: s.done,
      winner: s.winner,
      title: s.title || "",
      names: s.names.slice(),
      sets: [s.sets[0], s.sets[1]],
      scores: scores,
      raw: M.serialize(m)
    };
  }

  function valid(e) {
    return !!(e && typeof e === "object" && typeof e.mid === "string" && typeof e.raw === "string" &&
              Array.isArray(e.names) && Array.isArray(e.sets) && Array.isArray(e.scores));
  }

  function load(storage) {
    try {
      var list = JSON.parse(storage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list.filter(valid) : [];
    } catch (e) { return []; }
  }

  /* Зберегти; місця не вистачає — викидаємо найстаріші, поки не влізе. true — збережено. */
  function save(storage, list) {
    list = list.slice();
    for (;;) {
      try {
        if (list.length) storage.setItem(KEY, JSON.stringify(list));
        else storage.removeItem(KEY);
        return true;
      } catch (e) {
        if (!list.length) return false;
        list.pop();
      }
    }
  }

  /* Додати або оновити матч. Матч без жодного розіграшу не зберігаємо. Новий список. */
  function put(list, m, now) {
    if (!M.reduce(m).rallies) return list;
    var e = summarize(m, now);
    var out = [e];
    for (var i = 0; i < list.length && out.length < MAX; i++) if (list[i].mid !== e.mid) out.push(list[i]);
    return out;
  }

  function remove(list, mid) { return list.filter(function (e) { return e.mid !== mid; }); }

  /* Матч з архіву (для протоколу й CSV) або null. */
  function open(list, mid) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].mid === mid) {
        try { return M.deserialize(list[i].raw); } catch (e) { return null; }
      }
    }
    return null;
  }

  /* «25:20, 23:25, 15:11» */
  function scoreLine(e) {
    return e.scores.map(function (p) { return p[0] + ":" + p[1]; }).join(", ");
  }

  return { KEY: KEY, MAX: MAX, summarize: summarize, load: load, save: save, put: put,
           remove: remove, open: open, scoreLine: scoreLine };
});
