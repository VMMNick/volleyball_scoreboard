"use strict";

/*
 * Тести інтерфейсу в справжньому DOM (jsdom): тапи, підписи, вікна.
 * Потребує devDependency jsdom — решта тестів працює без залежностей.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const core = fs.readFileSync(path.join(root, "match.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

/* Піднімає застосунок у чистому DOM і повертає зручні хелпери. */
function boot() {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  win.eval(core);
  win.eval(app);

  const $ = (id) => win.document.getElementById(id);
  const text = (id) => ($(id).textContent || "").trim();
  const tap = (id) => { $(id).dispatchEvent(new win.Event("click", { bubbles: true })); };
  const score = () => [Number(text("scoreA")), Number(text("scoreB"))];
  const runSide = (id, n) => { for (let i = 0; i < n; i++) tap(id); };

  return { dom, win, $, text, tap, score, runSide, errors, close: () => win.close() };
}

const suite = JSDOM ? test : test.skip;

suite("тап по половині додає очко", (t) => {
  const ui = boot();
  t.after(ui.close);

  assert.deepEqual(ui.score(), [0, 0]);
  ui.tap("sideA");
  assert.deepEqual(ui.score(), [1, 0]);
  ui.tap("sideB");
  ui.tap("sideB");
  assert.deepEqual(ui.score(), [1, 2]);
  assert.deepEqual(ui.errors, [], "у консолі жодної помилки");
});

suite("подача показується біля команди, що виграла розіграш", (t) => {
  const ui = boot();
  t.after(ui.close);

  assert.equal(ui.$("serveA").className.includes("on"), false);
  ui.tap("sideA");
  assert.equal(ui.$("serveA").className.includes("on"), true);
  assert.equal(ui.$("serveB").className.includes("on"), false);
  ui.tap("sideB");
  assert.equal(ui.$("serveB").className.includes("on"), true);
});

suite("сет закривається і зʼявляється в історії", (t) => {
  const ui = boot();
  t.after(ui.close);

  ui.runSide("sideB", 19);
  ui.runSide("sideA", 25);
  assert.deepEqual(ui.score(), [0, 0], "новий сет із нуля");
  assert.match(ui.text("setsLog"), /25–19/);
  assert.match(ui.text("matchFmt"), /1:0/);
  assert.match(ui.text("netInfo"), /2-й сет/);
});

suite("сетбол і матчбол зʼявляються в сітці", (t) => {
  const ui = boot();
  t.after(ui.close);

  ui.runSide("sideA", 24);
  assert.match(ui.text("netInfo"), /сетбол/);

  ui.tap("sideA");                 // 1:0
  ui.runSide("sideA", 25);         // 2:0
  ui.runSide("sideA", 24);
  assert.match(ui.text("netInfo"), /матчбол/);
});

suite("переможець показується на весь екран", (t) => {
  const ui = boot();
  t.after(ui.close);

  for (let s = 0; s < 3; s++) ui.runSide("sideA", 25);
  assert.equal(ui.$("final").className.includes("show"), true);
  assert.match(ui.text("finalWho"), /Команда А виграла/);
  assert.match(ui.text("finalTally"), /3:0/);

  ui.tap("sideB");
  assert.deepEqual(ui.score(), [0, 0], "після матчу тапи не рахуються");
});

suite("скасування й повтор змінюють стан кнопок", (t) => {
  const ui = boot();
  t.after(ui.close);

  assert.equal(ui.$("undoBtn").disabled, true);
  ui.tap("sideA");
  assert.equal(ui.$("undoBtn").disabled, false);
  assert.equal(ui.$("redoBtn").disabled, true);

  ui.tap("undoBtn");
  assert.deepEqual(ui.score(), [0, 0]);
  assert.equal(ui.$("redoBtn").disabled, false);

  ui.tap("redoBtn");
  assert.deepEqual(ui.score(), [1, 0]);
});

suite("кнопка мінус ховається на нулі й знімає очко", (t) => {
  const ui = boot();
  t.after(ui.close);

  assert.equal(ui.$("minusA").style.visibility, "hidden");
  ui.runSide("sideA", 2);
  ui.tap("sideB");
  assert.equal(ui.$("minusA").style.visibility, "visible");

  ui.tap("minusA");
  assert.deepEqual(ui.score(), [1, 1], "знято очко саме в першої команди");
});

suite("тайм-аут запускає відлік і витрачається", (t) => {
  const ui = boot();
  t.after(ui.close);

  assert.match(ui.text("toA"), /●●/);
  ui.tap("toA");
  assert.equal(ui.$("toOverlay").className.includes("show"), true);
  assert.match(ui.text("toWho"), /Команда А/);
  assert.match(ui.text("toA"), /●○/);

  ui.tap("toStop");
  assert.equal(ui.$("toOverlay").className.includes("show"), false);

  ui.tap("toA");
  ui.tap("toStop");
  assert.match(ui.text("toA"), /○○/);
  assert.equal(ui.$("toA").className.includes("off"), true, "третій тайм-аут недоступний");

  ui.tap("toA");
  assert.equal(ui.$("toOverlay").className.includes("show"), false, "вікно не відкривається");
});

