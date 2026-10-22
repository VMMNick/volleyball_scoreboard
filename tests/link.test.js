"use strict";

/* Посилання на матч без браузера: збереження, адреса другого судді, відлік без звʼязку, причини збою. */

const test = require("node:test");
const assert = require("node:assert/strict");
const { load, read } = require("./helpers/site");
const L = load("link.js");

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const KEY = "k".repeat(32);
const LINK = { server: "https://tablo.example", room: "ABC234", key: KEY, guest: false };

test("збереження: лише цілі посилання, зіпсоване — як немає", () => {
  const st = memStorage();
  assert.equal(L.load(st), null);
  L.save(st, LINK);
  assert.deepEqual(L.load(st), LINK);
  L.save(st, null);
  assert.equal(st.getItem(L.KEY), null);
  assert.equal(L.load(memStorage({ [L.KEY]: "{не json" })), null);
  assert.equal(L.load(memStorage({ [L.KEY]: JSON.stringify({ ...LINK, room: "ABC0O1" }) })), null, "код не з алфавіту");
  assert.equal(L.load(memStorage({ [L.KEY]: JSON.stringify({ ...LINK, key: "" }) })), null);
  assert.equal(L.load({ getItem: () => { throw new Error("приватний режим"); } }), null);
  assert.doesNotThrow(() => L.save({ setItem: () => { throw new Error("повне"); } }, LINK));
});

test("адреса сервера з того, що ввела людина", () => {
  assert.equal(L.normServer(" назва.onrender.com/ "), "https://назва.onrender.com");
  assert.equal(L.normServer("http://localhost:3000"), "http://localhost:3000");
  assert.equal(L.normServer(""), "");
  assert.equal(L.normServer("   "), "");
});

test("нове посилання й посилання другого судді з адреси", () => {
  const l = L.create("https://tablo.example");
  assert.equal(l.guest, false);
  assert.match(l.room, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(l.key, /^[\w-]{32}$/);
  assert.notEqual(L.create("x").key, l.key);

  const loc = { protocol: "https:", hostname: "tablo.example", origin: "https://tablo.example" };
  assert.deepEqual(L.fromUrl("?room=abc234&key=" + KEY, loc),
    { server: "https://tablo.example", room: "ABC234", key: KEY, guest: true }, "код без огляду на регістр, сервер — цей сайт");
  assert.equal(L.fromUrl("?room=abc234&key=" + KEY + "&server=інший.onrender.com", loc).server, "https://інший.onrender.com");
  assert.equal(L.fromUrl("?room=ABC234", loc), null, "без ключа — це не пульт судді");
  assert.equal(L.fromUrl("?key=" + KEY, loc), null);
  assert.equal(L.fromUrl("", loc), null);
});

test("адреси міні-табла й пульта судді; доказ власності в них не потрапляє", () => {
  const l = { ...LINK, proof: "1." + "P".repeat(43) };
  assert.equal(L.boardUrl(l, "&layout=bug"), "https://tablo.example/live.html?room=ABC234&layout=bug");
  assert.equal(L.judgeUrl(l), "https://tablo.example/index.html?room=ABC234&key=" + KEY);
  assert.equal((L.boardUrl(l) + L.judgeUrl(l)).includes("PPPP"), false);
  assert.equal(L.statusText("live", l), "на звʼязку · код ABC234");
  assert.equal(L.statusText("offline", { ...l, guest: true }), "немає звʼязку — перепідключаюсь · ви — другий суддя · код ABC234");
});

test("відлік без звʼязку: пояснюємо лише після LONG_MS, «на звʼязку» скидає відлік", () => {
  let now = 1000;
  const timers = [];
  let longs = 0;
  const t = L.lossTracker({ now: () => now, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
                            clearTimeout: () => {}, onLong: () => longs++ });
  t.track("connecting");
  assert.equal(t.lostAt, 1000);
  assert.equal(timers[0].ms, L.LONG_MS + 50);
  t.track("offline");
  assert.equal(t.lostAt, 1000, "повторний збій не перезапускає відлік");
  assert.equal(timers.length, 1);
  now += L.LONG_MS - 1;
  assert.equal(t.trouble("offline"), false, "ще рано");
  now += 1;
  assert.equal(t.trouble("offline"), true);
  timers[0].fn();
  assert.equal(longs, 1, "сторінка перемалюється саме тоді");
  assert.equal(t.trouble("live"), false);
  t.probe = "down";
  t.track("live");
  assert.equal(t.lostAt, 0);
  assert.equal(t.probe, "", "після звʼязку перевірку сервера забуваємо");
  t.track("rejected", "wrong-key");
  assert.equal(t.why, "wrong-key");
  assert.equal(t.trouble("rejected"), true, "відмова — одразу, без очікування");
  t.restart();
  assert.equal(t.lostAt, 0);
});

test("перевірка сервера: Web Service, лише статика, недоступний", async () => {
  const res = (ok, status, body) => () => Promise.resolve({ ok, status, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) });
  let asked = "";
  assert.equal(await L.probe((u) => { asked = u; return res(true, 200, { ok: true })(); }, "https://x.onrender.com/"), "ok");
  assert.equal(asked, "https://x.onrender.com/healthz");
  assert.equal(await L.probe(res(true, 200, new Error("не json")), "https://x"), "static", "сторінка замість JSON — статика");
  assert.equal(await L.probe(res(false, 404), "https://x"), "static");
  assert.equal(await L.probe(res(false, 502), "https://x"), "down");
  assert.equal(await L.probe(() => Promise.reject(new Error("мережа")), "https://x"), "down");
});

test("причини збою — від конкретних до загальних", () => {
  const loc = { protocol: "https:", host: "tablo.example", hostname: "tablo.example", origin: "https://tablo.example" };
  const base = { status: "offline", link: { ...LINK, server: "https://tablo.example" }, location: loc };
  const r = (patch) => L.reasons({ ...base, ...patch });
  assert.match(r({ status: "rejected", why: "wrong-key" })[0], /Ключ судді не підходить/);
  assert.match(r({ status: "rejected", why: "full" })[0], /перевантажений/);
  assert.match(r({ status: "rejected", why: "bad-room" })[0], /більше не дійсне/);
  assert.match(r({ onLine: false })[0], /не в інтернеті/);
  assert.match(r({ location: { protocol: "file:" } }).join(" "), /як файл/);
  assert.match(r({ link: { ...LINK, server: "https://old.example" } }).join(" "), /створене для сервера old\.example/);
  assert.match(r({ probe: "static" })[0], /лише статичні файли/, "статика — найперша причина");
  assert.match(r({ probe: "ok" }).slice(-1)[0], /WebSocket/);
  assert.match(r({ link: { ...LINK, server: "https://x.onrender.com" }, location: { ...loc, host: "x.onrender.com" } }).slice(-1)[0], /Render засинає/);
  assert.match(r({}).slice(-1)[0], /tablo\.example не відповідає/);
});

test("пульт підключає link.js після remote.js і перед pult.js; у pult.js не лишилось дублікатів", () => {
  const h = read("index.html");
  const i = (f) => h.indexOf('src="./js/' + f + '"');
  assert.ok(i("shared/remote.js") < i("shared/link.js") && i("shared/link.js") < i("pages/pult.js"));
  assert.match(read("sw.js"), /"\.\/js\/shared\/link\.js"/, "в офлайн-кеші");
  const pult = read("pult.js");
  ["function troubleReasons", "function normServer", "LINK_TEXT", "linkLostAt"].forEach((s) =>
    assert.equal(pult.includes(s), false, "у pult.js лишилось: " + s));
});
