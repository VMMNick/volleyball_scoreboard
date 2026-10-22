/*
 * Підготовка сайту перед деплоєм (npm run build).
 *
 * Сайт — це папка public/, вона роздається як є (server/server.js), збирати нічого не треба.
 * Але дві речі тут перевіряємо й робимо автоматично:
 *
 * 1. Офлайн-кеш (public/sw.js, список SHELL) має точно збігатися з тим, що лежить
 *    у public/: забутий у SHELL файл не відкриється без інтернету, а зайвий — зламає
 *    встановлення PWA. Скрипт падає, якщо вони розійшлися.
 *
 * 2. Версія кешу (CACHE у sw.js) — це хеш усіх файлів SHELL і самого sw.js. Змінився
 *    хоч один байт — змінилась версія, і встановлені застосунки підтягнуть нове.
 *    З прапорцем --stamp версія вписується в sw.js (так запускають Render і GitHub Pages
 *    перед деплоєм); без нього — лише перевірка, нічого не змінюється.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PUB = path.join(__dirname, "..", "public");
const CACHE_RE = /const CACHE = "[^"]*";/;

function shellOf(sw) {
  return [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"\.\/([^"]*)"/g)]
    .map((m) => m[1]).filter(Boolean);
}

/* Версія кешу з вмісту: файли SHELL по черзі + sw.js без рядка з версією. */
function cacheVersion(pub) {
  pub = pub || PUB;
  const sw = fs.readFileSync(path.join(pub, "sw.js"), "utf8");
  const h = crypto.createHash("sha256");
  h.update(sw.replace(CACHE_RE, 'const CACHE = "";'));
  shellOf(sw).forEach((f) => {
    h.update("\0" + f + "\0");
    h.update(fs.readFileSync(path.join(pub, f)));
  });
  return "volley-score-" + h.digest("hex").slice(0, 10);
}

/* Вписати актуальну версію в sw.js. Повертає її. */
function stamp(pub) {
  pub = pub || PUB;
  const file = path.join(pub, "sw.js");
  const v = cacheVersion(pub);
  const sw = fs.readFileSync(file, "utf8");
  const next = sw.replace(CACHE_RE, "const CACHE = " + JSON.stringify(v) + ";");
  if (next !== sw) fs.writeFileSync(file, next);
  return v;
}

function walk(dir, pub) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, pub) : [path.relative(pub, p).split(path.sep).join("/")];
  });
}

/* Розбіжності між SHELL і папкою: { missing, notCached }. */
function checkShell(pub) {
  pub = pub || PUB;
  const shell = shellOf(fs.readFileSync(path.join(pub, "sw.js"), "utf8"));
  const onDisk = walk(pub, pub).filter((f) => f !== "sw.js" && !f.endsWith(".md"));
  return {
    shell,
    missing: shell.filter((f) => !fs.existsSync(path.join(pub, f))),
    notCached: onDisk.filter((f) => !shell.includes(f))
  };
}

module.exports = { cacheVersion, stamp, checkShell };

if (require.main === module) {
  const r = checkShell();
  if (r.missing.length) console.error("у SHELL є, а файлу немає:\n  " + r.missing.join("\n  "));
  if (r.notCached.length) console.error("файл є, а в SHELL (public/sw.js) його немає:\n  " + r.notCached.join("\n  "));
  if (r.missing.length || r.notCached.length) process.exit(1);
  console.log("public/: " + r.shell.length + " файлів, офлайн-кеш збігається");
  if (process.argv.includes("--stamp")) console.log("версія кешу: " + stamp());
  else {
    const want = cacheVersion();
    const have = (fs.readFileSync(path.join(PUB, "sw.js"), "utf8").match(/const CACHE = "([^"]*)";/) || [])[1];
    console.log(have === want ? "версія кешу актуальна: " + want
      : "версія кешу оновиться під час деплою (npm run build -- --stamp): " + have + " → " + want);
  }
}
