"use strict";

/* Сервер посилань на матч: кімнати, ключ судді, пересилання стану, статика. Справжні сокети на випадковому порту. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createServer } = require("../server/server.js");

let WebSocket;
try { WebSocket = require("ws"); } catch (e) { WebSocket = null; }
const suite = WebSocket ? (name, fn) => test(name, { timeout: 8000 }, fn) : test.skip;

const KEY = "k".repeat(24);
const OTHER = "z".repeat(24);
const STATE = JSON.stringify({ v: 1, names: ["Імідж", "Ліцей"], rules: {}, events: [{ type: "point", team: 0, ts: 1 }], undone: [] });

async function start(t, extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>пульт</title>");
  fs.writeFileSync(path.join(root, "live.html"), "<!doctype html><title>live</title>");
  fs.writeFileSync(path.join(root, "live.js"), "// live");
  const server = createServer(Object.assign({ root, pingMs: 60000, trustProxy: false }, extra || {}));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => {
    server.closeAllConnections();               // keep-alive з http.get інакше тримає close
    server.close(r);
  }));
  const port = server.address().port;
  return { server, port, url: (q) => "ws://127.0.0.1:" + port + "/ws?" + q };
}

/* Клієнт, що складає всі повідомлення в масив і вміє чекати потрібного. */
function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    inbox.push(m);
    waiters.slice().forEach((w) => { if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
  });
  const closed = new Promise((r) => ws.on("close", (code) => r(code)));
  return {
    ws, inbox, closed,
    open: () => new Promise((r, j) => { ws.once("open", r); ws.once("error", j); }),
    wait: (type, ms = 2000) => {
      const hit = inbox.find((m) => m.type === type);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { match: (m) => m.type === type, resolve: (m) => { inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        waiters.push(w);
        setTimeout(() => reject(new Error("не дочекались " + type)), ms);
      });
    },
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close()
  };
}

const get = (port, p) => new Promise((resolve) => {
  http.get({ host: "127.0.0.1", port, path: p }, (res) => {
    let body = "";
    res.on("data", (c) => { body += c; });
    res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
  });
});

suite("пульт передає стан глядачам, глядач отримує й пізніше", async (t) => {
  const s = await start(t);
  const ctl = client(s.url("room=ABC234&role=control&key=" + KEY));
  await ctl.open();
  await ctl.wait("hello");

  const v1 = client(s.url("room=ABC234"));
  await v1.open();
  assert.equal((await v1.wait("hello")).role, "viewer");

  ctl.send({ type: "state", match: STATE });
  assert.equal((await v1.wait("state")).match, STATE);

  ctl.send({ type: "prefs", prefs: { palette: "neon", sound: false, boardPct: 20, boardLogoOld: true, evil: "<script>" } });
  assert.deepEqual((await v1.wait("prefs")).prefs, { palette: "neon", sound: false, boardPct: 20, boardLogoOld: true }, "лише дозволені поля (і розмір міні-табла, емблеми)");

  const late = client(s.url("room=abc234"));      // регістр не важливий
  await late.open();
  assert.equal((await late.wait("state")).match, STATE, "той, хто прийшов пізніше, одразу бачить рахунок");
  assert.equal((await late.wait("prefs")).prefs.palette, "neon");

  ctl.send({ type: "timeout-end", ts: 5 });
  assert.equal((await v1.wait("timeout-end")).ts, 5);
  [ctl, v1, late].forEach((c) => c.close());
});

suite("чужий ключ і глядач не можуть змінити рахунок", async (t) => {
  const s = await start(t);
  const ctl = client(s.url("room=QWE234&role=control&key=" + KEY));
  await ctl.open();
  ctl.send({ type: "state", match: STATE });

  const thief = client(s.url("room=QWE234&role=control&key=" + OTHER));
  assert.equal(await thief.closed, 4003, "інший ключ — відмова");

  const v = client(s.url("room=QWE234"));
  await v.open();
  await v.wait("state");
  v.send({ type: "state", match: STATE.replace("Імідж", "Хакер") });
  const v2 = client(s.url("room=QWE234"));
  await v2.open();
  assert.match((await v2.wait("state")).match, /Імідж/, "глядач нічого не змінив");

  const again = client(s.url("room=QWE234&role=control&key=" + KEY));
  await again.open();
  assert.equal((await again.wait("hello")).role, "control", "той самий ключ — свій пульт (перепідключення)");
  [ctl, v, v2, again].forEach((c) => c.close());
});

