"use strict";

/*
 * Тести звʼязків між файлами. Ядро перевіряє match.test.js, а тут — те,
 * що ламається тихо: перейменований id, забутий файл у кеші, битий маніфест.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { root, read, file } = require("./helpers/site");

const html = read("index.html");
const app = read("pult.js");
const palettesJs = read("palettes.js");
const theme = read("theme.css");
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

const htmlIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));

test("кожен id з pult.js існує в розмітці", () => {
  const missing = [...usedIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], "у розмітці бракує id");
});

test("id у розмітці унікальні", () => {
  const all = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], []);
});

test("обидві половини й сітка на місці", () => {
  ["sideA", "sideB", "scoreA", "scoreB", "netInfo", "undoBtn", "redoBtn"].forEach((id) => {
    assert.ok(htmlIds.has(id), "немає " + id);
  });
});

test("розмітка підключає ядро раніше за інтерфейс", () => {
  const core = html.indexOf("match.js");
  const pal = html.indexOf("palettes.js");
  const ui = html.indexOf("pult.js");
  assert.ok(pal > -1 && pal < ui, "palettes.js має йти раніше за pult.js");
  assert.ok(core > -1 && ui > -1, "обидва скрипти підключені");
  assert.ok(core < ui, "match.js має йти першим, інакше window.Match ще не існує");
});

test("інтерфейс не містить логіки правил", () => {
  assert.equal(/\b25\b/.test(app.replace(/TIMEOUT_SEC = \d+/, "")), false,
    "числа правил живуть у match.js, а не в pult.js");
});

test("service worker кешує всі файли оболонки", () => {
  const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  shell.forEach((f) => {
    assert.ok(fs.existsSync(file(f)), "у кеші вказано неіснуючий файл: " + f);
  });
  ["index.html", "css/theme.css", "js/core/match.js", "js/core/palettes.js", "js/shared/ui-common.js", "js/pages/pult.js", "display.html", "js/pages/display.js", "manifest.webmanifest"].forEach((f) => {
    assert.ok(shell.includes(f), "файл не потрапив в офлайн-кеш: " + f);
  });
});

test("версія кешу задана", () => {
  assert.match(sw, /CACHE\s*=\s*"volley-score-v\d+"/);
});

test("маніфест придатний для встановлення", () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.start_url.includes("index.html"));
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "потрібна maskable-іконка");
  manifest.icons.forEach((i) => {
    assert.ok(fs.existsSync(file(i.src)), "немає файлу іконки: " + i.src);
  });
});

test("розмітка не загубила адаптивний та офлайн-обвʼяз", () => {
  assert.match(html, /min-aspect-ratio:1\/1/, "немає альбомної розкладки");
  assert.match(html, /viewport-fit=cover/, "не враховано вирізи екрана");
  assert.match(html, /100dvh/, "висота має рахуватись від видимої області");
  assert.match(html, /rel="manifest"/);
});

test("сторінка українською", () => {
  assert.match(html, /<html lang="uk">/);
  assert.match(manifest.lang, /uk/);
});

test("неактивні стани мають стилі", () => {
  assert.match(html, /\.to\.off\{/, "неактивний тайм-аут стилюється класом, бо span не має disabled");
  assert.match(html, /\.netbtn\[disabled\]/);
  assert.equal(/\.\w+\[disabled\]/.test(html.match(/\.to[.[][^}]*\}/)?.[0] || ""), false);
});

test("половини фарбуються змінними команд", () => {
  assert.match(theme, /--team-a:#[0-9A-Fa-f]{6}/);
  assert.match(theme, /--ink-a:#[0-9A-Fa-f]{6}/, "потрібен колір тексту на кольоровій половині");
  assert.match(html, /\.side\.a\{background-color:var\(--team-a\)/);
  assert.match(html, /\.side\.b\{background-color:var\(--team-b\)/);
  assert.ok(htmlIds.has("palettes"), "немає місця для зразків палітри");
});

test("палітри мають колір тексту під кожен фон", () => {
  const block = palettesJs.match(/var PALETTES = \[[\s\S]*?\];/);
  assert.ok(block, "палітри оголошені в palettes.js");
  const entries = [...block[0].matchAll(/id: "(\w+)"/g)];
  assert.ok(entries.length >= 3, "щонайменше три варіанти");
  const inks = [...block[0].matchAll(/inkA: "(#[0-9A-Fa-f]{6})", inkB: "(#[0-9A-Fa-f]{6})"/g)];
  assert.equal(inks.length, entries.length, "у кожної палітри заданий колір тексту");
});

test("шрифти лежать у проєкті й покривають кирилицю", () => {
  assert.equal(/fonts\.googleapis/.test(html), false, "без зовнішніх шрифтів — табло має працювати офлайн");
  assert.match(html, /href="\.\/css\/theme\.css"/);
  // theme.css лежить у css/, шрифти — у assets/fonts/: шлях відносно стилю.
  const files = [...theme.matchAll(/url\("\.\.\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 2);
  files.forEach((f) => {
    assert.ok(fs.existsSync(file(f)), "немає файлу шрифту: " + f);
    assert.ok(sw.includes("./" + f), "шрифт не в офлайн-кеші: " + f);
  });
  assert.match(theme, /U\+0400-045F/, "потрібна кирилиця");
  assert.match(theme, /U\+0490-0491/, "потрібна ґ");
});

test("деплой: Render запускає сервер, CI перевіряє сайт", () => {
  assert.match(read(".github/workflows/deploy.yml"), /npm run build/, "CI перевіряє, що сайт збирається");
  assert.equal(fs.existsSync(file("vercel.json")), false, "деплой лише на Render");
  const render = read("render.yaml");
  assert.match(render, /buildCommand: .*npm run build/);
  assert.match(render, /startCommand: npm start/, "Render — сервер для посилань на матч, а не лише статика");
  assert.match(render, /healthCheckPath: \/healthz/);
  if (/package-lock\.json/.test(read(".gitignore"))) {
    assert.equal(/npm ci\b/.test(render), false, "lock-файл не в репозиторії — npm ci на Render впаде");
  }
});

test("ярлики маніфесту ведуть на табло", () => {
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0);
  manifest.shortcuts.forEach((s) => {
    const page = s.url.replace(/^\.\//, "").split("?")[0];
    assert.ok(fs.existsSync(file(page)), "ярлик веде в нікуди: " + s.url);
    assert.ok(s.name && s.icons && s.icons.length);
  });
});

test("назви команд — до 30 символів", () => {
  ["inNameA", "inNameB"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"[^>]*maxlength="30"'), id);
  });
});

test("офлайн-кеш береться з мережі, а не з HTTP-кешу браузера", () => {
  assert.match(sw, /cache: "reload"/, "інакше нова версія кешу може зберегти старі скрипти");
});

test("дві емблеми ліги: на великому табло (арена і смуга), на міні-пульті, у кеші; галочки в пульті", () => {
    const d = read("display.html"), m = read("mini.html"), sw = read("sw.js"), idx = read("index.html");
  for (const id of ["aLogo1", "aLogo2", "sLogo1", "sLogo2"]) assert.match(d, new RegExp('id="' + id + '"'), id);
  for (const id of ["mLogo1", "mLogo2"]) assert.match(m, new RegExp('id="' + id + '"'), id);
  assert.match(sw, /"\.\/assets\/logos\/uvl-new\.webp"/);
  assert.match(sw, /"\.\/assets\/logos\/uvl-old\.webp"/);
  assert.ok(fs.existsSync(file("assets/logos/uvl-old.webp")), "файл попередньої емблеми");
  assert.match(idx, /id="inBoardLogo"/);
  assert.match(idx, /id="inBoardLogoOld"/);
});

test("вибір емблем: галочки пульта, адреса перекриває", () => {
  const U = require("./helpers/site").load("ui-common.js");
  assert.deepEqual(U.logoPick({}), ["new"], "типово — нова");
  assert.deepEqual(U.logoPick({ boardLogo: true, boardLogoOld: true }), ["new", "old"]);
  assert.deepEqual(U.logoPick({ boardLogo: false, boardLogoOld: true }), ["old"]);
  assert.deepEqual(U.logoPick({ boardLogo: false }), []);
  assert.deepEqual(U.logoPick({ boardLogoOld: true }, "0"), []);
  assert.deepEqual(U.logoPick({}, "old"), ["old"]);
  assert.deepEqual(U.logoPick({}, "both"), ["new", "old"]);
});

test("структура: усе з public/ — в офлайн-кеші, і навпаки (npm run build)", () => {
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(process.execPath, [file("scripts/build.js")], { encoding: "utf8" });
  assert.match(out, /офлайн-кеш збігається/);
});

test("свої кольори: перевірка, текст на кольорі команди, кольори таблиці", () => {
  const P = require("./helpers/site").load("palettes.js");
  assert.deepEqual(P.pickColors({ colorA: "#ff0000", colorB: "red", colorBg: "", evil: "#000000" }), { colorA: "#FF0000" }, "лише #RRGGBB");
  assert.equal(P.boardColors({}), null, "без своїх кольорів таблиця як у theme.css");
  const fake = () => { const st = {}; return { style: { setProperty: (k, v) => { st[k] = v; }, removeProperty: (k) => { delete st[k]; } }, st };};
  const el = fake();
  const t = P.apply(el, "classic", { colorA: "#F7D23A", colorB: "#0A1F30" });
  assert.equal(el.st["--team-a"], "#F7D23A");
  assert.equal(t.inkA, "#0A1F30", "на жовтому — темний текст");
  assert.equal(t.inkB, "#FFFFFF", "на темно-синьому — білий");
  assert.equal(P.apply(fake(), "classic", {}).a, "#1668C9", "без своїх — палітра");
  const light = P.boardColors({ colorBg: "#FFFFFF" });
  assert.ok(P.contrast(light.text, light.bg) >= 7, "на білому фоні текст сам стає темним");
  const dark = P.boardColors({ colorBg: "#000000" });
  assert.ok(P.contrast(dark.text, dark.bg) >= 7);
  assert.equal(P.boardColors({ colorFrame: "#F7D23A" }).bg, "#0A1F30", "лише рамка — фон лишається");
  P.SWATCHES.forEach((c) => assert.ok(P.isHex(c), c));
  const srv = read("server/server.js");
  ["colorA", "colorB", "colorBg", "colorFrame", "colorText"].forEach((k) => assert.match(srv, new RegExp('"' + k + '"'), "сервер пересилає " + k));
  assert.match(read("index.html"), /id="colorPickers"/);
  assert.match(read("index.html"), /id="colorPreview"/);
});

test("архітектура: feed.js потребує remote.js — кожна сторінка з feed.js підключає remote.js раніше", () => {
  ["display.html", "live.html"].forEach((p) => {
    const h = read(p), feed = h.indexOf('src="./js/shared/feed.js"'), rem = h.indexOf('src="./js/shared/remote.js"');
    assert.ok(feed > -1, p);
    assert.ok(rem > -1 && rem < feed, p + ": remote.js перед feed.js — інакше ?room= мовчки не працює");
  });
});

test("архітектура: ядро без DOM, спільне не залежить від сторінок", () => {
  const fs = require("node:fs"), path = require("node:path");
  const dir = (d) => fs.readdirSync(file(d)).map((f) => d + "/" + f);
  dir("js/core").forEach((f) => {
    const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.equal(/\b(document|localStorage|navigator)\b|window\./.test(code), false, f + ": ядро не знає про браузер");
  });
  dir("js/shared").forEach((f) => {
    assert.equal(/js\/pages\/|Pult|pult\.js/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), false, f);
  });
});
