"use strict";

/* Архів матчів: логіка без браузера і пульт у jsdom (матч закінчився → в архіві → протокол, CSV, видалення). */

const test = require("node:test");
const assert = require("node:assert/strict");
const { load, read } = require("./helpers/site");
const M = load("match.js");
const A = load("archive.js");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) { JSDOM = null; }

function memStorage(limit) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (limit && String(v).length > limit) throw new Error("QuotaExceeded"); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k), m
  };
}

const QUICK = { bestOf: 1, target: 3, winBy: 2 };
function played(seq, names) {
  let m = M.createMatch({ names: names || ["Імідж", "Ліцей"], rules: QUICK, title: "Кубок міста" });
  let ts = 1000;
  for (const ch of seq) { m = M.addPoint(m, ch === "A" ? 0 : 1, ts); ts += 1000; }
  return m;
}

test("архів: підсумок матчу — сети, рахунок кожного сету, назви, турнір", () => {
  const e = A.summarize(played("AAA"), 5000);
  assert.equal(e.done, true);
  assert.equal(e.winner, 0);
  assert.deepEqual(e.sets, [1, 0]);
  assert.deepEqual(e.scores, [[3, 0]]);
  assert.equal(e.title, "Кубок міста");
  assert.equal(A.scoreLine(e), "3:0");
  const unfinished = A.summarize(played("AB"));
  assert.equal(unfinished.done, false);
  assert.deepEqual(unfinished.scores, [[1, 1]], "недограний сет теж видно");
});

test("архів: той самий матч оновлюється, порожній не зберігається, не більше MAX", () => {
  let list = [];
  const m = played("AB");
  list = A.put(list, m);
  list = A.put(list, M.addPoint(m, 0, 9000));
  assert.equal(list.length, 1, "той самий mid — один запис");
  assert.deepEqual(list[0].scores, [[2, 1]]);
  assert.equal(A.put(list, M.createMatch()).length, 1, "без розіграшів — не зберігаємо");
  for (let i = 0; i < A.MAX + 5; i++) list = A.put(list, played("A"));
  assert.equal(list.length, A.MAX);
  assert.equal(A.remove(list, list[0].mid).length, A.MAX - 1);
});

test("архів: збереження, відкриття для протоколу, зіпсоване сховище, брак місця", () => {
  const st = memStorage();
  const m = played("AAA");
  A.save(st, A.put([], m));
  const list = A.load(st);
  assert.equal(list.length, 1);
  const back = A.open(list, m.mid);
  assert.deepEqual(M.reduce(back).sets, [1, 0]);
  assert.match(M.toCSV(back), /Імідж/);
  assert.equal(A.open(list, "немає"), null);

  st.setItem(A.KEY, "{не json");
  assert.deepEqual(A.load(st), []);
  st.setItem(A.KEY, JSON.stringify([{ mid: 1 }, null, list[0]]));
  assert.equal(A.load(st).length, 1, "зіпсовані записи відкидаємо");

  // Місця мало — викидаємо найстаріші, найновіші лишаються.
  const tight = memStorage(JSON.stringify(list).length * 3);
  let many = [];
  for (let i = 0; i < 10; i++) many = A.put(many, played("A"));
  assert.equal(A.save(tight, many), true);
  const kept = A.load(tight);
  assert.ok(kept.length > 0 && kept.length < 10);
  assert.equal(kept[0].mid, many[0].mid, "найновіший — на місці");
});

/* ---------- пульт ---------- */

function boot(seed) {
  const dom = new JSDOM(read("index.html"), { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message));
  win.confirm = () => true;
  win.URL.createObjectURL = () => "blob:x";
  win.URL.revokeObjectURL = () => {};
  const downloads = [];
  win.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  Object.keys(seed || {}).forEach((k) => win.localStorage.setItem(k, seed[k]));
  ["match.js", "palettes.js", "ui-common.js", "remote.js", "link.js", "archive.js", "pult.js"].forEach((f) => win.eval(read(f)));
  const $ = (id) => win.document.getElementById(id);
  const tap = (el) => (typeof el === "string" ? $(el) : el).dispatchEvent(new win.Event("click", { bubbles: true }));
  return { win, $, tap, errors, downloads, close: () => win.close(),
           archive: () => JSON.parse(win.localStorage.getItem("volleyball:archive") || "[]") };
}