suite("глядач, що прийшов раніше за пульт, дочекається рахунку", async (t) => {
  const s = await start(t);
  const v = client(s.url("room=EARLY2"));
  await v.open();
  await v.wait("hello");
  const ctl = client(s.url("room=EARLY2&role=control&key=" + KEY));
  await ctl.open();
  ctl.send({ type: "state", match: STATE });
  assert.equal((await v.wait("state")).match, STATE);
  const thief = client(s.url("room=EARLY2&role=control&key=" + OTHER));
  assert.equal(await thief.closed, 4003, "ключ закріпив перший пульт");
  [v, ctl].forEach((c) => c.close());
});

suite("неправильні кімнати, ключі й стан відкидаються", async (t) => {
  const s = await start(t);
  assert.equal(await client(s.url("room=abc")).closed, 4000, "короткий код");
  assert.equal(await client(s.url("room=ABC0O1")).closed, 4000, "0, O, 1 — не з алфавіту кімнат");
  assert.equal(await client(s.url("room=ABC234&role=control&key=short")).closed, 4001);

  const ctl = client(s.url("room=JUNK23&role=control&key=" + KEY));
  await ctl.open();
  ctl.send({ type: "state", match: "{не json" });
  ctl.send({ type: "state", match: JSON.stringify({ hello: 1 }) });
  const v = client(s.url("room=JUNK23"));
  await v.open();
  await v.wait("hello");
  await assert.rejects(v.wait("state", 300), "сміття не стало станом");
  [ctl, v].forEach((c) => c.close());
});

suite("статика, health і захист від ../", async (t) => {
  const s = await start(t);
  const live = await get(s.port, "/live.html");
  assert.equal(live.status, 200);
  assert.match(live.headers["content-type"], /text\/html/);
  assert.equal(live.headers["cache-control"], "no-cache");
  const js = await get(s.port, "/live.js");
  assert.equal(js.headers["cache-control"], "no-cache", "скрипти теж свіжі — інакше після деплою сторінка нова, а скрипт старий");
  assert.equal((await get(s.port, "/")).status, 200, "/ → index.html");
  assert.equal((await get(s.port, "/nope.js")).status, 404);
  assert.notEqual((await get(s.port, "/../server/server.js")).status, 200);
  assert.notEqual((await get(s.port, "/%2e%2e/server/server.js")).status, 200);
  const hz = await get(s.port, "/healthz");
  const h = JSON.parse(hz.body);
  assert.equal(h.ok, true);
  assert.equal(hz.headers["access-control-allow-origin"], "*", "пульт з GitHub Pages перевіряє сервер з іншого домену");
});

const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("не дочекались умови");
    await new Promise((r) => setTimeout(r, 10));
  }
};

suite("кімната, яку створив лише глядач, зникає, щойно він вийде", async (t) => {
  const s = await start(t);
  const v = client(s.url("room=GHOST2"));
  await v.open();
  await v.wait("hello");
  assert.equal(s.server.rooms.has("GHOST2"), true);
  v.close();
  await v.closed;
  await until(() => !s.server.rooms.has("GHOST2"));

  // А кімната з пультом лишається — глядачі, що прийдуть пізніше, одразу побачать рахунок.
  const ctl = client(s.url("room=OWNED2&role=control&key=" + KEY));
  await ctl.open();
  ctl.send({ type: "state", match: STATE });
  await ctl.wait("hello");
  ctl.close();
  await ctl.closed;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(s.server.rooms.has("OWNED2"), true, "кімната судді живе далі");
  const late = client(s.url("room=OWNED2"));
  await late.open();
  assert.equal((await late.wait("state")).match, STATE);
  late.close();
});

suite("відкрити-закрити сотні кімнат не забиває сервер", async (t) => {
  const s = await start(t, { limits: { newRoomsPerIp: 100000 } });
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = Array.from({ length: 300 }, (_, i) => "ZZZZ" + ABC[Math.floor(i / 32)] + ABC[i % 32]);
  assert.equal(new Set(codes).size, codes.length);
  for (let i = 0; i < codes.length; i += 50) {
    await Promise.all(codes.slice(i, i + 50).map(async (c) => {
      const v = client(s.url("room=" + c));
      await v.open();
      await v.wait("hello");
      v.close();
      await v.closed;
    }));
  }
  await until(() => s.server.rooms.size === 0);
});

