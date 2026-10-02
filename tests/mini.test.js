"use strict";

/*
 * Міні-пульт (mini.html): міні-табло й кнопки в окремій маленькій вкладці.
 * Веде той самий матч, що й основний пульт: зміни йдуть в обидва боки,
 * а основний пульт пересилає їх на сервер для другого судді й міні-табло.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Match = require("../match.js");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }
const suite = JSDOM ? test : test.skip;

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const miniHtml = read("mini.html");
const miniJs = read("mini.js");
const bugJs = read("scorebug.js");
const ids = (html) => new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));

/* ---------- розмітка ---------- */

test("міні-пульт: кожен id з mini.js і scorebug.js існує в розмітці", () => {
  const have = ids(miniHtml);
  const used = new Set();
  [miniJs, bugJs].forEach((js) => {
    [...js.matchAll(/\$\("([\w-]+)"\)/g)].forEach((m) => used.add(m[1]));
    [...js.matchAll(/\$\("([\w-]+)" \+ t\)/g)].forEach((m) => { used.add(m[1] + "A"); used.add(m[1] + "B"); });
  });
  assert.deepEqual([...used].filter((id) => !have.has(id)), []);
});

test("міні-табло однакове в live.html і mini.html — спільні scorebug.css і scorebug.js", () => {
  const liveHtml = read("live.html");
  [liveHtml, miniHtml].forEach((h) => {
    assert.match(h, /href="\.\/scorebug\.css"/);
    assert.match(h, /src="\.\/scorebug\.js"/);
  });
  ["lNameA", "lPtsB", "lSetsA", "lServeB", "lTitle", "lInfo", "board"].forEach((id) => {
    assert.ok(ids(liveHtml).has(id) && ids(miniHtml).has(id), id);
  });
  assert.equal(/\.board\{width/.test(liveHtml), false, "стилі табло не дублюються в сторінці");
});

test("міні-пульт в офлайн-кеші, у меню пульта і в ярликах застосунку", () => {
  const sw = read("sw.js");
  ["mini.html", "mini.js", "scorebug.css", "scorebug.js"].forEach((f) => assert.ok(sw.includes('"./' + f + '"'), f));
  assert.match(read("index.html"), /id="mMini"/);
  assert.match(read("app.js"), /mini\.html/);
  assert.ok(JSON.parse(read("manifest.webmanifest")).shortcuts.some((s) => s.url === "./mini.html"));
});

/* ---------- живі тести ---------- */

function makeBus() {
  const members = new Set();
  let sent = 0;
  function FakeChannel() {
    const self = this;
    members.add(self);
    self.onmessage = null;
    self.postMessage = (data) => {
      sent++;
      members.forEach((m) => { if (m !== self && m.onmessage) m.onmessage({ data: JSON.parse(JSON.stringify(data)) }); });
    };
    self.close = () => members.delete(self);
  }
  FakeChannel.count = () => sent;
  return FakeChannel;
}

function fakeSockets() {
  const all = [];
  function FakeWS(url) { this.url = url; this.readyState = 0; this.sent = []; all.push(this); }
  FakeWS.prototype.send = function (d) { this.sent.push(JSON.parse(d)); };
  FakeWS.prototype.close = function () { this.readyState = 3; };
  FakeWS.last = () => all[all.length - 1];
  FakeWS.open = (ws) => { ws.readyState = 1; ws.onmessage({ data: JSON.stringify({ type: "hello", role: "control" }) }); };
  return FakeWS;
}

function boot(html, files, opts = {}) {
  const dom = new JSDOM(html, { url: opts.url || "https://tablo.example/mini.html", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  if (opts.bus) win.BroadcastChannel = opts.bus;
  if (opts.WebSocket) win.WebSocket = opts.WebSocket;
  win.confirm = () => true;
  win.open = () => ({});
  if (opts.seed) Object.keys(opts.seed).forEach((k) => win.localStorage.setItem(k, opts.seed[k]));
  ["match.js", "palettes.js", "ui-common.js"].concat(files).forEach((f) => win.eval(read(f)));
  const $ = (id) => win.document.getElementById(id);
  return { win, $, errors, text: (id) => ($(id).textContent || "").trim(),
           tap: (id) => $(id).dispatchEvent(new win.Event("click", { bubbles: true })), close: () => win.close() };
}

const mini = (opts) => boot(miniHtml, ["scorebug.js", "mini.js"], opts);
const control = (opts) => boot(read("index.html"), ["remote.js", "app.js"], Object.assign({ url: "https://tablo.example/index.html" }, opts));
const stored = (ui) => Match.reduce(Match.deserialize(ui.win.localStorage.getItem("volleyball:match")));

suite("міні-пульт сам по собі: очки, зняти очко, тайм-аут, скасування", (t) => {
  const m = mini();
  t.after(m.close);
  assert.equal(m.text("lPtsA"), "0", "порожньо — новий матч, можна починати");

  m.tap("mPlusA"); m.tap("mPlusA"); m.tap("mPlusB");
  assert.equal(m.text("lPtsA"), "2");
  assert.equal(m.text("lPtsB"), "1");
  assert.deepEqual(stored(m).points, [2, 1], "пише в те саме сховище, що й пульт");

  m.tap("mMinusA");                       // «−1» прибирає очко з історії, як «−» на пульті
  assert.equal(m.text("lPtsA"), "1");
  m.tap("mUndo");
  assert.equal(m.text("lPtsB"), "0", "⟲ скасовує останню дію — очко Б");
  m.tap("mRedo");
  assert.equal(m.text("lPtsB"), "1", "⟳ повертає її");

  m.tap("mToB");
  assert.match(m.text("mToB"), /●○/);
  assert.match(m.text("lInfo"), /тайм-аут/);
  assert.deepEqual(m.errors, []);
});

suite("міні-пульт: хто подає першим — лише до першого розіграшу сету", (t) => {
  const m = mini();
  t.after(m.close);
  assert.equal(m.$("mServe").disabled, false);
  m.tap("mServe");
  assert.match(m.text("mServe"), /Подає: Команда А/);
  m.tap("mServe");
  assert.match(m.text("mServe"), /Подає: Команда Б/);
  assert.ok(m.$("lServeB").className.includes("on"));
  m.tap("mPlusA");
  assert.equal(m.$("mServe").disabled, true, "після розіграшу подача переходить сама");
  assert.equal(m.$("mMinusB").disabled, true, "у Б немає очок — знімати нічого");
});

suite("міні-пульт: кінець матчу блокує +1, клавіатура дублює кнопки", (t) => {
  let done = Match.createMatch({ names: ["Імідж", "Ліцей"], rules: { bestOf: 1, target: 3 } });
  for (let i = 0; i < 2; i++) done = Match.addPoint(done, 0, 1000);
  const m = mini({ seed: { "volleyball:match": Match.serialize(done) } });
  t.after(m.close);
  m.win.document.dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "1" }));
  assert.match(m.text("lInfo"), /Імідж виграла 1:0/);
  assert.equal(m.$("mPlusA").disabled, true);
  m.win.document.dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "Backspace" }));
  assert.equal(m.$("mPlusA").disabled, false, "Backspace скасував останнє очко");
});

