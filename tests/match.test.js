"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../match.js");

/* Допоміжне: зіграти послідовність очок, напр. "AABBA". */
function play(m, seq, startTs) {
  let ts = startTs || 1000;
  for (const ch of seq) {
    m = M.addPoint(m, ch === "A" || ch === "a" ? 0 : 1, ts);
    ts += 30000;
  }
  return m;
}

/* Дати команді n очок поспіль. */
function run(m, team, n) {
  for (let i = 0; i < n; i++) m = M.addPoint(m, team, 1000 + i * 30000);
  return m;
}

test("новий матч порожній", () => {
  const s = M.reduce(M.createMatch());
  assert.deepEqual(s.points, [0, 0]);
  assert.deepEqual(s.sets, [0, 0]);
  assert.equal(s.serving, null, "до першого розіграшу подача не визначена");
  assert.equal(s.done, false);
  assert.equal(s.setNumber, 1);
  assert.equal(s.target, 25);
  assert.equal(s.setsNeeded, 3, "з пʼяти сетів треба виграти три");
});

test("очко міняє рахунок і віддає подачу", () => {
  let m = M.addPoint(M.createMatch(), 0);
  let s = M.reduce(m);
  assert.deepEqual(s.points, [1, 0]);
  assert.equal(s.serving, 0);
  assert.equal(s.lastPoint.sideOut, false, "перше очко не рахується переходом подачі");

  m = M.addPoint(m, 1);
  s = M.reduce(m);
  assert.deepEqual(s.points, [1, 1]);
  assert.equal(s.serving, 1);
  assert.equal(s.lastPoint.sideOut, true, "подача перейшла до суперника");
});

test("сет закривається на 25 при різниці два", () => {
  let m = M.createMatch();
  m = run(m, 1, 19);
  m = run(m, 0, 25);
  const s = M.reduce(m);
  assert.deepEqual(s.sets, [1, 0]);
  assert.deepEqual(s.points, [0, 0], "очки обнуляються");
  assert.equal(s.serving, null, "новий сет — подача не визначена");
  assert.equal(s.setLog.length, 1);
  assert.deepEqual(s.setLog[0].points, [25, 19]);
  assert.equal(s.setLog[0].winner, 0);
  assert.equal(s.setNumber, 2);
});

test("при 24:24 грають до різниці у два", () => {
  let m = M.createMatch();
  m = play(m, "AB".repeat(24));            // 24:24
  let s = M.reduce(m);
  assert.deepEqual(s.points, [24, 24]);

  m = M.addPoint(m, 0);                    // 25:24 — сет триває
  s = M.reduce(m);
  assert.deepEqual(s.sets, [0, 0]);
  assert.deepEqual(s.points, [25, 24]);

  m = M.addPoint(m, 0);                    // 26:24 — сет узято
  s = M.reduce(m);
  assert.deepEqual(s.sets, [1, 0]);
  assert.deepEqual(s.setLog[0].points, [26, 24]);
});

test("стеля очок закриває нескінченний сет", () => {
  let m = M.createMatch({ rules: { cap: 27 } });
  m = play(m, "AB".repeat(26));            // 26:26
  m = M.addPoint(m, 1);                    // 26:27 — стеля
  const s = M.reduce(m);
  assert.deepEqual(s.sets, [0, 1]);
  assert.deepEqual(s.setLog[0].points, [26, 27], "перемога з різницею в одне очко");
});

test("вирішальний сет коротший", () => {
  let m = M.createMatch();
  m = run(m, 0, 25); m = run(m, 1, 25);
  m = run(m, 0, 25); m = run(m, 1, 25);    // 2:2
  let s = M.reduce(m);
  assert.equal(s.isDecider, true);
  assert.equal(s.target, 15);
  assert.equal(s.setNumber, 5);

  m = run(m, 0, 15);
  s = M.reduce(m);
  assert.equal(s.done, true);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.sets, [3, 2]);
});