suite("зміна сторін міняє команди місцями", (t) => {
  const ui = boot();
  t.after(ui.close);

  ui.runSide("sideA", 3);
  ui.tap("menuBtn");
  ui.tap("mSwap");

  assert.equal(ui.text("nameA"), "Команда Б");
  assert.equal(ui.text("nameB"), "Команда А");
  assert.deepEqual(ui.score(), [0, 3], "рахунок поїхав за командою");
});

suite("налаштування застосовуються", (t) => {
  const ui = boot();
  t.after(ui.close);

  ui.tap("menuBtn");
  ui.tap("mSettings");
  ui.$("inNameA").value = "Сокіл";
  ui.$("inNameB").value = "Беркут";
  ui.$("inTarget").value = "21";
  ui.tap("sheetSave");

  assert.equal(ui.text("nameA"), "Сокіл");
  assert.equal(ui.text("nameB"), "Беркут");
  assert.match(ui.text("netInfo"), /до 21/);
  assert.equal(ui.$("sheet").className.includes("show"), false, "вікно закрилось");
});

suite("протокол збирає сети й статистику", (t) => {
  const ui = boot();
  t.after(ui.close);

  ui.runSide("sideB", 20);
  ui.runSide("sideA", 25);
  ui.runSide("sideA", 4);

  ui.tap("menuBtn");
  ui.tap("mProto");
  assert.equal(ui.$("proto").className.includes("show"), true);
  assert.match(ui.text("protoHead"), /1:0/);
  assert.match(ui.$("protoSets").innerHTML, /class="ca"[^>]*>(<b>)?25/);
  assert.match(ui.$("protoSets").innerHTML, /class="cb"[^>]*>(<b>)?20/);
  assert.match(ui.$("protoStats").textContent, /Найдовша серія/);
  assert.match(ui.text("protoTrail"), /1:0/);
});

suite("половини пофарбовані в кольори команд", (t) => {
  const ui = boot();
  t.after(ui.close);

  const root = ui.win.document.documentElement.style;
  const colorA = root.getPropertyValue("--team-a").trim();
  const colorB = root.getPropertyValue("--team-b").trim();
  assert.match(colorA, /^#[0-9A-Fa-f]{6}$/, "колір першої половини заданий");
  assert.notEqual(colorA, colorB, "половини різного кольору");

  const css = ui.win.document.head.textContent;
  assert.match(css, /\.side\.a\{background-color:var\(--team-a\)/);
  assert.match(css, /\.side\.b\{background-color:var\(--team-b\)/);
});

suite("палітра перемикається і зберігається", (t) => {
  const ui = boot();
  t.after(ui.close);

  const root = ui.win.document.documentElement.style;
  const was = root.getPropertyValue("--team-a").trim();

  ui.tap("menuBtn");
  ui.tap("mSettings");
  const swatches = ui.win.document.querySelectorAll(".pal");
  assert.ok(swatches.length >= 3, "є з чого вибрати");

  swatches[2].dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  const picked = root.getPropertyValue("--team-a").trim();
  assert.notEqual(picked, was, "колір змінився одразу, ще до збереження");

  ui.tap("sheetSave");
  assert.equal(root.getPropertyValue("--team-a").trim(), picked, "після збереження лишився");
  assert.match(ui.win.localStorage.getItem("volleyball:prefs"), /"palette"/);
});

suite("закриття налаштувань без збереження повертає колір", (t) => {
  const ui = boot();
  t.after(ui.close);

  const root = ui.win.document.documentElement.style;
  const was = root.getPropertyValue("--team-a").trim();

  ui.tap("menuBtn");
  ui.tap("mSettings");
  ui.win.document.querySelectorAll(".pal")[1]
    .dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  assert.notEqual(root.getPropertyValue("--team-a").trim(), was);

  ui.$("sheet").dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  assert.equal(root.getPropertyValue("--team-a").trim(), was, "колір відкотився");
});

suite("клавіатура дублює тапи", (t) => {
  const ui = boot();
  t.after(ui.close);

  const key = (k, opts) => ui.win.document.dispatchEvent(
    new ui.win.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true }, opts))
  );

  key("1"); key("1"); key("2");
  assert.deepEqual(ui.score(), [2, 1]);

  key("Backspace");
  assert.deepEqual(ui.score(), [2, 0]);

  key("Backspace", { shiftKey: true });
  assert.deepEqual(ui.score(), [2, 1]);

  key("q");
  assert.match(ui.text("toA"), /●○/);
  key("Escape");
  assert.equal(ui.$("toOverlay").className.includes("show"), false);
});

suite("рахунок відновлюється після перезавантаження", (t) => {
  const first = boot();
  first.runSide("sideA", 7);
  first.tap("sideB");
  const saved = first.win.localStorage.getItem("volleyball:match");
  first.close();
  assert.ok(saved, "стан записано");

  const second = boot();
  t.after(second.close);
  second.win.localStorage.setItem("volleyball:match", saved);
  second.win.eval(app);                    // повторний запуск читає збережене
  assert.deepEqual(second.score(), [7, 1]);
});
