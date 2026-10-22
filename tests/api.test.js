"use strict";

/* Акаунти: реєстрація судді, підтвердження адміном, вхід і вихід, захист. Справжній PostgreSQL (PGlite) і HTTP. */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server/server.js");
const { createApi } = require("../server/api.js");
const A = require("../server/auth.js");

let PGlite = true;
try { require.resolve("@electric-sql/pglite"); } catch (e) { PGlite = false; }
const suite = PGlite ? (name, fn) => test(name, { timeout: 30000 }, fn) : test.skip;

async function start(t, extra) {
  const { open } = require("../server/db.js");
  const db = await open({ pglite: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>пульт</title>");
  const api = createApi(Object.assign({ db }, extra || {}));
  await api.auth.ensureAdmin("Admin@Liga.ua", "admin-pass-1", "Адмін");
  const server = createServer({ root, api, pingMs: 60000, trustProxy: false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); await db.close(); });
  const port = server.address().port;

  /* Клієнт із власною «банкою» cookie — як окремий браузер. */
  function browser() {
    let cookie = "";
    return function call(method, p, body, headers) {
      return new Promise((resolve, reject) => {
        const data = body === undefined ? null : JSON.stringify(body);
        const h = Object.assign({}, data ? { "Content-Type": "application/json" } : {}, cookie ? { Cookie: cookie } : {}, headers || {});
        const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: h }, (res) => {
          let s = "";
          res.on("data", (c) => { s += c; });
          res.on("end", () => {
            const set = res.headers["set-cookie"];
            if (set) cookie = set[0].split(";")[0].endsWith("=") ? "" : set[0].split(";")[0];
            resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null, headers: res.headers });
          });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    };
  }
  return { db, api, browser, port };
}

test("паролі: scrypt із сіллю, перевірка за сталий час, зіпсований хеш — ні", () => {
  const h = A.hashPassword("секрет-123");
  assert.match(h, /^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.notEqual(A.hashPassword("секрет-123"), h, "сіль щоразу інша");
  assert.equal(A.verifyPassword("секрет-123", h), true);
  assert.equal(A.verifyPassword("секрет-124", h), false);
  assert.equal(A.verifyPassword("x", "зіпсований"), false);
  assert.equal(A.checkRegistration({ email: "a@b.ua", name: "Суддя", password: "1234567" }), "weak-password");
  assert.equal(A.checkRegistration({ email: "не-email", name: "Суддя", password: "12345678" }), "bad-email");
  assert.equal(A.checkRegistration({ email: "a@b.ua", name: " ", password: "12345678" }), "bad-name");
  assert.equal(A.checkRegistration({ email: "a@b.ua", name: "Суддя", password: "12345678" }), null);
  assert.match(A.sessionCookie("tok", true, 60), /^vs_session=tok; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=60$/);
  assert.deepEqual(A.parseCookies("a=1; vs_session=abc%3D"), { a: "1", vs_session: "abc=" });
});

suite("суддя реєструється → очікує → адмін підтверджує → вхід → вихід", async (t) => {
  const s = await start(t);
  const judge = s.browser(), admin = s.browser();

  assert.deepEqual((await judge("GET", "/api/config")).body, { accounts: true });
  assert.equal((await judge("GET", "/api/me")).status, 401);

  const reg = await judge("POST", "/api/register", { email: "  Suddia@Gmail.com ", name: "Іван Коваль", password: "volley-2026" });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.body, { status: "pending" });
  assert.equal((await judge("POST", "/api/register", { email: "suddia@gmail.com", name: "Інший", password: "volley-2026" })).status, 409, "email не повторюється (без огляду на регістр)");

  const early = await judge("POST", "/api/login", { email: "suddia@gmail.com", password: "volley-2026" });
  assert.equal(early.status, 403);
  assert.equal(early.body.error, "pending", "поки адмін не підтвердив — не пускаємо");

  // Адмін бачить заявку першою й підтверджує.
  assert.equal((await admin("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" })).status, 200);
  const me = await admin("GET", "/api/me");
  assert.equal(me.body.user.role, "admin");
  const list = (await admin("GET", "/api/admin/users")).body.users;
  assert.equal(list[0].email, "suddia@gmail.com");
  assert.equal(list[0].status, "pending");
  assert.equal("password_hash" in list[0], false, "хеш пароля назовні не віддаємо");
  const ok = await admin("POST", "/api/admin/users/" + list[0].id, { status: "active" });
  assert.equal(ok.body.user.status, "active");

  const login = await judge("POST", "/api/login", { email: "SUDDIA@gmail.com", password: "volley-2026" });
  assert.equal(login.status, 200);
  assert.match(login.headers["set-cookie"][0], /^vs_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  assert.equal((await judge("GET", "/api/me")).body.user.name, "Іван Коваль");
  assert.equal((await judge("GET", "/api/admin/users")).status, 403, "суддя — не адмін");

  // Заблокований — одразу без доступу, навіть із живою сесією.
  await admin("POST", "/api/admin/users/" + list[0].id, { status: "blocked" });
  assert.equal((await judge("GET", "/api/me")).status, 401);
  assert.equal((await judge("POST", "/api/login", { email: "suddia@gmail.com", password: "volley-2026" })).body.error, "blocked");

  await admin("POST", "/api/logout", {});
  assert.equal((await admin("GET", "/api/me")).status, 401, "після виходу сесії немає");
  const rows = (await s.db.query("select count(*)::int n from sessions")).rows[0].n;
  assert.equal(rows, 0, "сесії видалено з бази");
});

suite("неправильний пароль і чужий email — однакова відповідь; адміна не можна заблокувати", async (t) => {
  const s = await start(t);
  const b = s.browser();
  const a = await b("POST", "/api/login", { email: "admin@liga.ua", password: "wrong-pass" });
  const c = await b("POST", "/api/login", { email: "nobody@liga.ua", password: "wrong-pass" });
  assert.equal(a.status, 401); assert.equal(c.status, 401);
  assert.deepEqual(a.body, c.body);
  await b("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" });
  const adminId = (await b("GET", "/api/me")).body.user.id;
  assert.equal((await b("POST", "/api/admin/users/" + adminId, { status: "blocked" })).status, 404, "адміна статусом не чіпаємо");
  assert.equal((await b("POST", "/api/admin/users/999", { status: "bogus" })).status, 400);
});

