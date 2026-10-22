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

const { root, read, file } = require("./helpers/site");
const html = read("index.html");
const core = read("match.js");
const palettes = read("palettes.js");
const common = read("ui-common.js");
const remoteJs = read("remote.js");
const linkJs = read("link.js");
const archiveJs = read("archive.js");
const app = read("pult.js");

/* Піднімає застосунок у чистому DOM і повертає зручні хелпери. */
function boot() {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  win.eval(core);
  win.eval(palettes);
  win.eval(common);
  win.eval(remoteJs);
  win.eval(linkJs);
  win.eval(archiveJs);
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

suite("переможець показується на весь екран — після паузи з рахунком останнього сету", async (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.win.Match.finalHoldMs = 120;                    // у житті — 10 с

  for (let s = 0; s < 3; s++) ui.runSide("sideA", 25);
  assert.equal(ui.$("final").className.includes("show"), false, "одразу після очка — ще рахунок");
  assert.deepEqual(ui.score(), [25, 0], "видно рахунок останнього сету");
  await new Promise((r) => setTimeout(r, 300));
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

suite("назва турніру з налаштувань потрапляє в протокол", (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.tap("menuBtn");
  ui.tap("mSettings");
  ui.$("inTitle").value = "Кубок міста";
  ui.tap("sheetSave");
  ui.tap("sideA");
  ui.tap("menuBtn");
  ui.tap("mProto");
  assert.match(ui.text("protoHead"), /^Кубок міста/);
  assert.match(ui.win.localStorage.getItem("volleyball:match"), /"title":"Кубок міста"/);
});

suite("пресет «Пляж» заповнює поля й діє після збереження", (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.tap("menuBtn");
  ui.tap("mSettings");
  const beach = [...ui.$("segPreset").children].find((b) => b.dataset.preset === "beach");
  beach.dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  assert.equal(ui.$("inTarget").value, "21");
  assert.equal(beach.getAttribute("aria-pressed"), "true");
  assert.match(ui.text("presetHint"), /кратна 7/);
  ui.tap("sheetSave");

  ui.runSide("sideA", 4);
  ui.runSide("sideB", 3);
  assert.match(ui.text("netInfo"), /міняти сторони/);
  assert.match(ui.text("netInfo"), /до 21/);
});

suite("табло відкривається на другому екрані, якщо він є", async (t) => {
  const ui = boot();
  t.after(ui.close);
  const opened = [];
  ui.win.open = (url, name, features) => { opened.push({ url, features }); return {}; };
  const laptop = { isPrimary: true, availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 };
  const projector = { isPrimary: false, availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 };
  Object.defineProperty(ui.win.screen, "isExtended", { value: true, configurable: true });
  ui.win.getScreenDetails = () => Promise.resolve({ screens: [laptop, projector], currentScreen: laptop });

  ui.tap("mDisplay");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(opened.length, 1);
  assert.match(opened[0].url, /display\.html/);
  assert.match(opened[0].features, /left=1440/);
  assert.match(opened[0].features, /width=1920/);
});

suite("без другого екрана — звичайне вікно, заблоковане — підказка", (t) => {
  const ui = boot();
  t.after(ui.close);
  let features = null;
  ui.win.open = (u, n, f) => { features = f; return null; };   // блокувальник спливних вікон
  ui.tap("mDisplay");
  assert.match(features, /width=1280/);
  assert.match(ui.text("mDisplay"), /спливні вікна/);
});

suite("заміни й картки з пульта", (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.tap("menuBtn");
  ui.tap("mSubs");
  assert.ok(ui.$("subsSheet").classList.contains("show"));
  assert.match(ui.text("subCount"), /0 з 6/);

  ui.$("inSubOut").value = "7";
  ui.$("inSubIn").value = "12";
  ui.tap("subBtn");
  assert.match(ui.text("subCount"), /1 з 6/);
  assert.match(ui.text("evLog"), /заміна 7 → 12/);

  // картка другій команді — червона дає очко першій
  ui.$("segTeam").children[1].dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  ui.$("inCardPlayer").value = "5";
  ui.win.document.querySelector('.card[data-card="red"]').dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  assert.deepEqual(ui.score(), [1, 0]);
  assert.match(ui.text("evLog"), /червона · №5/);

  ui.tap("undoBtn");
  assert.deepEqual(ui.score(), [0, 0], "⟲ знімає картку разом зі штрафним очком");
});

// Пляжний волейбол відкладено: повернемось до нього після класичного.
test.todo("пляж: кнопка технічного тайм-ауту зʼявляється на 21");
(JSDOM ? test.skip : test.skip)("пляж (відкладено): кнопка технічного тайм-ауту", (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.tap("menuBtn");
  ui.tap("mSettings");
  [...ui.$("segPreset").children].find((b) => b.dataset.preset === "beach")
    .dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  ui.tap("sheetSave");
  ui.runSide("sideA", 11);
  ui.runSide("sideB", 9);
  assert.equal(ui.$("techBtn").classList.contains("on"), false);
  ui.runSide("sideB", 1);
  assert.ok(ui.$("techBtn").classList.contains("on"));
  ui.tap("techBtn");
  assert.ok(ui.$("toOverlay").classList.contains("show"));
  assert.match(ui.text("toWho"), /Технічний/);
  assert.equal(ui.$("techBtn").classList.contains("on"), false);
});

suite("збереження налаштувань не губить правил пресета, яких немає у формі", (t) => {
  const ui = boot();
  t.after(ui.close);
  ui.tap("menuBtn");
  ui.tap("mSettings");
  [...ui.$("segPreset").children].find((b) => b.dataset.preset === "beach")
    .dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  ui.tap("sheetSave");
  const M = ui.win.Match;
  const rules = M.deserialize(ui.win.localStorage.getItem("volleyball:match")).rules;
  Object.keys(M.presetById("beach").rules).forEach((k) => {
    assert.equal(rules[k], M.presetById("beach").rules[k], "правило " + k);
  });
});

suite("свої кольори в налаштуваннях: зразок, вибір, «як було», збереження й скасування", (t) => {
  const ui = boot();
  t.after(ui.close);
  const doc = ui.win.document, root = doc.documentElement.style;
  const click = (el) => el.dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  ui.tap("mSettings");
  assert.equal(doc.querySelectorAll("#colorPickers .crow").length, 5, "команда А, Б, фон, рамка, текст");
  // команда А — жовта: видно одразу на пульті й на зразку
  click(doc.querySelector('#colorPickers .swb[data-k="colorA"][data-c="#F7D23A"]'));
  assert.equal(root.getPropertyValue("--team-a"), "#F7D23A");
  assert.equal(root.getPropertyValue("--ink-a"), "#0A1F30", "текст на жовтому темніє сам");
  assert.match(ui.$("colorPreview").style.cssText, /--pv-a:\s*#F7D23A/i);
  // фон таблиці — свій колір через палітру браузера
  const inp = doc.querySelector('#colorPickers input[data-k="colorBg"]');
  inp.value = "#123456";
  inp.dispatchEvent(new ui.win.Event("change", { bubbles: true }));
  assert.match(ui.$("colorPreview").style.cssText, /--pv-bg:\s*#123456/i);
  // закрили без збереження — усе як було
  ui.tap("sheetSave");
  let p = JSON.parse(ui.win.localStorage.getItem("volleyball:prefs"));
  assert.equal(p.colorA, "#F7D23A");
  assert.equal(p.colorBg, "#123456");
  ui.tap("mSettings");
  click(doc.querySelector('#colorPickers .cx[data-k="colorA"]'));          // «як було»
  assert.equal(root.getPropertyValue("--team-a"), "#1668C9");
  ui.tap("sheetSave");
  p = JSON.parse(ui.win.localStorage.getItem("volleyball:prefs"));
  assert.equal(p.colorA, "", "скинуто");
  assert.equal(p.colorBg, "#123456", "решта лишилась");
  ui.tap("mSettings");
  ui.tap("colorsReset");
  click(doc.querySelector('#colorPickers .swb[data-k="colorB"][data-c="#E03127"]'));
  doc.querySelector("#sheet").dispatchEvent(new ui.win.Event("click"));   // тап повз вікно — закрити без збереження
  assert.equal(root.getPropertyValue("--team-b"), "#F5A310", "без «Зберегти» колір повертається");
  assert.equal(JSON.parse(ui.win.localStorage.getItem("volleyball:prefs")).colorBg, "#123456");
  assert.deepEqual(ui.errors, []);
});

suite("палітра кольорів: 9 рядків по 10 кольорів, розгортається по одній", (t) => {
  const ui = boot();
  t.after(ui.close);
  const doc = ui.win.document, P = ui.win.Palettes;
  const click = (el) => el.dispatchEvent(new ui.win.Event("click", { bubbles: true }));
  assert.equal(P.SWATCH_ROWS.length, 9);
  P.SWATCH_ROWS.forEach((r) => assert.equal(r.colors.length, 10, r.label));
  assert.equal(new Set(P.SWATCHES).size, P.SWATCHES.length, "кольори не повторюються");
  ui.tap("mSettings");
  assert.equal(doc.querySelectorAll('#colorPickers .swb[data-k="colorBg"]').length, 90);
  assert.equal(doc.querySelectorAll("#colorPickers .crow.open").length, 0, "спершу всі згорнуті");
  click(doc.querySelector('#colorPickers [data-open="colorFrame"]'));
  assert.deepEqual([...doc.querySelectorAll("#colorPickers .crow.open .ctog")].map((b) => b.dataset.open), ["colorFrame"]);
  click(doc.querySelector('#colorPickers [data-open="colorA"]'));
  assert.deepEqual([...doc.querySelectorAll("#colorPickers .crow.open .ctog")].map((b) => b.dataset.open), ["colorA"], "відкрита лише одна");
  click(doc.querySelector('#colorPickers .swb[data-k="colorA"][data-c="#674EA7"]'));
  assert.equal(doc.documentElement.style.getPropertyValue("--team-a"), "#674EA7");
  assert.ok(doc.querySelector("#colorPickers .crow.open"), "після вибору палітра лишається відкритою");
  assert.deepEqual(ui.errors, []);
});
