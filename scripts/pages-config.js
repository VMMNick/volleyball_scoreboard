/*
 * Підготовка public/ до GitHub Pages (викликає .github/workflows/pages.yml).
 *
 * GitHub Pages віддає лише статичні файли — сервера «Посилань на матч» там немає.
 * Якщо в репозиторії задано змінну SYNC_SERVER (адреса сервісу на Render),
 * вписуємо її в public/js/config.js: пульт на github.io створюватиме посилання
 * на матч через Render. Без змінної все працює на одному пристрої й офлайн.
 *
 *   SYNC_SERVER=https://volleyball-scoreboard.onrender.com node scripts/pages-config.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "..", "public", "js", "config.js");   // інший файл — для тестів
const raw = String(process.env.SYNC_SERVER || "").trim().replace(/\/+$/, "");

if (!raw) {
  console.log("SYNC_SERVER не задано: сайт без посилань на матч (усе інше працює)");
  process.exit(0);
}
const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url)) {
  console.error("SYNC_SERVER має бути адресою сервера без шляху, напр. https://назва.onrender.com — отримано: " + raw);
  process.exit(1);
}
const src = fs.readFileSync(file, "utf8");
const out = src.replace(/syncServer: "[^"]*"/, "syncServer: " + JSON.stringify(url));
if (out === src && !src.includes(JSON.stringify(url))) { console.error("не знайдено syncServer у " + file); process.exit(1); }
fs.writeFileSync(file, out);
console.log("сервер посилань на матч: " + url);
// config.js змінився вже після npm run build — перераховуємо версію офлайн-кешу,
// інакше встановлені застосунки не помітили б нову адресу сервера.
if (!process.argv[2]) console.log("версія кешу: " + require("./build.js").stamp());