test("матч зупиняється після третього сету", () => {
  let m = M.createMatch();
  m = run(m, 0, 25); m = run(m, 0, 25); m = run(m, 0, 25);
  let s = M.reduce(m);
  assert.equal(s.done, true);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.sets, [3, 0]);

  const after = M.reduce(M.addPoint(m, 1));
  assert.deepEqual(after.points, [0, 0], "очки після завершення не додаються");
  assert.deepEqual(after.sets, [3, 0]);
});

test("формат в один сет", () => {
  let m = M.createMatch({ rules: { bestOf: 1 } });
  const s0 = M.reduce(m);
  assert.equal(s0.setsNeeded, 1);
  assert.equal(s0.isDecider, false, "єдиний сет грається за звичайними правилами");
  assert.equal(s0.target, 25);

  m = run(m, 1, 25);
  const s = M.reduce(m);
  assert.equal(s.done, true);
  assert.equal(s.winner, 1);
});

test("скасування повертає закритий сет", () => {
  let m = M.createMatch();
  m = run(m, 1, 19); m = run(m, 0, 25);
  assert.deepEqual(M.reduce(m).sets, [1, 0]);

  m = M.undo(m);
  const s = M.reduce(m);
  assert.deepEqual(s.sets, [0, 0], "сет розкрився назад");
  assert.deepEqual(s.points, [24, 19]);
  assert.equal(s.setLog.length, 0);
});

test("повтор відновлює скасоване, нова дія обриває гілку", () => {
  let m = run(M.createMatch(), 0, 3);
  m = M.undo(m); m = M.undo(m);
  assert.deepEqual(M.reduce(m).points, [1, 0]);
  assert.equal(M.canRedo(m), true);

  m = M.redo(m);
  assert.deepEqual(M.reduce(m).points, [2, 0]);

  m = M.addPoint(m, 1);
  assert.equal(M.canRedo(m), false, "після нової дії повторювати нічого");
  assert.deepEqual(M.reduce(m).points, [2, 1]);
});

test("скасування на порожньому матчі нічого не ламає", () => {
  const m = M.createMatch();
  assert.equal(M.canUndo(m), false);
  assert.deepEqual(M.reduce(M.undo(m)).points, [0, 0]);
  assert.deepEqual(M.reduce(M.redo(m)).points, [0, 0]);
});

test("тайм-аути: два на сет, зайвий ігнорується", () => {
  let m = M.createMatch();
  m = M.callTimeout(m, 0);
  m = M.callTimeout(m, 0);
  let s = M.reduce(m);
  assert.deepEqual(s.timeouts, [0, 2]);
  assert.deepEqual(s.timeoutsUsed, [2, 0]);

  const before = m.events.length;
  m = M.callTimeout(m, 0);
  assert.equal(m.events.length, before, "третій тайм-аут навіть не записується");
});

test("тайм-аути поновлюються в новому сеті", () => {
  let m = M.createMatch();
  m = M.callTimeout(m, 0);
  m = M.callTimeout(m, 1);
  m = run(m, 0, 25);
  const s = M.reduce(m);
  assert.deepEqual(s.timeouts, [2, 2], "у новому сеті знову по два");
  assert.deepEqual(s.timeoutsUsed, [1, 1], "витрачені за матч лишаються для протоколу");
});

test("зміна сторін не міняє належність очок", () => {
  let m = M.createMatch({ names: ["Сокіл", "Беркут"] });
  m = run(m, 0, 5);
  m = M.swapSides(m);
  const s = M.reduce(m);

  assert.deepEqual(s.points, [5, 0], "рахунок лишається за командами");
  assert.equal(s.flipped, true);
  assert.equal(M.teamOnSide(s, 0), 1, "на першій стороні тепер друга команда");
  assert.equal(s.names[M.teamOnSide(s, 0)], "Беркут");
});