suite("міні-пульт і основний пульт ведуть той самий матч в обидва боки", (t) => {
  const bus = makeBus();
  const c = control({ bus });
  const m = mini({ bus });
  t.after(() => { c.close(); m.close(); });

  c.tap("sideA");
  assert.equal(m.text("lPtsA"), "1", "очко з пульта — у міні-пульті");

  m.tap("mPlusB"); m.tap("mPlusB");
  assert.equal(c.text("scoreB"), "2", "очки з міні-пульта — на основному пульті");
  assert.ok(c.$("serveB").className.includes("on"));

  m.tap("mToA");
  assert.ok(c.$("toOverlay").classList.contains("show"), "тайм-аут з міні-пульта — відлік на пульті");

  const before = bus.count();
  m.tap("mPlusA");
  assert.ok(bus.count() - before < 6, "без нескінченної луни між вкладками");
  assert.deepEqual(c.errors.concat(m.errors), []);
});

suite("основний пульт пересилає зміни з міні-пульта на сервер — другому судді й міні-табло", (t) => {
  const bus = makeBus();
  const WS = fakeSockets();
  const c = control({ bus, WebSocket: WS });
  const m = mini({ bus });
  t.after(() => { c.close(); m.close(); });

  c.tap("menuBtn"); c.tap("mLink"); c.tap("linkCreate");
  const ws = WS.last();
  FakeOpen(WS, ws);
  const sentBefore = ws.sent.length;

  m.tap("mPlusA");
  const last = ws.sent[ws.sent.length - 1];
  assert.ok(ws.sent.length > sentBefore);
  assert.equal(last.type, "state");
  assert.deepEqual(Match.reduce(Match.deserialize(last.match)).points, [1, 0]);
});

suite("основний пульт приймає зміни з іншої вкладки і через подію storage", (t) => {
  const c = control();
  t.after(c.close);
  const raw = Match.serialize(Match.addPoint(Match.createMatch(), 1, 1000));
  c.win.dispatchEvent(new c.win.StorageEvent("storage", { key: "volleyball:match", newValue: raw }));
  assert.equal(c.text("scoreB"), "1");
});

