/*
 * Збирає в _site лише те, що їде на хостинг: оболонку з офлайн-кешу (sw.js)
 * плюс сам sw.js. Один список файлів на всіх — GitHub Pages, Render, Vercel —
 * і він же гарантує, що офлайн-кеш і хостинг ніколи не розійдуться.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "_site");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const shell = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
const files = [...new Set(shell.concat(["sw.js"]))];

fs.rmSync(out, { recursive: true, force: true });
for (const f of files) {
  const from = path.join(root, f);
  if (!fs.existsSync(from)) { console.error("немає файлу з офлайн-кешу: " + f); process.exit(1); }
  const to = path.join(out, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log("_site: " + files.length + " файлів");
