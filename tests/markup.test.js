"use strict";

/*
 * Тести звʼязків між файлами. Ядро перевіряє match.test.js, а тут — те,
 * що ламається тихо: перейменований id, забутий файл у кеші, битий маніфест.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const html = read("index.html");
const app = read("app.js");
const palettesJs = read("palettes.js");
const theme = read("theme.css");
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

const htmlIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));

test("кожен id з app.js існує в розмітці", () => {
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
  const ui = html.indexOf("app.js");
  assert.ok(pal > -1 && pal < ui, "palettes.js має йти раніше за app.js");
  assert.ok(core > -1 && ui > -1, "обидва скрипти підключені");
  assert.ok(core < ui, "match.js має йти першим, інакше window.Match ще не існує");
});

test("інтерфейс не містить логіки правил", () => {
  assert.equal(/\b25\b/.test(app.replace(/TIMEOUT_SEC = \d+/, "")), false,
    "числа правил живуть у match.js, а не в app.js");
});

test("service worker кешує всі файли оболонки", () => {
  const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  shell.forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, f)), "у кеші вказано неіснуючий файл: " + f);
  });
  ["index.html", "theme.css", "match.js", "palettes.js", "ui-common.js", "app.js", "display.html", "display.js", "manifest.webmanifest"].forEach((f) => {
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
    assert.ok(fs.existsSync(path.join(root, i.src)), "немає файлу іконки: " + i.src);
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
  assert.match(html, /href="\.\/theme\.css"/);
  const files = [...theme.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(files.length >= 2);
  files.forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, f)), "немає файлу шрифту: " + f);
    assert.ok(sw.includes("./" + f), "шрифт не в офлайн-кеші: " + f);
  });
  assert.match(theme, /U\+0400-045F/, "потрібна кирилиця");
  assert.match(theme, /U\+0490-0491/, "потрібна ґ");
});

test("збирання для хостингу бере файли з офлайн-кешу", () => {
  assert.match(read(".github/workflows/deploy.yml"), /npm run build/, "CI перевіряє, що сайт збирається");
  assert.equal(fs.existsSync(path.join(root, "vercel.json")), false, "деплой лише на Render");
  const render = read("render.yaml");
  assert.match(render, /buildCommand: .*npm run build/);
  assert.match(render, /startCommand: node server\.js/, "Render — сервер для посилань на матч, а не лише статика");
  assert.match(render, /healthCheckPath: \/healthz/);
  if (/package-lock\.json/.test(read(".gitignore"))) {
    assert.equal(/npm ci\b/.test(render), false, "lock-файл не в репозиторії — npm ci на Render впаде");
  }
});

test("ярлики маніфесту ведуть на табло", () => {
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0);
  manifest.shortcuts.forEach((s) => {
    const file = s.url.replace(/^\.\//, "").split("?")[0];
    assert.ok(fs.existsSync(path.join(root, file)), "ярлик веде в нікуди: " + s.url);
    assert.ok(s.name && s.icons && s.icons.length);
  });
});

test("назви команд — до 30 символів", () => {
  ["inNameA", "inNameB"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"[^>]*maxlength="30"'), id);
  });
});
