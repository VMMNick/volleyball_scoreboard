"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("./helpers/site").load("match.js");

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

test("назва турніру зберігається, переживає новий матч і йде в протокол", () => {
  let m = M.createMatch();
  assert.equal(M.reduce(m).title, "", "за замовчуванням порожня");
  m = M.setTitle(m, "  Кубок міста  ");
  assert.equal(M.reduce(m).title, "Кубок міста", "пробіли обрізано");
  m = M.addPoint(m, 0, 1000);

  const back = M.deserialize(M.serialize(m));
  assert.equal(back.title, "Кубок міста");
  assert.equal(M.restart(back).title, "Кубок міста", "новий матч того ж турніру");
  assert.equal(M.protocol(back, 2000).title, "Кубок міста");
});

test("старі збереження без назви читаються", () => {
  const old = JSON.stringify({ v: 1, names: ["А", "Б"], rules: M.DEFAULT_RULES, events: [], undone: [] });
  assert.equal(M.deserialize(old).title, "");
});

test("пресети: пляж міняє сторони кожні 7 очок, у вирішальному — кожні 5", () => {
  const beach = M.presetById("beach").rules;
  let m = M.createMatch({ rules: beach });
  const due = () => M.sideSwapDue(M.reduce(m));

  for (let i = 0; i < 4; i++) m = M.addPoint(m, 0, 1000);
  for (let i = 0; i < 3; i++) m = M.addPoint(m, 1, 1000);
  assert.equal(due(), true, "7 очок у сумі");
  m = M.swapSides(m);
  assert.equal(due(), false, "після зміни нагадування зникає");
  m = M.addPoint(m, 0, 1000);
  assert.equal(due(), false);
  for (let i = 0; i < 6; i++) m = M.addPoint(m, 1, 1000);
  assert.equal(due(), true, "14 очок у сумі — знову");
  m = M.undo(m);
  assert.equal(due(), false, "13 — ні");
});

test("пресети: пляжний вирішальний сет до 15 зі зміною кожні 5", () => {
  let m = M.createMatch({ rules: M.presetById("beach").rules });
  const win = (team, n) => { for (let i = 0; i < n; i++) m = M.addPoint(m, team, 1000); };
  win(0, 21); win(1, 21);
  const s = M.reduce(m);
  assert.equal(s.isDecider, true);
  assert.equal(s.target, 15);
  win(0, 3); win(1, 2);
  assert.equal(M.sideSwapDue(M.reduce(m)), true);
  assert.equal(M.reduce(m).timeouts[0], 1, "один тайм-аут на пляжі");
});

test("presetOf впізнає пресет і повертає null для своїх правил", () => {
  assert.equal(M.presetOf(M.createMatch().rules), "indoor", "за замовчуванням — зала");
  assert.equal(M.presetOf(M.presetById("beach").rules), "beach");
  assert.equal(M.presetOf(M.setRules(M.createMatch(), { target: 30 }).rules), null);
});

test("старі збереження без нових полів отримують правила зали", () => {
  const old = { bestOf: 5, target: 25, decider: 15, winBy: 2, cap: 0, capDecider: 0, timeouts: 2 };
  const m = M.deserialize(JSON.stringify({ v: 1, names: ["А", "Б"], rules: old, events: [], undone: [] }));
  assert.equal(m.rules.deciderSwapAt, 8);
  assert.equal(m.rules.swapEvery, 0);
});

/* ---------- заміни й картки ---------- */

test("заміни: ліміт на сет, скидання в новому сеті, журнал", () => {
  let m = M.createMatch();
  for (let i = 0; i < 6; i++) m = M.substitute(m, 0, String(i + 1), String(i + 10), 1000 + i);
  assert.equal(M.reduce(m).subsUsed[0], 6);
  const full = m;
  m = M.substitute(m, 0, "7", "17");
  assert.equal(m, full, "сьома заміна не приймається");
  assert.equal(M.substitute(m, 1, "3", "3"), m, "однакові номери — не заміна");
  assert.equal(M.substitute(m, 1, "", "4"), m, "без номера — не заміна");

  for (let i = 0; i < 25; i++) m = M.addPoint(m, 0, 2000);
  const s = M.reduce(m);
  assert.deepEqual(s.subsUsed, [0, 0], "новий сет — нові заміни");
  assert.equal(s.subLog.length, 6, "журнал матчу зберігся");
  assert.deepEqual(s.subLog[0], { team: 0, out: "1", in: "10", set: 1, score: [0, 0], ts: 1000 });
});

