"use strict";

/*
 * Де лежать файли проєкту — одне місце для всіх тестів.
 *
 * Тести звертаються до файлів короткими іменами ("live.html", "match.js"),
 * а тут вони перетворюються на справжні шляхи в public/ і server/.
 * read() для сторінки повертає HTML з уже вставленими стилями з css/pages/ —
 * так тести бачать сторінку цілком, як її бачить браузер.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const pub = path.join(root, "public");

const MAP = {
  "match.js": "js/core/match.js", "palettes.js": "js/core/palettes.js",
  "ui-common.js": "js/shared/ui-common.js", "sounds.js": "js/shared/sounds.js",
  "scorebug.js": "js/shared/scorebug.js", "remote.js": "js/shared/remote.js", "link.js": "js/shared/link.js", "archive.js": "js/shared/archive.js", "feed.js": "js/shared/feed.js",
  "pult.js": "js/pages/pult.js", "display.js": "js/pages/display.js",
  "live.js": "js/pages/live.js", "mini.js": "js/pages/mini.js",
  "theme.css": "css/theme.css", "scorebug.css": "css/scorebug.css"
};
const OUTSIDE = /^(server\/|scripts\/|tests\/|docs\/|\.github\/|\.gitignore$|render\.yaml$|package\.json$|README\.md$|vercel\.json$|vendor\/)/;

/* Повний шлях до файлу за коротким іменем (або шляхом від кореня сайту). */
function file(name) {
  if (OUTSIDE.test(name)) return path.join(root, name);
  return path.join(pub, MAP[name] || name.replace(/^\.\//, ""));
}

const raw = (name) => fs.readFileSync(file(name), "utf8");

function read(name) {
  const s = raw(name);
  if (!name.endsWith(".html")) return s;
  return s.replace(/<link rel="stylesheet" href="\.\/(css\/pages\/[^"]+)">/g,
    (_, css) => "<style>\n" + fs.readFileSync(path.join(pub, css), "utf8") + "</style>");
}

/* Модуль сайту для require() у Node (ядро матчу, спільні модулі). */
const load = (name) => require(file(name));

module.exports = { root, pub, file, raw, read, load };
