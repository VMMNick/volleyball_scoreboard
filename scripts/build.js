/*
 * Перевірка сайту перед деплоєм (npm run build).
 *
 * Сайт — це папка public/, вона роздається як є (server/server.js), збирати нічого не треба.
 * Зате офлайн-кеш (public/sw.js, список SHELL) має точно збігатися з тим, що лежить
 * у public/: забутий у SHELL файл не відкриється без інтернету, а зайвий — зламає
 * встановлення PWA. Цей скрипт падає, якщо вони розійшлися.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
const sw = fs.readFileSync(path.join(pub, "sw.js"), "utf8");
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"\.\/([^"]*)"/g)]
  .map((m) => m[1]).filter(Boolean);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [path.relative(pub, p).split(path.sep).join("/")];
  });
}
const onDisk = walk(pub).filter((f) => f !== "sw.js" && !f.endsWith(".md"));

const missing = shell.filter((f) => !fs.existsSync(path.join(pub, f)));
const notCached = onDisk.filter((f) => !shell.includes(f));
if (missing.length) console.error("у SHELL є, а файлу немає:\n  " + missing.join("\n  "));
if (notCached.length) console.error("файл є, а в SHELL (public/sw.js) його немає:\n  " + notCached.join("\n  "));
if (missing.length || notCached.length) process.exit(1);
console.log("public/: " + shell.length + " файлів, офлайн-кеш збігається");
