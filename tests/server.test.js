"use strict";

/* Сервер посилань на матч: кімнати, ключ судді, пересилання стану, статика. Справжні сокети на випадковому порту. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createServer } = require("../server.js");

let WebSocket;
try { WebSocket = require("ws"); } catch (e) { WebSocket = null; }
const suite = WebSocket ? (name, fn) => test(name, { timeout: 8000 }, fn) : test.skip;

const KEY = "k".repeat(24);
const OTHER = "z".repeat(24);
const STATE = JSON.stringify({ v: 1, names: ["Імідж", "Ліцей"], rules: {}, events: [{ type: "point", team: 0, ts: 1 }], undone: [] });

async function start(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>пульт</title>");
  fs.writeFileSync(path.join(root, "live.html"), "<!doctype html><title>live</title>");
  fs.writeFileSync(path.join(root, "live.js"), "// live");
  const server = createServer({ root, pingMs: 60000 });
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

  ctl.send({ type: "prefs", prefs: { palette: "neon", sound: false, boardWidth: 220, evil: "<script>" } });
  assert.deepEqual((await v1.wait("prefs")).prefs, { palette: "neon", sound: false, boardWidth: 220 }, "лише дозволені поля (і розмір міні-табла)");

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
  assert.notEqual((await get(s.port, "/../server.js")).status, 200);
  assert.notEqual((await get(s.port, "/%2e%2e/server.js")).status, 200);
  const h = JSON.parse((await get(s.port, "/healthz")).body);
  assert.equal(h.ok, true);
});