const suite = JSDOM ? test : test.skip;

suite("пульт: завершений матч сам потрапляє в архів; протокол, CSV і видалення з архіву", (t) => {
  const quick = M.serialize(M.createMatch({ names: ["Імідж", "Ліцей"], rules: QUICK }));
  const ui = boot({ "volleyball:match": quick });
  t.after(ui.close);

  ui.tap("mArchive");
  assert.match(ui.$("archiveList").textContent, /Поки порожньо/);
  assert.equal(ui.$("archiveClear").disabled, true);

  ["sideA", "sideA", "sideA"].forEach((id) => ui.tap(id));       // 3:0 — матч закінчився
  assert.equal(ui.archive().length, 1, "у архіві одразу після останнього очка");

  ui.tap("mArchive");
  const item = ui.$("archiveList").querySelector(".arch-item");
  assert.match(item.textContent, /Імідж — Ліцей/);
  assert.match(item.textContent, /1:0/);
  assert.match(item.textContent, /3:0/);

  ui.tap("finalNew");                                             // новий матч — архів не дублюється
  assert.equal(ui.archive().length, 1);
  ui.tap("sideB");
  assert.equal(ui.$("scoreB").textContent.trim(), "1");

  ui.tap("mArchive");
  ui.tap(ui.$("archiveList").querySelector('[data-act="proto"]'));
  assert.ok(ui.$("proto").classList.contains("show"));
  assert.equal(ui.$("protoTitle").textContent, "Протокол · з архіву");
  assert.match(ui.$("protoHead").textContent, /1:0/, "протокол архівного, а не поточного матчу");
  ui.tap("protoCSV");
  assert.match(ui.downloads[0], /Імідж-Ліцей\.csv$/);

  ui.tap("mProto");
  assert.equal(ui.$("protoTitle").textContent, "Протокол", "звичайний протокол — знову поточний матч");
  assert.match(ui.$("protoHead").textContent, /0:0/);

  ui.tap("mArchive");
  ui.tap(ui.$("archiveList").querySelector('[data-act="csv"]'));
  assert.equal(ui.downloads.length, 2);
  ui.tap(ui.$("archiveList").querySelector('[data-act="del"]'));
  assert.equal(ui.archive().length, 0);
  assert.match(ui.$("archiveList").textContent, /Поки порожньо/);
  assert.deepEqual(ui.errors, []);
});

suite("пульт: «Новий матч» посеред гри зберігає недограний матч в архіві", (t) => {
  const ui = boot();
  t.after(ui.close);
  ["sideA", "sideB", "sideA"].forEach((id) => ui.tap(id));
  ui.tap("mNew");
  assert.equal(ui.$("scoreA").textContent.trim(), "0");
  const list = ui.archive();
  assert.equal(list.length, 1);
  assert.equal(list[0].done, false);
  assert.deepEqual(list[0].scores, [[2, 1]]);
  ui.tap("mArchive");
  assert.match(ui.$("archiveList").textContent, /не дограний/);
  ui.tap("archiveClear");
  assert.equal(ui.archive().length, 0);
});

suite("пульт: протокол перерваного матчу з архіву — «перервано», час до останнього розіграшу", (t) => {
  let m = M.createMatch({ names: ["А", "Б"] });
  m = M.addPoint(m, 0, Date.now() - 3600e3);
  m = M.addPoint(m, 1, Date.now() - 3600e3 + 90e3);                 // півтори хвилини гри годину тому
  const ui = boot({ "volleyball:archive": JSON.stringify(A.put([], m)) });
  t.after(ui.close);
  ui.tap("mArchive");
  ui.tap(ui.$("archiveList").querySelector('[data-act="proto"]'));
  assert.match(ui.$("protoSets").textContent, /перервано/);
  assert.doesNotMatch(ui.$("protoSets").textContent, /триває/);
  assert.match(ui.$("protoHead").textContent, /1:30$/, "1:30 гри, а не година від початку");
});

/* ---------- пошук в архіві ---------- */

function archived(names, title, startTs, seq) {
  let m = M.createMatch({ names, rules: QUICK, title });
  let ts = startTs;
  for (const ch of seq) { m = M.addPoint(m, ch === "A" ? 0 : 1, ts); ts += 1000; }
  return m;
}

