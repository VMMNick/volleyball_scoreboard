"use strict";

/* Англійська версія: словник, шаблони, вибір мови й повнота перекладу статичного тексту сторінок. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { load, read } = require("./helpers/site");
const I = load("i18n.js");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }

test("точні рядки й пробіли: переклад не залежить від переносів у розмітці", () => {
  assert.equal(I.tr("Новий матч"), "New match");
  assert.equal(I.tr("  Новий\n      матч  "), "  New match  ", "пробіли по краях лишаються");
  assert.equal(I.tr("0:12"), "0:12", "без кирилиці — як є");
  assert.equal(I.tr("Невідомий рядок"), "Невідомий рядок", "непереведене не ламається");
});

test("складені фрази: сет, очки до перемоги, матчбол, тайм-аут, заміни", () => {
  assert.equal(I.tr("2-й сет · до 25"), "Set 2 · to 25");
  assert.equal(I.tr("до 15"), "to 15");
  assert.equal(I.tr("до 3 перемог"), "first to 3 wins");
  assert.equal(I.tr("матчбол · Імідж"), "match point · Імідж", "назва команди не перекладається");
  assert.equal(I.tr("Імідж виграла 3:1"), "Імідж wins 3:1");
  assert.equal(I.tr("тайм-аут ●○"), "timeout ●○");
  assert.equal(I.tr("тайм-аут · Ліцей · 12"), "timeout · Ліцей · 12");
  assert.equal(I.tr("замін у сеті: 2 з 6"), "substitutions this set: 2 of 6");
  assert.equal(I.tr("· заміна 7 → 12"), "· substitution 7 → 12");
  assert.equal(I.tr("картка: червона · №7"), "card: red · #7");
  assert.equal(I.tr("на звʼязку · ви — другий суддя · код ABC234"), "connected · you are the second referee · code ABC234");
  assert.equal(I.tr("Фон таблиці: #0A1F30"), "Board background: #0A1F30");
  assert.equal(I.tr("Зал: сети до 25, вирішальний до 15, тайм-аутів 2; сторони міняють між сетами і на 8 очках у вирішальному."),
    "Indoor: sets to 25, deciding set to 15, timeouts 2; sides switch between sets and at 8 points in the deciding set.");
  assert.equal(I.tr("Пляж: сети до 21, вирішальний до 15, тайм-аутів 1; сторони міняють щоразу, коли сума очок кратна 7, у вирішальному — 5; технічний тайм-аут на 21 очках."),
    "Beach: sets to 21, deciding set to 15, timeouts 1; sides switch whenever the point total is a multiple of 7, in the deciding set — 5; technical timeout at 21 points.");
  assert.equal(I.tr("⇄ поміняти сторони"), "⇄ switch sides");
  assert.equal(I.tr("Сервер x.onrender.com не відповідає — він вимкнений або адреса неправильна."),
    "Server x.onrender.com is not responding — it is off or the address is wrong.");
});

test("типові назви команд — англійською, свої — ні", () => {
  assert.equal(I.tr("Команда А"), "Team A");
  assert.equal(I.tr("Команда Б виграла"), "Team B wins");
  assert.equal(I.tr("Імідж"), "Імідж");
});

test("вибір мови: ?lang= запамʼятовується, далі — збережена, типово — українська", () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) || null, setItem: (k, v) => m.set(k, v) }; };
  const st = mem();
  assert.equal(I.detect({ search: "" }, st), "uk");
  assert.equal(I.detect({ search: "?lang=en" }, st), "en");
  assert.equal(I.detect({ search: "" }, st), "en", "запамʼятала");
  assert.equal(I.detect({ search: "?lang=xx" }, st), "en", "невідома мова — ігнор");
  assert.equal(I.detect({ search: "?lang=uk" }, st), "uk");
  assert.equal(I.detect({ search: "" }, { getItem: () => { throw new Error("приватний режим"); }, setItem() {} }), "uk");
  assert.equal(I.t("Новий матч"), "Новий матч", "без DOM (Node) — мова не en, рядок як є");
});

test("словник: без дублікатів-перекладів кирилицею", () => {
  Object.keys(I.EN).forEach((k) => {
    assert.equal(/[А-Яа-яЇїІіЄєҐґ]/.test(I.EN[k]), false, "у перекладі лишилась кирилиця: " + k);
  });
});

const ALLOW = ["Мова / Language"];          // двомовний підпис перемикача — навмисно

(JSDOM ? test : test.skip)("повнота: кожен текст, title, placeholder і aria-label на сторінках має переклад", () => {
  const missing = [];
  ["index.html", "display.html", "live.html", "mini.html", "account.html", "admin.html"].forEach((page) => {
    const doc = new JSDOM(read(page)).window.document;
    const check = (t, where) => {
      const n = t.replace(/\s+/g, " ").trim();
      if (!/[А-Яа-яЇїІіЄєҐґ]/.test(n) || ALLOW.includes(n)) return;
      if (I.tr(n) === n || /[А-Яа-яЇїІіЄєҐґ]/.test(I.tr(n).replace(/Команда [АБ]/g, ""))) missing.push(page + " " + where + ": " + n);
    };
    const w = doc.createTreeWalker(doc.documentElement, 4);
    let node;
    while ((node = w.nextNode())) {
      const el = node.parentElement;
      if (!el || /SCRIPT|STYLE/.test(el.tagName) || el.closest('[translate="no"]')) continue;
      check(node.nodeValue, "текст");
    }
    doc.querySelectorAll("[title],[placeholder],[aria-label]").forEach((el) =>
      ["title", "placeholder", "aria-label"].forEach((a) => el.hasAttribute(a) && check(el.getAttribute(a), a)));
  });
  assert.deepEqual(missing, []);
});

test("i18n.js підключено першим після config.js на кожній сторінці, назви команд позначено translate=no", () => {
  ["index.html", "display.html", "live.html", "mini.html"].forEach((page) => {
    const h = read(page);
    const cfg = h.indexOf('src="./js/config.js"'), i18n = h.indexOf('src="./js/shared/i18n.js"'), core = h.indexOf('src="./js/core/match.js"');
    assert.ok(cfg < i18n && i18n < core, page);
  });
  assert.match(read("index.html"), /translate="no"[^>]*id="nameA"/);
  assert.match(read("sw.js"), /"\.\/js\/shared\/i18n\.js"/);
});