suite("ліміти на одну адресу: зʼєднання й нові кімнати", async (t) => {
  const s = await start(t, { limits: { connPerIp: 3, newRoomsPerIp: 2 } });
  const a = client(s.url("room=LIMAA2"));
  const b = client(s.url("room=LIMBB2"));
  await a.open(); await a.wait("hello");
  await b.open(); await b.wait("hello");
  const c = client(s.url("room=LIMCC2"));
  assert.equal(await c.closed, 1013, "третя нова кімната за хвилину — «спробуйте пізніше»");

  const a2 = client(s.url("room=LIMAA2"));       // в існуючу кімнату — можна
  await a2.open(); await a2.wait("hello");
  const a3 = client(s.url("room=LIMAA2"));
  assert.equal(await a3.closed, 1013, "четверте зʼєднання з тієї ж адреси — «спробуйте пізніше»");

  a2.close();
  await a2.closed;
  await new Promise((r) => setTimeout(r, 50));
  const a4 = client(s.url("room=LIMAA2"));
  await a4.open();
  assert.equal((await a4.wait("hello")).role, "viewer", "місце звільнилось — знову пускаємо");
  [a, b, a4].forEach((x) => x.close());
});

suite("за проксі Render адресу беремо з останнього запису X-Forwarded-For", async (t) => {
  const s = await start(t, { trustProxy: true, limits: { connPerIp: 1 } });
  const open = (xff) => {
    const ws = new WebSocket(s.url("room=PROXY2"), { headers: { "X-Forwarded-For": xff } });
    return new Promise((r) => {
      ws.on("message", (d) => { if (JSON.parse(String(d)).type === "hello") r({ ok: true, ws }); });
      ws.on("close", (code) => r({ ok: false, code }));
    });
  };
  const first = await open("1.1.1.1, 10.0.0.1");
  assert.equal(first.ok, true);
  const spoof = await open("9.9.9.9, 10.0.0.1");
  assert.equal(spoof.code, 1013, "підроблений перший запис не обходить ліміт");
  const other = await open("10.0.0.2");
  assert.equal(other.ok, true, "інша справжня адреса — свій ліміт");
  first.ws.close(); other.ws.close();
});

suite("сервер не пропускає зіпсовану подію — табло глядачів не впаде", async (t) => {
  const s = await start(t);
  const ctl = client(s.url("room=BADEV2&role=control&key=" + KEY));
  await ctl.open();
  await ctl.wait("hello");
  ctl.send({ type: "state", match: STATE });
  const v = client(s.url("room=BADEV2"));
  await v.open();
  assert.equal((await v.wait("state")).match, STATE);
  const broken = JSON.parse(STATE);
  broken.events.push(null);
  ctl.send({ type: "state", match: JSON.stringify(broken) });
  broken.events = [{ type: "point", team: 7, ts: 2 }];
  ctl.send({ type: "state", match: JSON.stringify(broken) });
  await assert.rejects(v.wait("state", 300), "зіпсований стан глядачам не пішов");
  const late = client(s.url("room=BADEV2"));
  await late.open();
  assert.equal((await late.wait("state")).match, STATE, "у кімнаті лишився останній правильний стан");
  [ctl, v, late].forEach((c) => c.close());
});

/* ---------- доказ власності кімнати ---------- */

const SECRET = "s".repeat(64);
const Remote = require("./helpers/site").load("remote.js");

suite("пульт отримує доказ власності, глядач — ні", async (t) => {
  const s = await start(t, { secret: SECRET });
  const ctl = client(s.url("room=PRF234&role=control&key=" + KEY));
  await ctl.open();
  const hello = await ctl.wait("hello");
  assert.match(hello.proof, /^\d+\.[\w-]{43}$/);
  const v = client(s.url("room=PRF234"));
  await v.open();
  assert.equal("proof" in (await v.wait("hello")), false, "глядачу доказ не потрібен");
  const again = client(s.url("room=PRF234&role=control&key=" + KEY + "&proof=" + hello.proof));
  await again.open();
  assert.equal((await again.wait("hello")).proof, hello.proof, "доказ не змінюється від підключення до підключення");
  [ctl, v, again].forEach((c) => c.close());
});