test("червона картка — очко й подача суперникові; жовта — без наслідків", () => {
  let m = M.createMatch();
  m = M.addPoint(m, 0, 1000);                 // подає А
  m = M.giveCard(m, 0, "yellow", "7", 1001);
  let s = M.reduce(m);
  assert.deepEqual(s.points, [1, 0]);
  m = M.giveCard(m, 0, "red", "7", 1002);
  s = M.reduce(m);
  assert.deepEqual(s.points, [1, 1], "очко Б");
  assert.equal(s.serving, 1, "подача до Б");
  assert.equal(s.cards.length, 2);
  assert.equal(s.lastCard.kind, "red");
  assert.equal(M.giveCard(m, 0, "purple"), m, "невідома картка ігнорується");

  m = M.undo(m);
  assert.deepEqual(M.reduce(m).points, [1, 0], "скасування знімає і штрафне очко");
});

test("червона картка може закрити сет, а перебіг сету її враховує", () => {
  let m = M.createMatch();
  for (let i = 0; i < 24; i++) m = M.addPoint(m, 1, 1000);
  for (let i = 0; i < 23; i++) m = M.addPoint(m, 0, 1000);
  m = M.giveCard(m, 0, "red", "", 2000);       // 23:25 — сет Б
  const s = M.reduce(m);
  assert.equal(s.sets[1], 1);
  assert.deepEqual(s.setLog[0].points, [23, 25]);
  const trail = M.rallyTrail(m, 0);
  assert.deepEqual(trail[trail.length - 1], [23, 25]);
});

test("протокол і CSV містять заміни й картки", () => {
  let m = M.createMatch({ names: ["Імідж", "Ліцей"] });
  m = M.substitute(m, 1, "4", "9", 1000);
  m = M.giveCard(m, 0, "expulsion", "11", 1001);
  const p = M.protocol(m, 2000);
  assert.equal(p.subs.length, 1);
  assert.equal(p.cards[0].kind, "expulsion");
  const csv = M.toCSV(m);
  assert.match(csv, /заміна,Ліцей,4 → 9/);
  assert.match(csv, /картка: вилучення,Імідж,11/);
});

test("на пляжі замін немає", () => {
  const m = M.createMatch({ rules: M.presetById("beach").rules });
  assert.equal(M.substitute(m, 0, "1", "2"), m);
});

/* ---------- технічний тайм-аут ---------- */

test("пляж: технічний тайм-аут на 21 сумарному очку, раз на сет, не у вирішальному", () => {
  let m = M.createMatch({ rules: M.presetById("beach").rules });
  const add = (t, n) => { for (let i = 0; i < n; i++) m = M.addPoint(m, t, 1000); };
  add(0, 11); add(1, 9);
  assert.equal(M.techTimeoutDue(M.reduce(m)), false, "20 — ще ні");
  add(1, 1);
  assert.equal(M.techTimeoutDue(M.reduce(m)), true, "21 — так");
  m = M.takeTechTimeout(m, 5000);
  let s = M.reduce(m);
  assert.equal(M.techTimeoutDue(s), false);
  assert.deepEqual(s.lastTimeout, { team: -1, tech: true, ts: 5000 });
  assert.deepEqual(s.timeouts, [1, 1], "командні тайм-аути не витрачено");
  assert.equal(M.takeTechTimeout(m), m, "вдруге — ні");

  add(0, 10);                                   // 21:10 — сет А
  add(1, 21);                                   // 1:1 — вирішальний
  add(0, 11); add(1, 10);
  assert.equal(M.techTimeoutDue(M.reduce(m)), false, "у вирішальному технічного немає");
});

test("у залі технічного тайм-ауту немає", () => {
  let m = M.createMatch();
  for (let i = 0; i < 21; i++) m = M.addPoint(m, i % 2, 1000);
  assert.equal(M.techTimeoutDue(M.reduce(m)), false);
});

test("пауза після кінця матчу: 10 с рахунок останнього сету, потім фінал", () => {
  let m = M.createMatch({ rules: { bestOf: 1 } });
  for (let i = 0; i < 24; i++) m = M.addPoint(m, 0, 1000 + i);
  m = M.addPoint(m, 1, 2000);
  m = M.addPoint(m, 0, 5000);                       // 25:1 — матч завершено о 5000
  const s = M.reduce(m);
  assert.equal(s.done, true);
  assert.equal(M.FINAL_HOLD_MS, 10000);
  assert.equal(M.finalHoldLeft(s, 5000), 10000);
  assert.equal(M.finalHoldLeft(s, 12000), 3000);
  assert.equal(M.finalHoldLeft(s, 15000), 0, "через 10 с — фінал");
  assert.deepEqual(M.shownPoints(s, 6000), [25, 1], "під час паузи — рахунок сету");
  assert.deepEqual(M.shownPoints(s, 16000), [0, 0]);
  assert.equal(M.finalHoldLeft(M.reduce(M.createMatch()), 5000), 0, "незавершений матч — без паузи");
  assert.equal(M.finalHoldLeft(s, 1000), 10000, "годинник глядача позаду — не довше 10 с");
});