test("у вирішальному сеті на 8 очках просить змінити сторони", () => {
  let m = M.createMatch();
  m = run(m, 0, 25); m = run(m, 1, 25);
  m = run(m, 0, 25); m = run(m, 1, 25);
  m = run(m, 0, 7);
  assert.equal(M.sideSwapDue(M.reduce(m)), false);

  m = M.addPoint(m, 0);                    // 8:0
  assert.equal(M.sideSwapDue(M.reduce(m)), true);

  m = M.swapSides(m);
  assert.equal(M.sideSwapDue(M.reduce(m)), false, "після зміни нагадування зникає");
});

test("у звичайному сеті сторони не міняють", () => {
  const m = run(M.createMatch(), 0, 12);
  assert.equal(M.sideSwapDue(M.reduce(m)), false);
});

test("сетбол і матчбол", () => {
  let m = M.createMatch();
  m = run(m, 0, 24);
  let s = M.reduce(m);
  assert.equal(M.setPointFor(s), 0);
  assert.equal(M.matchPointFor(s), null, "перший сет — це ще не матч");

  m = run(m, 0, 1);                        // 1:0 по сетах
  m = run(m, 0, 25);                       // 2:0
  m = run(m, 0, 24);                       // 24:0 у третьому
  s = M.reduce(m);
  assert.equal(M.matchPointFor(s), 0);
});

test("сетбол зникає, коли суперник наздоганяє", () => {
  let m = M.createMatch();
  m = run(m, 0, 24); m = run(m, 1, 24);    // 24:24
  assert.equal(M.setPointFor(M.reduce(m)), null);
});

test("статистика: серії, відрив, розіграші", () => {
  let m = M.createMatch();
  m = play(m, "AAAAABBBA");                // 5 поспіль, потім 3, потім 1
  const s = M.reduce(m);
  assert.equal(s.rallies, 9);
  assert.deepEqual(s.pointsWon, [6, 3]);
  assert.deepEqual(s.bestStreak, [5, 3]);
  assert.deepEqual(s.biggestLead, [5, 0], "друга команда не вела жодного разу");
  assert.deepEqual(s.streak, { team: 0, n: 1 });
});

test("протокол збирає сети, тривалість і статистику", () => {
  const min = 60000;
  let m = M.createMatch({ names: ["Сокіл", "Беркут"], rules: { bestOf: 3 } });
  m = run(m, 0, 25);
  m = M.addPoint(m, 1, 1000 + 30 * min);
  const p = M.protocol(m, 1000 + 40 * min);

  assert.deepEqual(p.names, ["Сокіл", "Беркут"]);
  assert.deepEqual(p.sets, [1, 0]);
  assert.equal(p.done, false);
  assert.equal(p.setLog.length, 1);
  assert.equal(p.setLog[0].rallies, 25);
  assert.deepEqual(p.current.points, [0, 1]);
  assert.equal(p.current.setNumber, 2);
  assert.equal(p.durationMs, 40 * min, "поки матч іде, годинник рахує до поточного часу");
  assert.equal(p.stats.rallies, 26);
});

test("тривалість завершеного матчу не росте", () => {
  let m = M.createMatch({ rules: { bestOf: 1 } });
  m = run(m, 0, 25);                       // останнє очко на 1000 + 24*30000
  const s = M.reduce(m);
  const d = M.durationMs(s, Date.now());
  assert.equal(d, 24 * 30000);
});

test("перебіг сету по очках", () => {
  let m = M.createMatch({ rules: { bestOf: 1, target: 5, decider: 5 } });
  m = play(m, "AABA");
  assert.deepEqual(M.rallyTrail(m, 0), [[1, 0], [2, 0], [2, 1], [3, 1]]);
});