test("пошук: кожне слово — в командах, турнірі, даті чи рахунку; регістр і апостроф не важать", () => {
  const d1 = new Date(2026, 9, 18, 15, 0).getTime(), d2 = new Date(2026, 9, 22, 16, 10).getTime();
  let list = [];
  list = A.put(list, archived(["Імідж", "Ліцей №5"], "Кубок Ужгорода", d1, "AAA"), d1);
  list = A.put(list, archived(["Мʼячик", "Спартак"], "Шкільна ліга", d2, "BBAB"), d2);
  list = A.put(list, archived(["Імідж", "Спартак"], "", d2 + 3600e3, "ABA"), d2 + 3600e3);
  const names = (r) => r.map((e) => e.names.join("—"));

  assert.equal(A.search(list, "").length, 3, "порожній запит — увесь архів");
  assert.equal(A.search(list, "   ").length, 3);
  assert.deepEqual(names(A.search(list, "імідж")).sort(), ["Імідж—Ліцей №5", "Імідж—Спартак"]);
  assert.deepEqual(names(A.search(list, "ІМІДЖ спартак")), ["Імідж—Спартак"], "усі слова мають знайтися");
  assert.deepEqual(names(A.search(list, "м'ячик")), ["Мʼячик—Спартак"], "' і ʼ — одне й те саме");
  assert.deepEqual(names(A.search(list, "ліцей 5")), ["Імідж—Ліцей №5"], "№ не заважає");
  assert.deepEqual(names(A.search(list, "кубок")), ["Імідж—Ліцей №5"], "за турніром");
  assert.equal(A.search(list, "22.10.2026").length, 2, "за датою");
  assert.deepEqual(names(A.search(list, "18.10")), ["Імідж—Ліцей №5"]);
  assert.deepEqual(names(A.search(list, "3:0")), ["Імідж—Ліцей №5"], "за рахунком сету");
  assert.deepEqual(A.search(list, "волейбол"), []);
  assert.equal(A.dateText(d2), "22.10.2026 16:10");
});

suite("пульт: пошук в архіві — фільтр, лічильник, «нічого не знайдено», щоразу з чистого поля", (t) => {
  let list = [];
  const now = Date.now();
  list = A.put(list, archived(["Імідж", "Ліцей"], "Кубок міста", now - 7200e3, "AAA"), now - 7200e3);
  list = A.put(list, archived(["Спартак", "Динамо"], "", now - 3600e3, "BBB"), now - 3600e3);
  const ui = boot({ "volleyball:archive": JSON.stringify(list) });
  t.after(ui.close);
  const items = () => ui.$("archiveList").querySelectorAll(".arch-item").length;
  const type = (v) => { ui.$("archiveSearch").value = v; ui.$("archiveSearch").dispatchEvent(new ui.win.Event("input")); };

  ui.tap("mArchive");
  assert.equal(ui.$("archiveFind").hidden, false);
  assert.equal(items(), 2);
  assert.equal(ui.$("archiveCount").textContent, "");
  type("спартак");
  assert.equal(items(), 1);
  assert.match(ui.$("archiveList").textContent, /Спартак — Динамо/);
  assert.equal(ui.$("archiveCount").textContent, "Знайдено: 1 з 2");
  type("волейбол");
  assert.equal(items(), 0);
  assert.match(ui.$("archiveList").textContent, /Нічого не знайдено за «волейбол»/);
  assert.equal(ui.$("archiveClear").disabled, false, "очистити можна весь архів, навіть коли нічого не знайдено");

  type("кубок");
  ui.tap(ui.$("archiveList").querySelector('[data-act="del"]'));   // видалення — і список лишається відфільтрованим
  assert.equal(ui.archive().length, 1);
  assert.match(ui.$("archiveList").textContent, /Нічого не знайдено/);

  ui.tap("mArchive");                                                // відкрили знову — поле порожнє, увесь архів
  assert.equal(ui.$("archiveSearch").value, "");
  assert.equal(items(), 1);
  assert.equal(ui.$("archiveFind").hidden, true, "один матч — шукати нема з чого");
  assert.deepEqual(ui.errors, []);
});