suite("після рестарту сервера кімната повертається судді, самозванця відключено", async (t) => {
  const a = await start(t, { secret: SECRET });
  const ctl = client(a.url("room=BACK23&role=control&key=" + KEY));
  await ctl.open();
  const proof = (await ctl.wait("hello")).proof;
  ctl.close();
  await ctl.closed;

  // «Рестарт»: новий сервер із тим самим секретом і порожньою памʼяттю.
  const b = await start(t, { secret: SECRET });
  const thief = client(b.url("room=BACK23&role=control&key=" + OTHER));
  await thief.open();
  const thiefProof = (await thief.wait("hello")).proof;
  thief.send({ type: "state", match: STATE.replace("Імідж", "Хакер") });

  const v = client(b.url("room=BACK23"));
  await v.open();
  await v.wait("hello");
  assert.match((await v.wait("state")).match, /Хакер/, "поки судді немає, самозванець встиг показати своє");

  const owner = client(b.url("room=BACK23&role=control&key=" + KEY + "&proof=" + proof));
  await owner.open();
  assert.equal((await owner.wait("hello")).role, "control", "справжній суддя повернув кімнату");
  assert.equal(await thief.closed, 4003, "самозванця відключено");
  owner.send({ type: "state", match: STATE });
  assert.match((await v.wait("state")).match, /Імідж/);

  const back = client(b.url("room=BACK23&role=control&key=" + OTHER + "&proof=" + thiefProof));
  assert.equal(await back.closed, 4003, "новіший доказ самозванця не допомагає");
  const forged = client(b.url("room=BACK23&role=control&key=" + OTHER + "&proof=1." + "A".repeat(43)));
  assert.equal(await forged.closed, 4003, "підроблений «давній» доказ не проходить");
  [owner, v].forEach((c) => c.close());
});

suite("без того самого секрету доказ не діє — як і раніше, кімната за першим", async (t) => {
  const a = await start(t, { secret: SECRET });
  const ctl = client(a.url("room=NOSEC2&role=control&key=" + KEY));
  await ctl.open();
  const proof = (await ctl.wait("hello")).proof;
  ctl.close();
  const b = await start(t, { secret: "інший".repeat(10) });
  const first = client(b.url("room=NOSEC2&role=control&key=" + OTHER));
  await first.open();
  await first.wait("hello");
  const owner = client(b.url("room=NOSEC2&role=control&key=" + KEY + "&proof=" + proof));
  assert.equal(await owner.closed, 4003);
  first.close();
});

suite("Remote.connect зберігає доказ і показує його при перепідключенні", async (t) => {
  const s = await start(t, { secret: SECRET });
  const server = "http://127.0.0.1:" + s.port;
  const got = [];
  const statuses = [];
  const c1 = Remote.connect({ server, room: "RCON23", role: "control", key: KEY, WebSocket,
    onProof: (p) => got.push(p), onStatus: (st) => statuses.push(st) });
  await until(() => statuses.includes("live"));
  assert.equal(got.length, 1, "доказ прийшов у hello");
  c1.close();

  const urls = [];
  class Spy extends WebSocket { constructor(u) { super(u); urls.push(u); } }
  const st2 = [];
  const c2 = Remote.connect({ server, room: "RCON23", role: "control", key: KEY, proof: got[0], WebSocket: Spy,
    onProof: (p) => got.push(p), onStatus: (st) => st2.push(st) });
  await until(() => st2.includes("live"));
  assert.match(urls[0], new RegExp("&proof=" + encodeURIComponent(got[0]).replace(/[.]/g, "\\.") + "$"));
  assert.equal(got.length, 1, "той самий доказ — onProof удруге не кличемо");
  c2.close();
});

/* ---------- проксі хостингу губить коди закриття (Render: лише 1006 через ~20 с) ---------- */

suite("відмова приходить ще й звичайним повідомленням — до того, як закриється сокет", async (t) => {
  const s = await start(t);
  const bad = client(s.url("room=ABC0O1"));
  assert.equal(await bad.closed, 4000);
  assert.deepEqual(bad.inbox.map((m) => [m.type, m.code]), [["error", 4000]], "причина — в повідомленні");

  const ctl = client(s.url("room=REJ234&role=control&key=" + KEY));
  await ctl.open();
  await ctl.wait("hello");
  const thief = client(s.url("room=REJ234&role=control&key=" + OTHER));
  assert.equal(await thief.closed, 4003);
  assert.equal(thief.inbox.find((m) => m.type === "error").code, 4003);
  ctl.close();
});

suite("«bye» прибирає зʼєднання одразу, не чекаючи, чи дійде close", async (t) => {
  const s = await start(t);
  const v = client(s.url("room=BYE234"));
  await v.open();
  await v.wait("hello");
  assert.equal(s.server.rooms.has("BYE234"), true);
  v.send({ type: "bye" });
  await until(() => !s.server.rooms.has("BYE234"), 1000);
  await v.closed;
});

