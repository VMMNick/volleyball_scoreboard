"use strict";

/*
 * Міні-табло (live.html) і «Посилання на матч» на пульті: міні-табло та пульт для другого судді.
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

const live = (opts) => boot(liveHtml, [read("scorebug.js"), read("feed.js"), liveJs], opts);

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
  ["live.html", "live.js", "feed.js", "remote.js"].forEach((f) => assert.ok(sw.includes('"./' + f + '"'), f));
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

suite("live: без даних і без ?room= — підказка, де взяти посилання", (t) => {
  const l = live();
  t.after(l.close);
  const body = l.win.document.body;
  assert.ok(body.classList.contains("waiting"));
  assert.ok(body.classList.contains("local"), "показуємо пояснення для цього браузера, а не «чекаємо на суддю»");
  assert.match(l.text("lEmptyLocal"), /в цьому ж браузері/);
  assert.match(l.text("lEmptyLocal"), /Посилання на матч/);
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
  assert.equal(l.text("lPtsA"), "0", "колонки сетів немає — після фіналу лічильник показує сети");
  assert.equal(l.text("lPtsB"), "1");
});

test("окреме міні-табло — сама таблиця: лише назви команд і лічильник", () => {
  const css = liveHtml.slice(liveHtml.indexOf("<style>"), liveHtml.indexOf("</style>"));
  assert.match(css, /\.board \.cols,\.board \.foot,\.board \.sets\{display:none\}/, "без підписів «команда / сети / очки», без колонки сетів і нижнього рядка");
  assert.match(css, /--W:100vw;--H:100vh/, "за замовчуванням таблиця на всю сторінку, без полів довкола");
  assert.match(css, /width:var\(--W\);height:var\(--H\)/, "розміри — від розміру таблиці, тож її можна масштабувати");
  assert.equal(/\d+vh|\d+vw/.test(css.slice(css.indexOf(".board .row{"))), false, "у самій таблиці — жодних прямих vh/vw");
});

/* ---------- за посиланням на матч (через сервер) ---------- */