test("перебіг рахує кожен сет окремо", () => {
  let m = M.createMatch({ rules: { bestOf: 3, target: 3, decider: 3, winBy: 1 } });
  m = play(m, "AAA");                      // сет 1
  m = play(m, "BBB");                      // сет 2
  assert.deepEqual(M.rallyTrail(m, 0), [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(M.rallyTrail(m, 1), [[0, 1], [0, 2], [0, 3]]);
});

test("CSV містить рядок на кожен сет", () => {
  let m = M.createMatch({ names: ["Сокіл", "Беркут"], rules: { bestOf: 3 } });
  m = run(m, 1, 20); m = run(m, 0, 25);
  m = run(m, 1, 3);
  const rows = M.toCSV(m).split("\n");
  assert.equal(rows[0], "сет,Сокіл,Беркут,розіграшів,хвилин");
  assert.match(rows[1], /^1,25,20,45/);
  assert.match(rows[2], /триває/);
  assert.equal(rows[3], "сети,1,0,,");
});

test("матч переживає збереження", () => {
  let m = M.createMatch({ names: ["Сокіл", "Беркут"], rules: { bestOf: 3, cap: 27 } });
  m = run(m, 0, 25); m = run(m, 1, 10);
  m = M.callTimeout(m, 0);
  m = M.swapSides(m);

  const back = M.deserialize(M.serialize(m));
  assert.deepEqual(M.reduce(back), M.reduce(m), "стан збігається до останнього поля");
  assert.equal(back.rules.cap, 27);
  assert.deepEqual(back.names, ["Сокіл", "Беркут"]);
});

test("сміття замість збереження не валить застосунок", () => {
  assert.equal(M.deserialize(null), null);
  assert.equal(M.deserialize('{"v":1}'), null);
  assert.throws(() => M.deserialize("не json"));
});

test("подача на початку сету задається вручну", () => {
  let m = M.setServer(M.createMatch(), 1);
  assert.equal(M.reduce(m).serving, 1);

  m = M.addPoint(m, 1);
  assert.equal(M.reduce(m).lastPoint.sideOut, false, "подавали й виграли — переходу немає");

  const before = m.events.length;
  m = M.setServer(m, 0);
  assert.equal(m.events.length, before, "після початку сету подачу вже не переназначити");
});

test("назви й правила змінюються без втрати рахунку", () => {
  let m = run(M.createMatch(), 0, 7);
  m = M.rename(m, 0, "Сокіл");
  m = M.setRules(m, { target: 21 });
  const s = M.reduce(m);
  assert.equal(s.names[0], "Сокіл");
  assert.equal(s.target, 21);
  assert.deepEqual(s.points, [7, 0]);
});

test("дії не мутують попередній стан", () => {
  const m0 = M.createMatch();
  const m1 = M.addPoint(m0, 0);
  assert.equal(m0.events.length, 0, "старий обʼєкт лишився недоторканим");
  assert.equal(m1.events.length, 1);
});

test("некоректна команда відхиляється", () => {
  assert.throws(() => M.addPoint(M.createMatch(), 2), /0 або 1/);
});

test("зняття очка прибирає розіграш саме цієї команди", () => {
  let m = play(M.createMatch(), "AABBB");    // 2:3
  m = M.removeLastPoint(m, 0);               // мінус у першої
  const s = M.reduce(m);
  assert.deepEqual(s.points, [1, 3], "очки суперника на місці");
  assert.equal(s.rallies, 4);
});

test("зняття очка може відкрити завершений матч", () => {
  let m = M.createMatch({ rules: { bestOf: 1 } });
  m = run(m, 0, 25);
  assert.equal(M.reduce(m).done, true);

  m = M.removeLastPoint(m, 0);
  const s = M.reduce(m);
  assert.equal(s.done, false, "суддя може виправити помилкове останнє очко");
  assert.deepEqual(s.points, [24, 0]);
});

test("зняття очка в команди без очок нічого не робить", () => {
  const m = run(M.createMatch(), 0, 3);
  assert.equal(M.removeLastPoint(m, 1), m);
});