/* ---------- перевірка даних ---------- */

test("validate: справжній матч проходить, зіпсований — ні", () => {
  let m = M.createMatch({ names: ["Імідж", "Ліцей"] });
  m = M.addPoint(m, 0, 1000);
  m = M.callTimeout(m, 1, 2000);
  m = M.substitute(m, 0, "7", "12", 3000);
  m = M.giveCard(m, 1, "yellow", "4", 4000);
  m = M.swapSides(m, 5000);
  m = M.undo(m);
  assert.deepEqual(M.validate(JSON.parse(M.serialize(m))), [], "усе, що вміє робити пульт, — валідне");
  for (const p of M.PRESETS) {
    assert.deepEqual(M.validate(JSON.parse(M.serialize(M.createMatch({ rules: p.rules })))), [], "пресет " + p.id);
  }

  const base = () => JSON.parse(M.serialize(M.createMatch()));
  const bad = (patch, why) => {
    const d = Object.assign(base(), patch);
    assert.ok(M.validate(d).length > 0, why);
  };
  bad({ events: [null] }, "null замість події");
  bad({ events: [{ type: "point", team: 7, ts: 1 }] }, "команда 7");
  bad({ events: [{ type: "point", team: "__proto__", ts: 1 }] }, "команда-рядок");
  bad({ events: [{ team: 0, ts: 1 }] }, "подія без типу");
  bad({ events: [{ type: "point", team: 0, ts: "вчора" }] }, "час не число");
  bad({ events: [{ type: "card", team: 0, kind: "pink", ts: 1 }] }, "невідома картка");
  bad({ events: [{ type: "sub", team: 0, out: 7, in: "8", ts: 1 }] }, "номер не рядок");
  bad({ undone: [null] }, "зіпсоване в undone");
  bad({ names: ["А"] }, "одна назва");
  bad({ names: ["А", "Б".repeat(500)] }, "задовга назва");
  bad({ rules: { target: -1 } }, "очок −1");
  bad({ rules: { bestOf: 4 } }, "парна кількість сетів");
  bad({ rules: { timeouts: 1.5 } }, "дробові тайм-аути");
  bad({ events: Array.from({ length: 5001 }, (_, i) => ({ type: "swap", ts: i })) }, "забагато подій");
  assert.ok(M.validate(null).length > 0);
  assert.deepEqual(M.validate(Object.assign(base(), { events: [{ type: "майбутня-подія", ts: 1 }] })), [],
    "невідомий тип від новішої версії пульта не відкидаємо — reduce його просто пропустить");
});

test("deserialize викидає лише зіпсоване, а табло не падає", () => {
  const raw = JSON.stringify({
    v: 1, names: [null, "Ліцей".repeat(30)], title: 5,
    rules: { target: -1, decider: 15, bestOf: 3, evil: "x" },
    events: [null, { type: "point", team: 0, ts: 1 }, { type: "point", team: 7, ts: 2 }, "рядок",
             { type: "card", team: 1, kind: "red", ts: 3 }, { type: "point", team: 1, ts: 4 }],
    undone: [42, { type: "point", team: 0, ts: 5 }]
  });
  const m = M.deserialize(raw);
  assert.equal(m.events.length, 3, "лишились три справжні події");
  assert.equal(m.undone.length, 1);
  assert.equal(m.names[0], "Команда А", "порожня назва → типова");
  assert.ok(m.names[1].length <= 60);
  assert.equal(m.title, "");
  assert.equal(m.rules.target, 25, "неправильне правило → типове");
  assert.equal(m.rules.bestOf, 3, "правильні правила лишаються");
  assert.equal("evil" in m.rules, false, "невідомі поля в правила не потрапляють");
  const s = M.reduce(m);
  assert.deepEqual(s.points, [2, 1], "очко А, червона картка Б (очко А), очко Б");
  assert.deepEqual(M.validate(JSON.parse(M.serialize(m))), [], "після чистки матч валідний");
});

/* ---------- злиття двох пультів (етап 2: два судді без втрат) ---------- */

const sync = (raw) => M.deserialize(typeof raw === "string" ? raw : M.serialize(raw));   // «через мережу»
const pts = (m) => M.reduce(m).points;