suite("live?room=…: підключається глядачем і малює те, що прислав сервер", (t) => {
  const WS = fakeSockets();
  const l = live({ url: "https://tablo.example/live.html?room=abc234", WebSocket: WS });
  t.after(l.close);
  const ws = WS.last();
  assert.equal(ws.url, "wss://tablo.example/ws?room=ABC234&role=viewer", "той самий сервер, роль глядача, без ключа");
  assert.ok(l.win.document.body.classList.contains("waiting"));
  assert.equal(l.win.document.body.classList.contains("local"), false, "за посиланням — «чекаємо на пульт судді»");
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

test("ні QR-коду, ні OBS-накладки, ні «трансляції» — лише посилання на матч", () => {
  ["index.html", "app.js", "live.html", "live.js", "display.html", "display.js"].forEach((f) => {
    assert.equal(/qrcode|OBS|bg=none|трансляц/i.test(read(f)), false, f);
  });
  assert.equal(fs.existsSync(path.join(root, "vendor/qrcode.js")), false);
});

/* ---------- пульт: посилання на матч ---------- */

const control = (opts) => boot(read("index.html"), [read("app.js")],
  Object.assign({ url: "https://tablo.example/index.html" }, opts));
const judgeKey = (c) => JSON.parse(c.win.localStorage.getItem("volleyball:link")).key;

function createLink(c, server) {
  c.tap("menuBtn");
  c.tap("mLink");
  if (server !== undefined) c.$("inLinkServer").value = server;
  c.tap("linkCreate");
}

suite("пульт: посилання на міні-табло й пульт для другого судді", (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);

  c.tap("menuBtn");
  c.tap("mLink");
  assert.equal(c.$("inLinkServer").value, "https://tablo.example", "за замовчуванням — цей сайт");
  c.tap("linkCreate");

  const ws = WS.last();
  const code = /room=([A-Z0-9]{6})/.exec(ws.url)[1];
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(ws.url, new RegExp("^wss://tablo\\.example/ws\\?room=" + code + "&role=control&key=[\\w-]{32}$"));
  assert.equal(c.text("linkBoard"), "https://tablo.example/live.html?room=" + code, "міні-табло — без ключа");
  assert.equal(c.text("linkJudge"), "https://tablo.example/index.html?room=" + code + "&key=" + judgeKey(c));
  assert.match(c.text("linkStatus"), new RegExp("код " + code));

  WS.open(ws, "control");
  assert.deepEqual(ws.sent.map((m) => m.type), ["state", "prefs"], "одразу весь стан");
  assert.equal(JSON.stringify(ws.sent).includes(judgeKey(c)), false, "ключ не їде в стані й налаштуваннях");
  assert.match(c.text("linkDot"), /на звʼязку/);

  c.tap("sideA");
  const last = ws.sent[ws.sent.length - 1];
  assert.equal(last.type, "state");
  assert.deepEqual(Match.reduce(Match.deserialize(last.match)).points, [1, 0]);
});

suite("пульт другого судді: підключається за посиланням, бере матч із сервера й керує ним", (t) => {
  const WS = fakeSockets();
  const g = control({ WebSocket: WS, url: "https://tablo.example/index.html?room=ABC234&key=" + "k".repeat(32) });
  t.after(g.close);

  const ws = WS.last();
  assert.equal(ws.url, "wss://tablo.example/ws?room=ABC234&role=control&key=" + "k".repeat(32));
  assert.equal(g.win.location.search, "", "ключ прибрано з адресного рядка");

  WS.open(ws, "control");
  assert.deepEqual(ws.sent, [], "другий суддя при підключенні нічого не надсилає — не затирає матч");

  // сервер надсилає матч першого судді
  const host = Match.addPoint(Match.addPoint(Match.createMatch({ names: ["Імідж", "Ліцей"] }), 1, 1000), 1, 1001);
  WS.serve(ws, { type: "state", match: Match.serialize(host) });
  WS.serve(ws, { type: "prefs", prefs: { palette: "neon" } });
  assert.equal(g.text("nameA"), "Імідж");
  assert.equal(g.text("scoreB"), "2", "той самий рахунок, що в першого судді");
  assert.equal(g.win.document.documentElement.style.getPropertyValue("--team-a"), "#7B3FE4");
  assert.deepEqual(ws.sent, [], "прийняте назад не відлітає — без луни");

  g.tap("sideA");
  const sent = ws.sent[ws.sent.length - 1];
  assert.equal(sent.type, "state");
  assert.deepEqual(Match.reduce(Match.deserialize(sent.match)).points, [1, 2], "очко другого судді йде в матч");

  // тайм-аут, узятий першим суддею, видно й на другому пульті
  WS.serve(ws, { type: "state", match: Match.serialize(Match.callTimeout(Match.deserialize(sent.match), 0, Date.now())) });
  assert.ok(g.$("toOverlay").classList.contains("show"));
  WS.serve(ws, { type: "timeout-end", ts: null });
  assert.equal(g.$("toOverlay").classList.contains("show"), false);

  g.tap("menuBtn");
  g.tap("mLink");
  assert.match(g.text("linkStatus"), /другий суддя/);
  assert.match(g.text("linkStop"), /Відʼєднатися/);
  g.tap("linkStop");
  assert.equal(g.win.localStorage.getItem("volleyball:link"), null);
});

suite("пульт: посилання переживає перезавантаження й закривається", (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);
  createLink(c, "tablo-srv.onrender.com");                    // без https:// — додасться
  assert.match(WS.last().url, /^wss:\/\/tablo-srv\.onrender\.com\/ws/);
  const board = c.text("linkBoard");

  c.win.eval(read("app.js"));                                  // перезавантаження
  assert.equal(c.text("linkBoard"), board, "ті самі посилання");

  c.tap("linkStop");
  assert.equal(c.win.localStorage.getItem("volleyball:link"), null);
  assert.equal(c.text("linkDot"), "");
});

suite("пульт: без адреси сервера посилання не створюється", (t) => {
  const c = control({ WebSocket: fakeSockets() });
  t.after(c.close);
  createLink(c, "  ");
  assert.match(c.text("linkErr"), /адресу сервера/);
  assert.equal(c.win.localStorage.getItem("volleyball:link"), null);
});