suite("захист: інший сайт, не JSON, перебір паролів, завеликий запит", async (t) => {
  const s = await start(t, { limits: { loginPerWindow: 3, registerPerWindow: 2 } });
  const b = s.browser();
  const host = "127.0.0.1:" + s.port;
  assert.equal((await b("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" }, { Origin: "https://evil.example" })).status, 403, "інший сайт");
  assert.equal((await b("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" }, { Origin: "http://" + host })).status, 200, "свій сайт");
  const form = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, path: "/api/logout", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.end("a=1");
  });
  assert.equal(form, 403, "не JSON — як форма з чужого сайту — відмова");

  const x = s.browser();
  for (let i = 0; i < 3; i++) assert.equal((await x("POST", "/api/login", { email: "admin@liga.ua", password: "nope" })).status, 401);
  assert.equal((await x("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" })).status, 429, "після 3 невдалих — пауза навіть із правильним паролем");

  for (let i = 0; i < 2; i++) assert.equal((await x("POST", "/api/register", { email: "r" + i + "@b.ua", name: "С", password: "12345678" })).status, 201);
  assert.equal((await x("POST", "/api/register", { email: "r9@b.ua", name: "С", password: "12345678" })).status, 429);

  const big = await x("POST", "/api/register", { email: "big@b.ua", name: "x".repeat(20000), password: "12345678" }).catch(() => ({ status: "closed" }));
  assert.ok(big.status === 429 || big.status === 400 || big.status === "closed");
  assert.equal((await x("GET", "/api/nope")).status, 404);
});

test("без бази акаунти вимкнено, а табло працює", async (t) => {
  const server = createServer({ api: createApi({}), pingMs: 60000 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  const get = (p) => new Promise((resolve) => http.get({ host: "127.0.0.1", port: server.address().port, path: p }, (res) => {
    let s = ""; res.on("data", (c) => { s += c; }); res.on("end", () => resolve({ status: res.statusCode, body: s }));
  }));
  assert.deepEqual(JSON.parse((await get("/api/config")).body), { accounts: false });
  assert.equal((await get("/api/me")).status, 503);
  assert.equal((await get("/healthz")).status, 200);
});
