"use strict";

/*
 * Компактне табло для трансляції (live.html) і вікно «Трансляція» на пульті.
 * Сокети тут фальшиві — справжній сервер перевіряє server.test.js.
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
const liveHtml = read("live.html");
const liveJs = read("live.js");
const base = ["match.js", "palettes.js", "ui-common.js", "remote.js"].map(read);

/* Фальшивий WebSocket: запамʼятовує надіслане, сервер «відповідає» вручну. */
function fakeSockets() {
  const all = [];
  function FakeWS(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    all.push(this);
  }
  FakeWS.prototype.send = function (d) { this.sent.push(JSON.parse(d)); };
  FakeWS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); };
  FakeWS.all = all;
  FakeWS.last = () => all[all.length - 1];
  FakeWS.serve = (ws, msg) => ws.onmessage({ data: JSON.stringify(msg) });
  FakeWS.open = (ws, role) => { ws.readyState = 1; if (ws.onopen) ws.onopen(); FakeWS.serve(ws, { type: "hello", role }); };
  return FakeWS;
}

function boot(html, scripts, opts = {}) {
  const dom = new JSDOM(html, { url: opts.url || "http://localhost/live.html", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  if (opts.WebSocket) win.WebSocket = opts.WebSocket;
  win.confirm = () => true;
  if (opts.seed) Object.keys(opts.seed).forEach((k) => win.localStorage.setItem(k, opts.seed[k]));
  base.concat(scripts).forEach((s) => win.eval(s));
  const $ = (id) => win.document.getElementById(id);
  return { win, $, errors, text: (id) => ($(id).textContent || "").trim(),
           tap: (id) => $(id).dispatchEvent(new win.Event("click", { bubbles: true })), close: () => win.close() };
}

const live = (opts) => boot(liveHtml, [read("feed.js"), liveJs], opts);

function played(points, extra) {
  let m = Match.createMatch(Object.assign({ names: ["Імідж", "Ліцей"], title: "Кубок міста" }, extra || {}));
  points.forEach((t) => { m = Match.addPoint(m, t, 1000); });
  return m;
}

/* ---------- розмітка ---------- */

test("live: кожен id з live.js існує в розмітці", () => {
  const ids = new Set([...liveHtml.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
  const used = new Set([...liveJs.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
  [...liveJs.matchAll(/\$\("([\w-]+)" \+ t\)/g)].forEach((m) => { used.add(m[1] + "A"); used.add(m[1] + "B"); });
  assert.deepEqual([...used].filter((id) => !ids.has(id)), []);
});

test("на жодній сторінці немає підпису стороннього сервісу", () => {
  ["index.html", "display.html", "live.html"].forEach((f) => {
    assert.equal(/made with|keepthescore/i.test(read(f)), false, f);
  });
});

test("live у тому ж стилі й офлайн-кеші", () => {
  assert.match(liveHtml, /href="\.\/theme\.css"/);
  assert.equal(/:root\{/.test(liveHtml), false);
  const sw = read("sw.js");
  ["live.html", "live.js", "feed.js", "remote.js", "vendor/qrcode.js"].forEach((f) => assert.ok(sw.includes('"./' + f + '"'), f));
});

/* ---------- той самий пристрій ---------- */

suite("live: рахунок із цього пристрою — команди, сети, очки, турнір", (t) => {
  let m = played(new Array(25).fill(0));                  // 1:0 у сетах
  [1, 1, 0].forEach((x) => { m = Match.addPoint(m, x, 1000); });
  const l = live({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(l.close);
  assert.equal(l.text("lNameA"), "Імідж");
  assert.equal(l.text("lNameB"), "Ліцей");
  assert.equal(l.text("lSetsA"), "1");
  assert.equal(l.text("lPtsA"), "1");
  assert.equal(l.text("lPtsB"), "2");
  assert.equal(l.text("lTitle"), "Кубок міста");
  assert.match(l.text("lInfo"), /2-й сет/);
  assert.ok(l.$("lServeA").className.includes("on"), "подає Імідж");
  assert.equal(l.win.document.body.classList.contains("waiting"), false);
  assert.equal(l.$("linkStatus").classList.contains("show"), false, "локально — без індикатора");
  assert.deepEqual(l.errors, []);
});

suite("live: без даних — «чекаємо на пульт»", (t) => {
  const l = live();
  t.after(l.close);
  assert.ok(l.win.document.body.classList.contains("waiting"));
});

suite("live: рядки за командами, а не за сторонами майданчика", (t) => {
  const m = Match.swapSides(played([0, 0, 1]));
  const l = live({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(l.close);
  assert.equal(l.text("lNameA"), "Імідж", "Імідж зверху й після зміни сторін");
  assert.equal(l.text("lPtsA"), "2");
});

suite("live: сетбол, тайм-аут і кінець матчу в нижньому рядку", (t) => {
  let m = played(new Array(24).fill(0));
  const l = live({ seed: { "volleyball:match": Match.serialize(m) } });
  t.after(l.close);
  assert.match(l.text("lInfo"), /сетбол · Імідж/);

  const push = (mm) => {
    const raw = Match.serialize(mm);
    l.win.localStorage.setItem("volleyball:match", raw);
    l.win.dispatchEvent(new l.win.StorageEvent("storage", { key: "volleyball:match", newValue: raw }));
  };
  push(Match.callTimeout(m, 1, Date.now()));
  assert.match(l.text("lInfo"), /тайм-аут · Ліцей · \d+/);

  let done = Match.createMatch({ names: ["Імідж", "Ліцей"], rules: { bestOf: 1, target: 3 } });
  for (let i = 0; i < 3; i++) done = Match.addPoint(done, 1, 1000);
  push(done);
  assert.match(l.text("lInfo"), /Ліцей виграла 1:0/);
  assert.equal(l.text("lPtsA"), "", "після фіналу очки не показуємо");
});

/* ---------- з сервера трансляції ---------- */

suite("live?room=…: підключається глядачем і малює те, що прислав сервер", (t) => {
  const WS = fakeSockets();
  const l = live({ url: "https://tablo.example/live.html?room=abc234", WebSocket: WS });
  t.after(l.close);
  const ws = WS.last();
  assert.equal(ws.url, "wss://tablo.example/ws?room=ABC234&role=viewer", "той самий сервер, роль глядача, без ключа");
  assert.ok(l.win.document.body.classList.contains("waiting"));
  assert.match(l.text("linkStatus"), /підключення/);

  WS.open(ws, "viewer");
  assert.match(l.text("linkStatus"), /наживо/);
  WS.serve(ws, { type: "prefs", prefs: { palette: "neon" } });
  WS.serve(ws, { type: "state", match: Match.serialize(played([1, 1])) });
  assert.equal(l.text("lPtsB"), "2");
  assert.equal(l.win.document.documentElement.style.getPropertyValue("--team-a"), "#7B3FE4");
  assert.equal(l.win.localStorage.getItem("volleyball:match"), null, "чужий матч не пишемо в сховище глядача");
});

suite("live?room=…: невідомий код — зрозуміле повідомлення, без нескінченних спроб", (t) => {
  const WS = fakeSockets();
  const l = live({ url: "https://tablo.example/live.html?room=ZZZZZ2", WebSocket: WS });
  t.after(l.close);
  WS.last().onclose({ code: 4000 });
  assert.match(l.text("linkStatus"), /не знайдено/);
  assert.equal(WS.all.length, 1);
});

suite("live?bg=none — прозорий фон для OBS", (t) => {
  const l = live({ url: "http://localhost/live.html?bg=none" });
  t.after(l.close);
  assert.ok(l.win.document.body.classList.contains("clear"));
});

/* ---------- пульт ---------- */

const control = (opts) => boot(read("index.html"), [read("vendor/qrcode.js"), read("app.js")],
  Object.assign({ url: "https://tablo.example/index.html" }, opts));

suite("пульт: трансляція — код, посилання, QR, стан на сервер, ключ лише в пульта", (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);

  c.tap("menuBtn");
  c.tap("mCast");
  assert.equal(c.$("inCastServer").value, "https://tablo.example", "за замовчуванням — цей сайт");
  c.tap("castStart");

  const code = c.text("castCode");
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(c.text("castLink"), "https://tablo.example/live.html?room=" + code);
  assert.ok(c.$("castQr").querySelector("svg"), "QR-код намальовано");

  const ws = WS.last();
  assert.match(ws.url, new RegExp("^wss://tablo\\.example/ws\\?room=" + code + "&role=control&key=[\\w-]{32}$"));
  WS.open(ws, "control");
  assert.deepEqual(ws.sent.map((m) => m.type), ["state", "prefs"], "одразу весь стан");
  assert.equal(JSON.stringify(ws.sent[1]).includes(JSON.parse(c.win.localStorage.getItem("volleyball:cast")).key), false,
    "ключ не їде в налаштуваннях");
  assert.match(c.text("castDot"), /наживо/);

  c.tap("sideA");
  const last = ws.sent[ws.sent.length - 1];
  assert.equal(last.type, "state");
  assert.deepEqual(Match.reduce(Match.deserialize(last.match)).points, [1, 0]);

  WS.serve(ws, { type: "viewers", count: 3 });
  assert.match(c.text("castDot"), /3/);

  // Перемикач сторінки для глядачів
  [...c.$("segCastPage").children].find((b) => b.dataset.page === "display.html")
    .dispatchEvent(new c.win.Event("click", { bubbles: true }));
  assert.match(c.text("castLink"), /display\.html\?room=/);
});

suite("пульт: трансляція переживає перезавантаження й зупиняється", (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);
  c.tap("menuBtn");
  c.tap("mCast");
  c.$("inCastServer").value = "tablo-srv.onrender.com";      // без https:// — додасться
  c.tap("castStart");
  const code = c.text("castCode");
  assert.match(WS.last().url, /^wss:\/\/tablo-srv\.onrender\.com\/ws/);

  c.win.eval(read("app.js"));                                  // перезавантаження
  assert.equal(c.text("castCode"), code, "той самий код — посилання в глядачів не ламається");
  assert.match(WS.last().url, new RegExp("room=" + code));

  c.tap("castStop");
  assert.equal(c.win.localStorage.getItem("volleyball:cast"), null);
  assert.equal(c.text("castDot"), "");
});

suite("пульт: без адреси сервера трансляція не стартує", (t) => {
  const c = control({ WebSocket: fakeSockets() });
  t.after(c.close);
  c.tap("menuBtn");
  c.tap("mCast");
  c.$("inCastServer").value = "  ";
  c.tap("castStart");
  assert.match(c.text("castErr"), /адресу сервера/);
  assert.equal(c.win.localStorage.getItem("volleyball:cast"), null);
});