test("злиття: очки обох суддів, набрані окремо, складаються; порядок — за часом", () => {
  const base = M.addPoint(M.createMatch({ names: ["А", "Б"] }), 0, 1000);
  const host = M.addPoint(sync(base), 0, 2000);          // 2:0 у основного
  const judge = M.addPoint(sync(base), 1, 1500);         // 1:1 у другого (раніше за часом)
  const a = M.merge(host, sync(judge)), b = M.merge(judge, sync(host));
  assert.deepEqual(pts(a), [2, 1]);
  assert.equal(M.syncKey(a), M.syncKey(b), "обидва пристрої сходяться до одного й того самого");
  assert.deepEqual(a.events.map((e) => e.ts), [1000, 1500, 2000]);
  assert.equal(M.syncKey(M.merge(a, sync(a))), M.syncKey(a), "повторне злиття нічого не змінює");
  assert.deepEqual(M.validate(JSON.parse(M.serialize(a))), []);
});

test("злиття: скасоване й зняте на одному пульті не воскресає з іншого", () => {
  let base = M.createMatch();
  base = M.addPoint(base, 0, 1000);
  base = M.addPoint(base, 1, 2000);
  const host = M.undo(sync(base));                       // скасував очко Б
  const judge = M.removeLastPoint(sync(base), 0);        // зняв очко А
  const m = M.merge(host, sync(judge));
  assert.deepEqual(pts(m), [0, 0]);
  assert.equal(m.removed.length, 2);
  const again = M.merge(M.redo(host), sync(judge));      // повтор — нова подія, а не воскресіння старої
  assert.deepEqual(pts(again), [0, 1]);
  assert.notEqual(M.redo(host).events[1].id, base.events[1].id);
});

test("злиття: новий матч виграє, старі очки до нього не потрапляють", () => {
  const old = M.addPoint(M.createMatch({ created: 1000 }), 0, 2000);
  const judgeOffline = M.addPoint(sync(old), 1, 3000);
  const fresh = M.restart(old);
  fresh.created = 4000;
  assert.notEqual(fresh.mid, old.mid);
  assert.deepEqual(pts(M.merge(judgeOffline, sync(fresh))), [0, 0], "суддя переходить на новий матч");
  assert.deepEqual(pts(M.merge(fresh, sync(judgeOffline))), [0, 0], "і новий матч не бере старих очок");
});

test("злиття: назви й правила — від того, хто змінив пізніше", () => {
  const base = M.createMatch({ names: ["А", "Б"] });
  const host = M.rename(sync(base), 0, "Імідж");
  const judge = M.addPoint(sync(base), 1, base.created + 10);
  const m = M.merge(judge, sync(host));
  assert.equal(m.names[0], "Імідж", "перейменування не губиться від очка судді");
  assert.deepEqual(pts(m), [0, 1]);
  assert.equal(M.merge(host, sync(judge)).names[0], "Імідж");
});

test("сумісність: стан старої версії (без id) не зливається — діє як раніше, без подвоєння очок", () => {
  const host = M.addPoint(M.addPoint(M.createMatch(), 0, 1000), 0, 2000);
  const legacy = JSON.stringify({ v: 1, names: ["А", "Б"], rules: {}, events: [{ type: "point", team: 0, ts: 1000 }], undone: [] });
  const m = M.merge(host, M.deserialize(legacy));
  assert.deepEqual(pts(m), [1, 0], "старий пульт надіслав 1:0 — так і є, а не 3:0");
  const a = M.deserialize(legacy), b = M.deserialize(legacy);
  assert.equal(a.events[0].id, b.events[0].id, "старим подіям id дається однаково на кожному пристрої");
  assert.equal(M.deserialize(M.serialize(a)).v, 2, "після збереження — уже нова версія");
});

test("годинник: подія після отриманого стану стоїть після нього, навіть якщо свій годинник відстає", () => {
  const future = Date.now() + 10 * 60 * 1000;          // годинник іншого телефона на 10 хв попереду
  const theirs = M.addPoint(M.createMatch(), 0, future);
  const mine = M.addPoint(sync(theirs), 1);            // ts не задано — бере годинник пристрою
  assert.ok(mine.events[1].ts > future);
  assert.deepEqual(M.merge(sync(theirs), sync(mine)).events.map((e) => e.team), [0, 1]);
});

test("syncKey не залежить від «повторити» і порядку видалених — пристроям нема чого пересилати", () => {
  let m = M.addPoint(M.addPoint(M.createMatch(), 0, 1000), 1, 2000);
  m = M.undo(m);
  const other = sync(m);
  other.undone = [];
  other.removed = other.removed.slice().reverse();
  assert.equal(M.syncKey(m), M.syncKey(other));
  assert.notEqual(M.syncKey(m), M.syncKey(M.addPoint(m, 0, 3000)));
});
