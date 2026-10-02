"use strict";

/*
 * Окреме посилання для трансляції в OBS: live.html?room=…&bg=none&pos=…
 * і блок «Для трансляції (OBS)» на пульті.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Match = require("../match.js");
const Remote = require("../remote.js");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }
const suite = JSDOM ? test : test.skip;

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const liveHtml = read("live.html");
const controlHtml = read("index.html");
const base = ["match.js", "palettes.js", "ui-common.js", "remote.js"].map(read);

/* WebSocket, що нікуди не підключається, — лише запамʼятовує адреси. */
function fakeWs(urls) {
  return function FakeWS(url) { urls.push(url); this.readyState = 0; this.send = () => {}; this.close = () => {}; };
}

function boot(markup, scripts, opts) {
  const dom = new JSDOM(markup, { url: opts.url, pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  win.WebSocket = fakeWs(opts.urls || []);
  win.confirm = () => true;
  if (opts.seed) Object.keys(opts.seed).forEach((k) => win.localStorage.setItem(k, opts.seed[k]));
  base.concat(scripts).forEach((s) => win.eval(s));
  return { win, $: (id) => win.document.getElementById(id), errors, close: () => win.close() };
}

const live = (url, urls) => boot(liveHtml, [read("feed.js"), read("live.js")], { url, urls });
const tap = (d, el) => el.dispatchEvent(new d.win.Event("click", { bubbles: true }));

test("посилання для глядачів: додаткові параметри дописуються після кімнати", () => {
  assert.equal(Remote.viewerLink("https://t.onrender.com/", "live.html", "ABC234"), "https://t.onrender.com/live.html?room=ABC234");
  assert.equal(Remote.viewerLink("https://t.onrender.com", "live.html", "ABC234", "bg=none&pos=br"),
    "https://t.onrender.com/live.html?room=ABC234&bg=none&pos=br");
});

test("накладка OBS: у кадрі лише табло, кут задається класом", () => {
  assert.match(liveHtml, /body\.clear \.empty,body\.clear \.link-status\{display:none!important\}/);
  assert.match(liveHtml, /body\.clear\{[^}]*background:transparent/);
  ["tr", "bl", "br"].forEach((p) => assert.match(liveHtml, new RegExp("body\\.clear\\.pos-" + p + "\\{")));
});

suite("live.html?bg=none&pos=br — прозора накладка в правому нижньому куті, підключена до кімнати", (t) => {
  const urls = [];
  const d = live("https://t.onrender.com/live.html?room=ABC234&bg=none&pos=br", urls);
  t.after(d.close);
  const cls = d.win.document.body.classList;
  assert.ok(cls.contains("clear"));
  assert.ok(cls.contains("pos-br"));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^wss:\/\/t\.onrender\.com\/ws\?room=ABC234&role=viewer$/);
  assert.deepEqual(d.errors, []);
});

suite("live.html: невідомий кут ігнорується, без bg=none кут не застосовується", (t) => {
  const a = live("https://t.onrender.com/live.html?room=ABC234&bg=none&pos=xx");
  const b = live("https://t.onrender.com/live.html?room=ABC234&pos=br");
  t.after(() => { a.close(); b.close(); });
  assert.equal([...a.win.document.body.classList].some((c) => c.startsWith("pos-")), false);
  assert.equal(b.win.document.body.classList.contains("clear"), false);
  assert.equal(b.win.document.body.classList.contains("pos-br"), false);
});

suite("пульт: окреме посилання для OBS з тією ж кімнатою, кут змінюється кнопками", (t) => {
  const cast = { server: "https://t.onrender.com", room: "ABC234", key: "k".repeat(32), page: "live.html" };
  const d = boot(controlHtml, [read("vendor/qrcode.js"), read("app.js")], {
    url: "https://t.onrender.com/",
    seed: { "volleyball:cast": JSON.stringify(cast), "volleyball:match": Match.serialize(Match.createMatch({ names: ["Імідж", "Ліцей"] })) }
  });
  t.after(d.close);

  tap(d, d.$("mCast"));
  assert.ok(d.$("castSheet").classList.contains("on"), "трансляція відновилась після перезавантаження");
  assert.equal(d.$("castObsLink").textContent, "https://t.onrender.com/live.html?room=ABC234&bg=none");

  tap(d, d.$("segCastPos").querySelector('[data-pos="br"]'));
  assert.equal(d.$("castObsLink").textContent, "https://t.onrender.com/live.html?room=ABC234&bg=none&pos=br");
  assert.equal(d.$("segCastPos").querySelector('[data-pos="br"]').getAttribute("aria-pressed"), "true");
  const saved = JSON.parse(d.win.localStorage.getItem("volleyball:cast"));
  assert.equal(saved.pos, "br", "кут памʼятається");
  assert.equal(saved.room, "ABC234", "кімната та сама — посилання в OBS не ламається");
  assert.deepEqual(d.errors, []);
});