suite("Remote.connect: відмова з повідомлення — «rejected» без нескінченних спроб; close() каже «bye»", async (t) => {
  const s = await start(t);
  const server = "http://127.0.0.1:" + s.port;
  // Як на Render: коди закриття губляться — клієнт бачить лише 1006.
  class Lossy extends WebSocket {
    constructor(u) { super(u); this.addEventListener = this.addEventListener.bind(this); }
    set onclose(fn) { super.onclose = fn ? (e) => fn({ code: 1006 }) : null; }
    get onclose() { return super.onclose; }
  }
  const statuses = [];
  const opened = [];
  const later = (fn, ms) => { opened.push(ms); return setTimeout(fn, ms); };
  const c = Remote.connect({ server, room: "ABC0O1", role: "viewer", WebSocket: Lossy, setTimeout: later,
    onStatus: (st, info) => statuses.push(st + (info ? ":" + info : "")) });
  await until(() => statuses.some((x) => x.startsWith("rejected")));
  assert.ok(statuses.includes("rejected:bad-room"));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(opened, [], "повторних спроб немає");
  c.close();

  const st2 = [];
  const v = Remote.connect({ server, room: "BYE345", role: "viewer", WebSocket, onStatus: (x) => st2.push(x) });
  await until(() => st2.includes("live"));
  assert.equal(s.server.rooms.has("BYE345"), true);
  v.close();
  await until(() => !s.server.rooms.has("BYE345"), 1000);
});

/* ---------- два судді: сервер зливає стани, а не перезаписує ---------- */

const M = require("./helpers/site").load("match.js");

suite("сервер зливає стани двох пультів і повертає злите тому, хто чогось не бачив", async (t) => {
  const s = await start(t);
  const base = M.createMatch({ names: ["А", "Б"] });
  const hostM = M.addPoint(M.deserialize(M.serialize(base)), 0, base.created + 1);
  const judgeM = M.addPoint(M.deserialize(M.serialize(base)), 1, base.created + 2);

  const host = client(s.url("room=MRG234&role=control&key=" + KEY));
  await host.open(); await host.wait("hello");
  host.send({ type: "state", match: M.serialize(hostM) });
  const judge = client(s.url("room=MRG234&role=control&key=" + KEY));
  await judge.open(); await judge.wait("hello");
  assert.deepEqual(M.reduce(M.deserialize((await judge.wait("state")).match)).points, [1, 0]);

  judge.send({ type: "state", match: M.serialize(judgeM) });          // суддя рахував без звʼязку — 0:1
  const back = M.deserialize((await judge.wait("state")).match);
  assert.deepEqual(M.reduce(back).points, [1, 1], "суддя отримав злите");
  const toHost = M.deserialize((await host.wait("state")).match);
  assert.deepEqual(M.reduce(toHost).points, [1, 1], "і основний суддя теж");

  // Злите вже в обох: надсилання того самого не повертається відправнику (без пінг-понгу),
  // а інший пульт отримує той самий зміст — йому нема чого відповідати.
  judge.send({ type: "state", match: M.serialize(back) });
  await assert.rejects(judge.wait("state", 300), "відправнику нічого не повертається");
  const same = await host.wait("state");
  assert.equal(M.syncKey(M.deserialize(same.match)), M.syncKey(back));
  [host, judge].forEach((c) => c.close());
});

suite("старий пульт (стан без id) — як і раніше «діє останній», без подвоєння очок", async (t) => {
  const s = await start(t);
  const host = client(s.url("room=OLDV23&role=control&key=" + KEY));
  await host.open(); await host.wait("hello");
  host.send({ type: "state", match: M.serialize(M.addPoint(M.addPoint(M.createMatch(), 0, 1000), 0, 2000)) });
  const old = client(s.url("room=OLDV23&role=control&key=" + KEY));
  await old.open(); await old.wait("hello"); await old.wait("state");
  const legacy = JSON.stringify({ v: 1, names: ["А", "Б"], rules: {}, events: [{ type: "point", team: 0, ts: 1000 }], undone: [] });
  old.send({ type: "state", match: legacy });
  const got = await host.wait("state");
  assert.equal(got.match, legacy, "стан старого пульта йде далі як є");
  assert.deepEqual(M.reduce(M.deserialize(got.match)).points, [1, 0]);
  [host, old].forEach((c) => c.close());
});