suite("меню пульта відкриває міні-пульт окремим маленьким вікном", (t) => {
  const c = control();
  t.after(c.close);
  let opened = null;
  c.win.open = (url, name, features) => { opened = { url, features }; return {}; };
  c.tap("menuBtn");
  c.tap("mMini");
  assert.match(opened.url, /mini\.html/);
  assert.match(opened.features, /width=480/);

  c.win.open = () => null;                                   // спливні вікна заблоковані
  c.tap("menuBtn");
  c.tap("mMini");
  assert.match(c.text("mMini"), /спливні вікна/);
  assert.equal(c.win.location.pathname, "/index.html", "пульт лишився на місці");
});

function FakeOpen(WS, ws) { WS.open(ws); }

/* ---------- табло й керування окремими сторінками ---------- */

suite("міні-пульт: «Сховати табло» — лише кнопки з рахунком у картках, вибір запамʼятовується", (t) => {
  const m = mini();
  t.after(m.close);
  const body = m.win.document.body;
  assert.equal(body.classList.contains("controls"), false, "за замовчуванням — табло й кнопки разом");
  m.tap("mPlusA"); m.tap("mPlusA");

  m.tap("mToggleBoard");
  assert.ok(body.classList.contains("controls"));
  assert.equal(m.text("mToggleBoard"), "Показати табло");
  assert.equal(m.text("mPtsA"), "2", "рахунок видно і без табла");
  assert.equal(m.win.location.search, "?view=controls", "адресу можна зберегти закладкою");
  assert.equal(m.win.localStorage.getItem("volleyball:miniView"), "controls");

  m.tap("mToggleBoard");
  assert.equal(body.classList.contains("controls"), false);
  assert.equal(m.win.location.search, "");

  // нова вкладка з тим самим сховищем — пам'ятає вибір
  const again = mini({ seed: { "volleyball:miniView": "controls" } });
  t.after(again.close);
  assert.ok(again.win.document.body.classList.contains("controls"), "після перезавантаження — так само лише кнопки");
});

suite("mini.html?view=controls одразу відкриває лише керування", (t) => {
  const m = mini({ url: "https://tablo.example/mini.html?view=controls" });
  t.after(m.close);
  assert.ok(m.win.document.body.classList.contains("controls"));
});

suite("міні-пульт: «Табло окремо» відкриває міні-табло у своєму вікні, тут лишаються кнопки", (t) => {
  const m = mini();
  t.after(m.close);
  let opened = null;
  m.win.open = (url, name, features) => { opened = { url, name, features }; return {}; };
  m.tap("mBoardOut");
  assert.match(opened.url, /live\.html$/);
  assert.equal(opened.name, "volley-board", "повторне натискання не плодить вікна");
  assert.ok(m.win.document.body.classList.contains("controls"));
});

suite("окреме міні-табло на цьому пристрої має «Керування ↗», у глядачів за посиланням — ні", (t) => {
  const liveFiles = ["remote.js", "scorebug.js", "feed.js", "live.js"];
  const local = boot(read("live.html"), liveFiles, { url: "https://tablo.example/live.html" });
  t.after(local.close);
  assert.ok(local.win.document.body.classList.contains("local"));
  let opened = null;
  local.win.open = (url) => { opened = url; return {}; };
  local.tap("lCtl");
  assert.match(opened, /mini\.html\?view=controls/);

  const viewer = boot(read("live.html"), liveFiles, { url: "https://tablo.example/live.html?room=ABC234", WebSocket: fakeSockets() });
  t.after(viewer.close);
  assert.equal(viewer.win.document.body.classList.contains("local"), false, "глядач не бачить посилання на керування");
});

suite("міні-табло окремо й міні-пульт «лише керування» ведуть той самий матч", (t) => {
  const bus = makeBus();
  const board = boot(read("live.html"), ["remote.js", "scorebug.js", "feed.js", "live.js"], { url: "https://tablo.example/live.html", bus });
  const m = mini({ url: "https://tablo.example/mini.html?view=controls", bus });
  t.after(() => { board.close(); m.close(); });
  m.tap("mPlusB"); m.tap("mPlusB"); m.tap("mPlusA");
  assert.equal(board.text("lPtsB"), "2");
  assert.equal(board.text("lPtsA"), "1");
  assert.equal(m.text("mPtsB"), "2");
});

suite("основний пульт: «Міні-табло окремо» відкриває лише табло", (t) => {
  const c = control();
  t.after(c.close);
  let opened = null;
  c.win.open = (url, name) => { opened = { url, name }; return {}; };
  c.tap("menuBtn");
  c.tap("mBoard");
  assert.match(opened.url, /live\.html$/);
  assert.equal(opened.name, "volley-board");
});
