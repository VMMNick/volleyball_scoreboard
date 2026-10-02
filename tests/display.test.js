"use strict";

/*
 * Табло для глядачів (display.html). Дві частини:
 * звʼязки між файлами — без залежностей, і живі тести в jsdom —
 * пульт і табло в різних вікнах, зʼєднані тим самим каналом, що й у браузері.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Match = require("../match.js");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const html = read("display.html");
const js = read("display.js");
const core = read("match.js");
const palettes = read("palettes.js");
const common = read("ui-common.js");
const sounds = read("sounds.js");
const remote = read("remote.js");
const feed = read("feed.js");
const controlHtml = read("index.html");
const app = read("app.js");

const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));

/* ---------- звʼязки ---------- */

test("табло: кожен id з display.js існує в розмітці", () => {
  const used = new Set([...js.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
  // id, зібрані з префікса й літери сторони: $("aName" + t)
  [...js.matchAll(/\$\("([\w-]+)" \+ t\)/g)].forEach((m) => { used.add(m[1] + "A"); used.add(m[1] + "B"); });
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test("табло: id унікальні", () => {
  const all = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(all.filter((id, i) => all.indexOf(id) !== i))], []);
});

test("табло: скрипти в правильному порядку", () => {
  const a = html.indexOf("match.js"), b = html.indexOf("palettes.js"), c = html.indexOf("display.js");
  assert.ok(a > -1 && a < b && b < c, "match.js → palettes.js → display.js");
});

test("табло не містить логіки правил", () => {
  assert.equal(/\b25\b/.test(js), false, "числа правил живуть у match.js");
});

test("табло в тому ж стилі, що й пульт", () => {
  // Одна тема на двох: кольори й шрифт живуть лише в theme.css.
  [html, controlHtml].forEach((src) => {
    assert.match(src, /href="\.\/theme\.css"/);
    assert.equal(/:root\{/.test(src), false, "токени не дублюються в розмітці");
    assert.match(src, /font-family:var\(--font\)/);
  });
  assert.match(html, /min-aspect-ratio:1\/1/, "той самий принцип адаптиву");
});

test("табло: скрипти спільного коду підключені", () => {
  const order = ["match.js", "palettes.js", "ui-common.js", "sounds.js", "remote.js", "feed.js", "display.js"].map((f) => html.indexOf(f));
  assert.ok(order.every((x, i) => x > -1 && (i === 0 || x > order[i - 1])), "порядок: " + order);
});

test("пульт має кнопку відкриття табло", () => {
  assert.match(controlHtml, /id="mDisplay"/);
  assert.match(app, /display\.html/);
});

/* ---------- живі тести ---------- */

/* Спільна шина замість BroadcastChannel: jsdom його не має. */
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

function boot(markup, scripts, opts) {
  opts = opts || {};
  const dom = new JSDOM(markup, { url: opts.url || "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  if (opts.bus) win.BroadcastChannel = opts.bus;
  if (opts.beforeScripts) opts.beforeScripts(win);
  if (opts.seed) Object.keys(opts.seed).forEach((k) => win.localStorage.setItem(k, opts.seed[k]));
  scripts.forEach((s) => win.eval(s));
  const $ = (id) => win.document.getElementById(id);
  const text = (id) => ($(id).textContent || "").trim();
  return { win, $, text, errors, close: () => win.close() };
}

const display = (opts) => boot(html, [core, palettes, common, sounds, remote, feed, js], opts);
const qrJs = read("vendor/qrcode.js");
const control = (opts) => boot(controlHtml, [core, palettes, common, remote, qrJs, app], opts);

function played(points) {
  let m = Match.createMatch({ names: ["Імідж", "Ліцей"] });
  points.forEach((t) => { m = Match.addPoint(m, t, 1000); });
  return m;
}

const suite = JSDOM ? test : test.skip;

suite("табло показує збережений матч", (t) => {
  const m = played([0, 0, 1]);
  const d = display({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(d.close);

  assert.equal(d.text("aNameA"), "Імідж");
  assert.equal(d.text("aScoreA"), "2");
  assert.equal(d.text("aScoreB"), "1");
  assert.ok(d.$("aServeB").className.includes("on"), "подає той, хто виграв останній розіграш");
  assert.equal(d.text("sPtsA"), "2", "смуга теж оновлена");
  assert.deepEqual(d.errors, []);
});

suite("табло оновлюється з події storage", (t) => {
  const d = display();
  t.after(d.close);
  assert.equal(d.text("aScoreA"), "0");

  const raw = Match.serialize(played([0, 0, 0]));
  d.win.localStorage.setItem("volleyball:match", raw);
  d.win.dispatchEvent(new d.win.StorageEvent("storage", { key: "volleyball:match", newValue: raw }));
  assert.equal(d.text("aScoreA"), "3");
});

suite("пульт і табло синхронізуються наживо", (t) => {
  const bus = makeBus();
  const c = control({ bus });
  const d = display({ bus });
  t.after(() => { c.close(); d.close(); });

  const tap = (id) => c.$(id).dispatchEvent(new c.win.Event("click", { bubbles: true }));
  tap("sideA"); tap("sideA"); tap("sideB");
  assert.equal(d.text("aScoreA"), "2");
  assert.equal(d.text("aScoreB"), "1");

  tap("undoBtn");
  assert.equal(d.text("aScoreB"), "0", "скасування теж доходить");
  assert.deepEqual(c.errors.concat(d.errors), []);
});

suite("табло, відкрите пізніше, просить стан у пульта", (t) => {
  const bus = makeBus();
  const c = control({ bus });
  const tap = (id) => c.$(id).dispatchEvent(new c.win.Event("click", { bubbles: true }));
  for (let i = 0; i < 4; i++) tap("sideB");

  const d = display({ bus });                 // окреме сховище — стан приходить лише каналом
  t.after(() => { c.close(); d.close(); });
  assert.equal(d.text("aScoreB"), "4");
});

suite("закриті сети й рахунок у сетах", (t) => {
  const pts = [];
  for (let i = 0; i < 25; i++) pts.push(0);
  for (let i = 0; i < 5; i++) pts.push(1);
  const d = display({ seed: { "volleyball:match": Match.serialize(played(pts)) } });
  t.after(d.close);

  assert.match(d.text("aSets"), /1:0/);
  assert.match(d.text("aHistory"), /25–0/);
  assert.match(d.text("aHistory"), /0–5/, "поточний сет");
  assert.match(d.text("aSet"), /2-й сет/);
  assert.equal(d.text("sPastA"), "25");
});

suite("тайм-аут показується і ховається за командою пульта", (t) => {
  const bus = makeBus();
  const c = control({ bus });
  const d = display({ bus });
  t.after(() => { c.close(); d.close(); });

  c.$("toA").dispatchEvent(new c.win.Event("click", { bubbles: true }));
  assert.ok(d.$("toOverlay").classList.contains("show"));
  assert.match(d.text("toWho"), /Тайм-аут/);

  c.$("toStop").dispatchEvent(new c.win.Event("click", { bubbles: true }));
  assert.equal(d.$("toOverlay").classList.contains("show"), false);
});

suite("палітра пульта переходить на табло", (t) => {
  const d = display({ seed: { "volleyball:prefs": JSON.stringify({ palette: "neon" }) } });
  t.after(d.close);
  assert.equal(d.win.document.documentElement.style.getPropertyValue("--team-a"), "#7B3FE4");
});

suite("макет задається адресою", (t) => {
  const d = display({ url: "http://localhost/display.html?layout=strip&bg=none" });
  t.after(d.close);
  assert.equal(d.win.document.body.getAttribute("data-layout"), "strip");
  assert.ok(d.win.document.body.classList.contains("clear"));

  d.win.document.dispatchEvent(new d.win.KeyboardEvent("keydown", { key: "l" }));
  assert.equal(d.win.document.body.getAttribute("data-layout"), "arena");
});

suite("переможець на весь екран", (t) => {
  let m = Match.createMatch({ names: ["Імідж", "Ліцей"], rules: { bestOf: 1, target: 3 } });
  for (let i = 0; i < 3; i++) m = Match.addPoint(m, 1, 1000);
  const d = display({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(d.close);
  assert.ok(d.$("final").classList.contains("show"));
  assert.match(d.text("finalWho"), /Ліцей виграла/);
});

suite("назва турніру на табло", (t) => {
  const m = Match.setTitle(played([0]), "Кубок міста");
  const d = display({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(d.close);
  assert.equal(d.text("aTitle"), "Кубок міста");
  assert.equal(d.text("sTitle"), "Кубок міста");
});

suite("подачу можна сховати з табло", (t) => {
  const seed = { "volleyball:match": Match.serialize(played([0])) };
  const on = display({ seed });
  assert.ok(on.$("aServeA").className.includes("on"));
  on.close();

  seed["volleyball:prefs"] = JSON.stringify({ showServe: false });
  const off = display({ seed });
  t.after(off.close);
  assert.equal(off.$("aServeA").className.includes("on"), false);
  assert.equal(off.$("sServeA").className.includes("on"), false);
});

/* Фальшивий Web Audio: записує, скільки нот і з якою частотою прозвучало. */
function fakeAudio(notes) {
  return function FakeCtx() {
    this.state = "suspended";
    this.currentTime = 0;
    this.destination = {};
    this.resume = () => { this.state = "running"; return Promise.resolve(); };
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    this.createGain = () => ({ gain: param(), connect() {} });
    this.createOscillator = () => {
      const o = { type: "", frequency: param(), connect() {}, stop() {} };
      o.start = () => notes.push(o.frequency.value);
      return o;
    };
  };
}

function push(d, m) {
  const raw = Match.serialize(m);
  d.win.localStorage.setItem("volleyball:match", raw);
  d.win.dispatchEvent(new d.win.StorageEvent("storage", { key: "volleyball:match", newValue: raw }));
}

suite("кінець сету: банер, звук і без ефектів при першому відкритті", (t) => {
  const notes = [];
  const start = played(new Array(24).fill(0));                 // 24:0 — сетбол
  const d = boot(html, [core, palettes, common, sounds, remote, feed, js], {
    seed: { "volleyball:match": Match.serialize(start) },
    beforeScripts: (win) => { win.AudioContext = fakeAudio(notes); }
  });
  t.after(d.close);
  assert.equal(d.$("banner").classList.contains("show"), false, "відкриття — не подія");
  assert.ok(d.$("soundHint").classList.contains("show"), "просить клік для звуку");

  d.win.document.dispatchEvent(new d.win.Event("pointerdown"));
  push(d, Match.addPoint(start, 0, 1000));
  assert.ok(d.$("banner").classList.contains("show"));
  assert.match(d.text("bannerWho"), /Імідж виграла/);
  assert.equal(d.text("bannerPts"), "25 : 0");
  assert.ok(notes.length >= 3, "прозвучав сигнал сету");
});

suite("очко дає спалах, перехід подачі — ротацію", (t) => {
  const d = display({ seed: { "volleyball:match": Match.serialize(played([0])) } });
  t.after(d.close);
  push(d, played([0, 1]));
  assert.ok(d.$("aPanelB").classList.contains("flash"));
  assert.ok(d.$("aRotB").classList.contains("on"), "подача перейшла до Б");
  push(d, played([0, 1, 1]));
  assert.equal(d.$("aRotB").classList.contains("on"), true, "ротація ще видна, але нової немає");
});

suite("тайм-аут показується, а вимкнений звук мовчить", (t) => {
  const notes = [];
  const m = played([0]);
  const d = boot(html, [core, palettes, common, sounds, remote, feed, js], {
    seed: { "volleyball:match": Match.serialize(m), "volleyball:prefs": JSON.stringify({ sound: false }) },
    beforeScripts: (win) => { win.AudioContext = fakeAudio(notes); }
  });
  t.after(d.close);
  d.win.document.dispatchEvent(new d.win.Event("pointerdown"));
  assert.equal(d.$("soundHint").classList.contains("show"), false, "звук вимкнено в налаштуваннях");
  push(d, Match.callTimeout(m, 0, Date.now()));
  assert.ok(d.$("toOverlay").classList.contains("show"));
  assert.equal(notes.length, 0);
});

suite("картка й заміна показуються банером", (t) => {
  const m = played([0]);
  const d = display({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(d.close);
  const carded = Match.giveCard(m, 1, "yellow", "9", 1500);
  push(d, carded);
  assert.ok(d.$("banner").classList.contains("show"));
  assert.ok(d.$("banner").classList.contains("card-yellow"));
  assert.match(d.text("bannerCap"), /Жовта/);
  assert.equal(d.text("bannerPts"), "№9");

  push(d, Match.substitute(carded, 0, "3", "14", 1600));
  assert.match(d.text("bannerCap"), /Заміна/);
  assert.equal(d.text("bannerPts"), "3 → 14");
});

suite("технічний тайм-аут на табло", (t) => {
  let m = Match.createMatch({ rules: Match.presetById("beach").rules });
  for (let i = 0; i < 21; i++) m = Match.addPoint(m, i % 2, 1000);
  const d = display({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(d.close);
  push(d, Match.takeTechTimeout(m, Date.now()));
  assert.ok(d.$("toOverlay").classList.contains("show"));
  assert.match(d.text("toWho"), /Технічний тайм-аут/);
});
