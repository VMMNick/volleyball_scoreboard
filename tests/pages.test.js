"use strict";

/*
 * Запуск на GitHub Pages: сайт — статика з public/, сервер посилань — окремо (Render).
 * Адресу сервера задає js/config.js, а на Pages її вписує scripts/pages-config.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { read, file, load } = require("./helpers/site");

const R = load("remote.js");
const loc = (href) => new URL(href);

test("сервер за замовчуванням: config.js → той самий сайт → на GitHub Pages сервера немає", () => {
  const render = "https://volleyball-scoreboard.onrender.com";
  assert.equal(R.defaultServer(loc("https://tablo.onrender.com/index.html"), null), "https://tablo.onrender.com", "Render: сайт і сервер разом");
  assert.equal(R.defaultServer(loc("http://localhost:3000/"), null), "http://localhost:3000");
  assert.equal(R.defaultServer(loc("https://kolya.github.io/volleyball_scoreboard/"), null), "", "Pages без налаштування — лише статика");
  assert.equal(R.defaultServer(loc("https://kolya.github.io/volleyball_scoreboard/"), { syncServer: render + "/" }), render);
  assert.equal(R.defaultServer(loc("https://tablo.onrender.com/"), { syncServer: "" }), "https://tablo.onrender.com");
  assert.equal(R.defaultServer(loc("file:///C:/tablo/public/index.html"), null), "");
  assert.equal(R.defaultServer(loc("https://kolya.github.io/x/"), { syncServer: "не адреса" }), "", "сміття в налаштуванні ігнорується");
});

test("на Pages посилання на табло й пульт ведуть на сервер, а не на github.io", () => {
  const s = R.defaultServer(loc("https://kolya.github.io/volleyball_scoreboard/"), { syncServer: "https://v.onrender.com" });
  assert.equal(R.viewerLink(s, "live.html", "ABC234"), "https://v.onrender.com/live.html?room=ABC234");
  assert.equal(R.wsUrl(s, { room: "ABC234", role: "viewer" }), "wss://v.onrender.com/ws?room=ABC234&role=viewer");
});

test("кожна сторінка підключає js/config.js раніше за решту скриптів", () => {
  ["index.html", "display.html", "live.html", "mini.html"].forEach((p) => {
    const h = read(p);
    const cfg = h.indexOf('src="./js/config.js"');
    assert.ok(cfg > -1, p);
    assert.ok(cfg < h.indexOf('src="./js/core/match.js"'), p + ": config.js — першим");
  });
  assert.match(read("sw.js"), /"\.\/js\/config\.js"/, "в офлайн-кеші");
  assert.match(read("js/config.js"), /syncServer: ""/, "у репозиторії адреса порожня — на Render сервер той самий");
});

test("scripts/pages-config.js вписує SYNC_SERVER і відкидає неправильну адресу", () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cfg-")), "config.js");
  const run = (env) => execFileSync(process.execPath, [file("scripts/pages-config.js"), tmp],
    { env: Object.assign({}, process.env, env), encoding: "utf8", stdio: "pipe" });
  fs.copyFileSync(file("js/config.js"), tmp);
  run({ SYNC_SERVER: "" });
  assert.match(fs.readFileSync(tmp, "utf8"), /syncServer: ""/, "без змінної нічого не міняє");
  run({ SYNC_SERVER: "volleyball-scoreboard.onrender.com/" });
  assert.match(fs.readFileSync(tmp, "utf8"), /syncServer: "https:\/\/volleyball-scoreboard\.onrender\.com"/);
  fs.copyFileSync(file("js/config.js"), tmp);
  assert.throws(() => run({ SYNC_SERVER: "https://x.onrender.com/ws?a=1" }));
  assert.match(fs.readFileSync(tmp, "utf8"), /syncServer: ""/, "неправильна адреса не потрапляє на сайт");
});

test("workflow GitHub Pages: тести, адреса сервера, публікація саме public/", () => {
  const y = read(".github/workflows/pages.yml");
  assert.match(y, /branches: \[main\]/);
  assert.match(y, /pages: write/);
  assert.match(y, /id-token: write/);
  assert.match(y, /npm test/);
  assert.match(y, /node scripts\/pages-config\.js/);
  assert.match(y, /SYNC_SERVER: \$\{\{ vars\.SYNC_SERVER \}\}/);
  assert.match(y, /upload-pages-artifact@v\d[\s\S]*path: public/);
  assert.match(y, /deploy-pages@v\d/);
});

test("усі адреси на сторінках відносні — сайт працює й у підпапці github.io/<репозиторій>/", () => {
  ["index.html", "display.html", "live.html", "mini.html"].forEach((p) => {
    const h = read(p);
    const abs = [...h.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(abs, [], p + ": посилання від кореня домену зламаються на Pages");
  });
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.ok(!/^\//.test(m.start_url) && !/^\//.test(m.scope || "."), "маніфест — теж відносний");
});
