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
      ws.on("message", () => r({ ok: true, ws }));
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
