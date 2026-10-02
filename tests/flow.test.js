"use strict";

/*
 * Наскрізний сценарій класичного волейболу (зала): повний матч на пʼять сетів
 * через справжні тапи на пульті, а табло для глядачів підключене поруч тим
 * самим каналом, що й у браузері. Перевіряє не окремі функції, а те, що
 * побачать суддя й зал від першої подачі до протоколу.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const scripts = ["match.js", "palettes.js", "ui-common.js", "remote.js"].map(read);

function makeBus() {
  const members = new Set();
  return function FakeChannel() {
    const self = this;
    members.add(self);
    self.onmessage = null;
    self.postMessage = (data) => {
      members.forEach((m) => { if (m !== self && m.onmessage) m.onmessage({ data: JSON.parse(JSON.stringify(data)) }); });
    };
    self.close = () => members.delete(self);
  };
}

function boot(file, own, bus) {
  const dom = new JSDOM(read(file), { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  win.BroadcastChannel = bus;
  win.confirm = () => true;
  scripts.concat(own.map(read)).forEach((s) => win.eval(s));
  const $ = (id) => win.document.getElementById(id);
  return {
    win, $, errors,
    text: (id) => ($(id).textContent || "").trim(),
    tap: (id) => $(id).dispatchEvent(new win.Event("click", { bubbles: true })),
    click: (el) => el.dispatchEvent(new win.Event("click", { bubbles: true })),
    close: () => win.close()
  };
}

const suite = JSDOM ? test : test.skip;

suite("повний матч у залі: пульт і табло від першої подачі до протоколу", (t) => {
  const bus = makeBus();
  const c = boot("index.html", ["app.js"], bus);
  const d = boot("display.html", ["sounds.js", "feed.js", "display.js"], bus);
  t.after(() => { c.close(); d.close(); });
  // Стан рахуємо ядром у самому Node: масиви з jsdom мають інший прототип і не проходять deepStrictEqual.
  const M = require("../match.js");
  const raw = () => c.win.localStorage.getItem("volleyball:match");
  const state = () => M.reduce(M.deserialize(raw()));

  /* Очко команді незалежно від того, на якій половині вона зараз. */
  const point = (team, n = 1) => {
    for (let i = 0; i < n; i++) c.tap(M.teamOnSide(state(), 0) === team ? "sideA" : "sideB");
  };
  /* Довести сет до рахунку a:b, чергуючи очки, щоб не закрити його раніше. */
  const playTo = (a, b) => {
    const s = state();
    let pa = a - s.points[0], pb = b - s.points[1];
    while (pa > 0 || pb > 0) {
      if (pa > 0) { point(0); pa--; }
      if (pb > 0) { point(1); pb--; }
    }
  };

  /* ---------- підготовка ---------- */
  c.tap("menuBtn");
  c.tap("mSettings");
  c.$("inTitle").value = "Кубок міста";
  c.$("inNameA").value = "Імідж";
  c.$("inNameB").value = "Ліцей";
  assert.equal(c.$("segPreset").querySelector('[aria-pressed="true"]').dataset.preset, "indoor", "за замовчуванням — зала");
  c.tap("sheetSave");

  c.tap("menuBtn");
  c.tap("mServe");
  c.tap("serveB_btn");
  assert.ok(c.$("serveB").className.includes("on"), "першим подає Ліцей");
  assert.ok(d.$("aServeB").className.includes("on"), "і на табло");
  assert.equal(d.text("aTitle"), "Кубок міста");
  assert.match(d.text("aFmt"), /до 3 перемог/);

  /* ---------- сет 1: 25:23 Імідж; тайм-аут, заміна, жовта ---------- */
  playTo(10, 10);
  c.tap("toA");
  assert.ok(c.$("toOverlay").classList.contains("show"));
  assert.ok(d.$("toOverlay").classList.contains("show"), "тайм-аут видно на табло");
  assert.match(d.text("toWho"), /Імідж/);
  c.tap("toStop");
  assert.equal(d.$("toOverlay").classList.contains("show"), false, "пульт закрив — табло закрило");
  assert.match(c.text("toA"), /●○/, "один тайм-аут лишився");

  c.tap("menuBtn");
  c.tap("mSubs");
  c.$("inSubOut").value = "7";
  c.$("inSubIn").value = "12";
  c.tap("subBtn");
  assert.match(d.text("bannerPts"), /7 → 12/, "заміна на табло");
  c.click(c.$("segTeam").children[1]);
  c.$("inCardPlayer").value = "4";
  c.click(c.win.document.querySelector('.card[data-card="yellow"]'));
  assert.match(d.text("bannerCap"), /Жовта/);
  assert.deepEqual(state().points, [10, 10], "жовта не змінює рахунок");
  c.$("subsSheet").dispatchEvent(new c.win.Event("click"));   // тап повз вікно

  playTo(23, 23);
  point(0, 1);
  assert.match(c.text("netInfo"), /сетбол · Імідж/);
  assert.match(d.text("aHint"), /сетбол · Імідж/);
  point(0, 1);
  assert.deepEqual(state().sets, [1, 0]);
  assert.match(d.text("bannerWho"), /Імідж виграла/);
  assert.match(d.text("aHistory"), /25–23/);
  assert.match(c.text("toA"), /●●/, "тайм-аути повернулись у новому сеті");

  /* ---------- сет 2: 20:25 Ліцей; червона, помилкове очко, скасування ---------- */
  playTo(15, 18);
  c.tap("sideA");                                   // помилково
  c.tap("undoBtn");
  assert.deepEqual(state().points, [15, 18], "⟲ прибрав помилку");
  c.tap("redoBtn");
  c.tap("undoBtn");
  c.tap("menuBtn");
  c.tap("mSubs");
  c.click(c.$("segTeam").children[0]);
  c.$("inCardPlayer").value = "9";
  c.click(c.win.document.querySelector('.card[data-card="red"]'));
  assert.deepEqual(state().points, [15, 19], "червона Іміджу — очко Ліцею");
  assert.equal(state().serving, 1, "і подача Ліцею");
  assert.match(d.text("bannerCap"), /Червона/);
  c.$("subsSheet").dispatchEvent(new c.win.Event("click"));
  playTo(20, 25);
  assert.deepEqual(state().sets, [1, 1]);

  /* ---------- сет 3: 25:27 Ліцей, баланс ---------- */
  playTo(24, 24);
  point(1); point(0); point(1); point(0);
  assert.deepEqual(state().points, [26, 26], "25:25 і 26:26 — сет триває");
  point(1); point(1);
  assert.deepEqual(state().sets, [1, 2], "різниця у два");
  assert.deepEqual(state().setLog[2].points, [26, 28]);

  /* ---------- сет 4: 25:15 Імідж ---------- */
  playTo(25, 15);
  assert.deepEqual(state().sets, [2, 2]);
  assert.match(c.text("netInfo"), /5-й сет · до 15/);
  assert.match(d.text("aSet"), /5-й сет/);

  /* ---------- сет 5: зміна сторін на 8, перемога 15:13 ---------- */
  playTo(8, 5);
  assert.match(c.text("netInfo"), /час міняти сторони/);
  assert.match(d.text("aHint"), /зміна сторін/);
  const leftBefore = d.text("aNameA");
  c.tap("menuBtn");
  c.tap("mSwap");
  assert.equal(c.text("nameA"), "Ліцей", "на пульті команди помінялись половинами");
  assert.notEqual(d.text("aNameA"), leftBefore, "і на табло");
  assert.equal(c.text("scoreA"), "5", "рахунок поїхав за командою");
  assert.doesNotMatch(c.text("netInfo"), /міняти сторони/, "нагадування зникло");

  playTo(13, 13);
  point(0);
  assert.match(c.text("netInfo"), /матчбол · Імідж/);
  point(0);

  /* ---------- кінець матчу ---------- */
  const s = state();
  assert.equal(s.done, true);
  assert.equal(s.winner, 0);
  assert.ok(c.$("final").classList.contains("show"));
  assert.match(c.text("finalWho"), /Імідж виграла/);
  assert.ok(d.$("final").classList.contains("show"));
  assert.match(d.text("finalWho"), /Імідж виграла/);
  assert.equal(d.text("finalCap"), "Кубок міста");
  assert.match(d.text("finalTally"), /^3:2\s+·\s+25–23\s+·\s+20–25/, "рахунок з боку переможця, хоч він після зміни сторін справа");

  /* ---------- протокол ---------- */
  c.tap("finalProto");
  assert.match(c.text("protoHead"), /^Кубок міста\s+·\s+Імідж — Ліцей\s+·\s+3:2/);
  const sets = c.text("protoSets");
  ["25", "23", "20", "26", "28", "15", "13"].forEach((n) => assert.ok(sets.includes(n), "у протоколі є " + n));
  assert.match(c.text("protoTrail"), /15:13$/, "після кінця — перебіг останнього сету");
  const ev = c.text("protoEvents");
  assert.match(ev, /заміна 7 → 12/);
  assert.match(ev, /жовта · №4/);
  assert.match(ev, /червона · №9/);
  const csv = M.toCSV(M.deserialize(raw()));
  assert.match(csv, /^сет,Імідж,Ліцей/);
  assert.match(csv, /сети,3,2/);

  /* ---------- помилкове останнє очко після кінця ---------- */
  c.tap("finalUndo");
  assert.equal(state().done, false);
  assert.equal(c.$("final").classList.contains("show"), false);
  assert.equal(d.$("final").classList.contains("show"), false, "табло повернулось у гру");
  point(0);
  assert.equal(state().done, true);

  /* ---------- перезавантаження пульта ---------- */
  const saved = c.win.localStorage.getItem("volleyball:match");
  const c2 = boot("index.html", [], makeBus());
  t.after(() => c2.close());
  c2.win.localStorage.setItem("volleyball:match", saved);
  c2.win.eval(read("app.js"));
  assert.ok(c2.$("final").classList.contains("show"), "після перезавантаження — той самий фінал");

  assert.deepEqual(c.errors.concat(d.errors, c2.errors), [], "жодної помилки в консолі");
});