suite("пульт: довго немає звʼязку — пояснення й «Зупинити посилання»", (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);
  createLink(c, "tablo-srv.onrender.com");
  WS.last().onclose({ code: 1006 });                          // сервер не відповідає
  assert.match(c.text("linkDot"), /^немає звʼязку$/, "спершу просто індикатор — сервер може прокидатись");
  assert.equal(c.$("linkTrouble").classList.contains("on"), false);

  const now = Date.now();
  c.win.Date.now = () => now + 60000;                          // минула хвилина
  c.tap("mLink");
  assert.ok(c.$("linkTrouble").classList.contains("on"), "пояснення з'явилось");
  assert.ok(c.$("linkDot").classList.contains("trouble"), "індикатор став кнопкою");
  const why = c.text("linkTroubleWhy");
  assert.match(why, /tablo-srv\.onrender\.com/, "інший сервер, ніж сайт");
  assert.match(why, /Render засинає/);
  assert.match(c.text("linkGiveUp"), /Зупинити посилання/);

  // звʼязок повернувся — пояснення зникає
  const ws = WS.last();
  WS.open(ws, "control");
  assert.equal(c.$("linkTrouble").classList.contains("on"), false);
  assert.match(c.text("linkDot"), /на звʼязку/);

  // знову пропав надовго — зупиняємо без додаткових питань
  c.win.confirm = () => { throw new Error("не має перепитувати"); };
  ws.onclose({ code: 1006 });
  c.win.Date.now = () => now + 200000;
  c.tap("linkDot");
  assert.ok(c.$("linkSheet").classList.contains("show"), "індикатор відкриває пояснення");
  c.tap("linkGiveUp");
  assert.equal(c.win.localStorage.getItem("volleyball:link"), null);
  assert.equal(c.text("linkDot"), "");
  assert.deepEqual(c.errors, []);
});

suite("пульт другого судді: застарілий ключ — пояснення одразу", (t) => {
  const WS = fakeSockets();
  const g = control({ WebSocket: WS, url: "https://tablo.example/index.html?room=ABC234&key=" + "k".repeat(32) });
  t.after(g.close);
  WS.last().onclose({ code: 4003 });
  assert.ok(g.$("linkDot").classList.contains("trouble"));
  g.tap("linkDot");
  assert.ok(g.$("linkTrouble").classList.contains("on"));
  assert.match(g.text("linkTroubleTitle"), /не приймає/);
  assert.match(g.text("linkTroubleWhy"), /Ключ судді не підходить/);
  assert.match(g.text("linkGiveUp"), /Відʼєднатися/);
  g.tap("linkRetry");
  assert.equal(WS.all.length, 2, "«Спробувати ще раз» — нове підключення");
});

suite("пульт: сайт відповідає, а сервера посилань немає — підказка про Static Site", async (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);
  const asked = [];
  c.win.fetch = (url) => { asked.push(url); return Promise.resolve({ ok: false, status: 404 }); };
  createLink(c);
  WS.last().onclose({ code: 1006 });
  assert.deepEqual(asked, [], "поки звʼязок пропав щойно — сервер не смикаємо");
  const now = Date.now();
  c.win.Date.now = () => now + 60000;
  c.tap("mLink");
  assert.deepEqual(asked, ["https://tablo.example/healthz"]);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(c.text("linkTroubleWhy"), /Static Site/);
  assert.match(c.text("linkTroubleWhy"), /node server\.js/);
  c.tap("mLink");
  assert.equal(asked.length, 1, "перевіряємо один раз, а не на кожне відкриття");
});

suite("міні-табло для вбудовування: ?fit=keep тримає пропорції, код для вставки — iframe", (t) => {
  const l = live({ url: "https://tablo.example/live.html?room=ABC234&fit=keep", WebSocket: fakeSockets() });
  t.after(l.close);
  assert.ok(l.win.document.body.classList.contains("keep"));
  assert.ok(l.win.document.documentElement.classList.contains("keep"), "прозорі поля довкола таблиці");
  const plain = live();
  t.after(plain.close);
  assert.equal(plain.win.document.body.classList.contains("keep"), false, "звичайне вікно — таблиця на все вікно");

  const Remote = require("../remote.js");
  const code = Remote.embedCode("https://tablo.example/live.html?room=ABC234");
  assert.match(code, /^<iframe src="https:\/\/tablo\.example\/live\.html\?room=ABC234" width="640" height="200" /);
  assert.match(code, /background:transparent/);
  assert.equal(Remote.embedCode('x"><script>').includes('"><script>'), false, "лапки екрануються");
});

suite("пульт: «Код для вставки» копіює iframe з посиланням на міні-табло", async (t) => {
  const WS = fakeSockets();
  const c = control({ WebSocket: WS });
  t.after(c.close);
  let copied = null;
  Object.defineProperty(c.win.navigator, "clipboard", { value: { writeText: (x) => { copied = x; return Promise.resolve(); } } });
  createLink(c);
  c.tap("linkBoardEmbed");
  assert.match(copied, new RegExp('^<iframe src="' + c.text("linkBoard").replace(/[.?]/g, "\\$&") + '"'));
});
