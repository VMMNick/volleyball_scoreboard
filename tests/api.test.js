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
  await api.auth.ensureSuperadmin("Admin@Liga.ua", "admin-pass-1", "Суперадмін");
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
        const h = Object.assign({}, data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
          cookie ? { Cookie: cookie } : {}, headers || {});
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
  assert.equal(me.body.user.role, "superadmin");
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

suite("неправильний пароль і чужий email — однакова відповідь; себе не заблокувати", async (t) => {
  const s = await start(t);
  const b = s.browser();
  const a = await b("POST", "/api/login", { email: "admin@liga.ua", password: "wrong-pass" });
  const c = await b("POST", "/api/login", { email: "nobody@liga.ua", password: "wrong-pass" });
  assert.equal(a.status, 401); assert.equal(c.status, 401);
  assert.deepEqual(a.body, c.body);
  await b("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" });
  const adminId = (await b("GET", "/api/me")).body.user.id;
  assert.equal((await b("POST", "/api/admin/users/" + adminId, { status: "blocked" })).status, 403, "себе не заблокувати");
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


/* ---------- ролі: суперадмін, адміни, судді ---------- */

async function signedIn(s, email, password) {
  const b = s.browser();
  const r = await b("POST", "/api/login", { email, password });
  assert.equal(r.status, 200, "вхід " + email + ": " + JSON.stringify(r.body));
  return b;
}
async function referee(s, email, status) {
  const b = s.browser();
  await b("POST", "/api/register", { email, name: email.split("@")[0], password: "referee-pass" });
  const id = (await s.db.query("select id from users where email = $1", [email])).rows[0].id;
  if (status) await s.db.query("update users set status = $2 where id = $1", [id, status]);
  return id;
}

test("права: can() — користувачами керує лише суперадмін, і не собою", () => {
  const sup = { id: 1, role: "superadmin", status: "active" }, adm = { id: 2, role: "admin", status: "active" };
  const adm2 = { id: 3, role: "admin" }, ref = { id: 4, role: "referee" };
  ["status", "reset", "role", "delete"].forEach((a) => {
    assert.equal(A.can(sup, a, ref), true, "суперадмін: " + a + " судді");
    assert.equal(A.can(sup, a, adm2), true, "суперадмін: " + a + " адміна");
    assert.equal(A.can(sup, a, sup), false, "суперадмін: " + a + " себе — ні");
    assert.equal(A.can(adm, a, ref), false, "адмін: " + a + " — ні");
  });
  ["list", "cleanup", "audit"].forEach((a) => {
    assert.equal(A.can(sup, a), true);
    assert.equal(A.can(adm, a), false);
    assert.equal(A.can(ref, a), false);
  });
  assert.equal(A.can(sup, "щось-інше", ref), false, "невідома дія — ні");
});

suite("суперадмін — єдиний, хто керує людьми: адмін не бачить і не змінює користувачів", async (t) => {
  const s = await start(t);
  const sup = await signedIn(s, "admin@liga.ua", "admin-pass-1");
  const annaId = await referee(s, "anna@liga.ua", "active");
  const petroId = await referee(s, "petro@liga.ua");                         // очікує
  const olgaId = await referee(s, "olga@liga.ua", "active");

  const promo = await sup("POST", "/api/admin/users/" + annaId + "/role", { role: "admin" });
  assert.equal(promo.body.user.role, "admin");
  const anna = await signedIn(s, "anna@liga.ua", "referee-pass");
  assert.equal((await anna("GET", "/api/me")).body.user.role, "admin");

  // Адмін людьми не керує — жодна дія з користувачами.
  const supId = (await sup("GET", "/api/me")).body.user.id;
  const denied = [
    ["GET", "/api/admin/users"], ["POST", "/api/admin/users/" + petroId, { status: "active" }],
    ["POST", "/api/admin/users/" + olgaId + "/reset", {}], ["POST", "/api/admin/users/" + petroId + "/role", { role: "admin" }],
    ["DELETE", "/api/admin/users/" + petroId, {}], ["GET", "/api/admin/audit"], ["POST", "/api/admin/cleanup", { what: "blocked" }],
    ["POST", "/api/admin/users/" + supId, { status: "blocked" }]
  ];
  for (const [m, p, b] of denied) assert.equal((await anna(m, p, b)).status, 403, "адмін: " + m + " " + p);
  assert.equal((await s.db.query("select status from users where id = $1", [petroId])).rows[0].status, "pending", "нічого не змінилось");

  // Суперадмін бачить усіх і робить усе.
  const all = (await sup("GET", "/api/admin/users")).body.users;
  assert.equal(all.length, 4);
  assert.equal(all[0].email, "petro@liga.ua", "спершу ті, що очікують");
  assert.deepEqual(all.slice(1).map((u) => u.role), ["superadmin", "admin", "referee"]);
  assert.equal((await sup("POST", "/api/admin/users/" + petroId, { status: "active" })).status, 200);
  const reset = await sup("POST", "/api/admin/users/" + olgaId + "/reset", {});
  assert.match(reset.body.url, /^\/account\.html#reset=[\w-]{43}$/);
  assert.equal(reset.body.hours, 24);

  // «Щось не так» — знімає адміна (одразу без прав) і видаляє.
  await sup("POST", "/api/admin/users/" + annaId + "/role", { role: "referee" });
  assert.equal((await anna("GET", "/api/me")).body.user.role, "referee");
  assert.equal((await sup("DELETE", "/api/admin/users/" + annaId, {})).status, 200);
  assert.equal((await anna("GET", "/api/me")).status, 401, "видалений — без сесії");
  assert.equal((await sup("DELETE", "/api/admin/users/" + supId, {})).status, 403, "себе не видалити");
  assert.equal((await sup("DELETE", "/api/admin/users/99999", {})).status, 404);
  assert.equal((await sup("POST", "/api/admin/users/" + petroId + "/role", { role: "superadmin" })).status, 400, "другого суперадміна не буває");

  const log = (await sup("GET", "/api/admin/audit")).body.entries;
  assert.deepEqual(log.slice(0, 3).map((e) => [e.action, e.target]),
    [["delete", "anna@liga.ua"], ["role:referee", "anna@liga.ua"], ["reset-link", "olga@liga.ua"]]);
  assert.ok(log.every((e) => e.actor === "admin@liga.ua" || (e.actor === null && e.action === "superadmin-from-settings")),
    "усі зміни — від суперадміна (і запис сервера про суперадміна з налаштувань)");
});

suite("скидання пароля: одноразове посилання на 24 години, старі сесії закриваються", async (t) => {
  const s = await start(t);
  const sup = await signedIn(s, "admin@liga.ua", "admin-pass-1");
  const id = await referee(s, "ivan@liga.ua", "active");
  const ivan = await signedIn(s, "ivan@liga.ua", "referee-pass");
  const first = (await sup("POST", "/api/admin/users/" + id + "/reset", {})).body.url;
  const link = (await sup("POST", "/api/admin/users/" + id + "/reset", {})).body.url;
  const token = (u) => u.split("#reset=")[1];
  const anon = s.browser();
  assert.equal((await anon("POST", "/api/reset", { token: token(first), password: "new-pass-1" })).body.error, "bad-reset", "діє лише останнє посилання");
  assert.equal((await anon("POST", "/api/reset", { token: token(link), password: "short" })).body.error, "weak-password");
  assert.equal((await anon("POST", "/api/reset", { token: token(link), password: "new-pass-1" })).status, 200);
  assert.equal((await anon("POST", "/api/reset", { token: token(link), password: "new-pass-2" })).body.error, "bad-reset", "одноразове");
  assert.equal((await ivan("GET", "/api/me")).status, 401, "стара сесія закрита");
  assert.equal((await s.browser()("POST", "/api/login", { email: "ivan@liga.ua", password: "referee-pass" })).status, 401, "старий пароль не діє");
  await signedIn(s, "ivan@liga.ua", "new-pass-1");

  // Прострочене посилання.
  const late = (await sup("POST", "/api/admin/users/" + id + "/reset", {})).body.url;
  await s.db.query("update password_resets set expires_at = now() - interval '1 minute'");
  assert.equal((await anon("POST", "/api/reset", { token: token(late), password: "new-pass-3" })).body.error, "bad-reset");
  const supId = (await sup("GET", "/api/me")).body.user.id;
  assert.equal((await sup("POST", "/api/admin/users/" + supId + "/reset", {})).status, 403, "суперадмін відновлюється через налаштування сервера");
});

suite("свій пароль: старий → новий, інші сесії закриваються, поточна лишається", async (t) => {
  const s = await start(t);
  await referee(s, "olena@liga.ua", "active");
  const phone = await signedIn(s, "olena@liga.ua", "referee-pass");
  const laptop = await signedIn(s, "olena@liga.ua", "referee-pass");
  assert.equal((await phone("POST", "/api/me/password", { old: "wrong", password: "brand-new-1" })).body.error, "bad-old-password");
  assert.equal((await phone("POST", "/api/me/password", { old: "referee-pass", password: "short" })).body.error, "weak-password");
  assert.equal((await phone("POST", "/api/me/password", { old: "referee-pass", password: "brand-new-1" })).status, 200);
  assert.equal((await phone("GET", "/api/me")).status, 200, "на цьому пристрої — далі в акаунті");
  assert.equal((await laptop("GET", "/api/me")).status, 401, "на іншому — треба ввійти знову");
  await signedIn(s, "olena@liga.ua", "brand-new-1");
  assert.equal((await s.browser()("POST", "/api/me/password", { old: "a", password: "b" })).status, 401);
});

suite("суперадмін із налаштувань: змінений на сайті пароль не злітає при перезапуску; новий у налаштуваннях — відновлення", async (t) => {
  const s = await start(t);
  const sup = await signedIn(s, "admin@liga.ua", "admin-pass-1");
  await sup("POST", "/api/me/password", { old: "admin-pass-1", password: "changed-on-site" });
  await s.api.auth.ensureSuperadmin("Admin@Liga.ua", "admin-pass-1", "Суперадмін");          // «перезапуск» із тими самими налаштуваннями
  assert.equal((await sup("GET", "/api/me")).status, 200, "сесія жива");
  await signedIn(s, "admin@liga.ua", "changed-on-site");
  assert.equal((await s.browser()("POST", "/api/login", { email: "admin@liga.ua", password: "admin-pass-1" })).status, 401);

  await s.api.auth.ensureSuperadmin("admin@liga.ua", "recovered-pass", "Суперадмін");          // забув — новий пароль у налаштуваннях
  assert.equal((await sup("GET", "/api/me")).status, 401, "після відновлення старі сесії закриті");
  await signedIn(s, "admin@liga.ua", "recovered-pass");

  await s.api.auth.ensureSuperadmin("new-boss@liga.ua", "boss-pass-1", "Новий");               // змінили email суперадміна
  const roles = (await s.db.query("select email, role from users order by id")).rows;
  assert.deepEqual(roles, [{ email: "admin@liga.ua", role: "admin" }, { email: "new-boss@liga.ua", role: "superadmin" }], "суперадмін завжди один");
});

suite("прибирання: заблоковані судді й старі заявки; журнал", async (t) => {
  const s = await start(t);
  const sup = await signedIn(s, "admin@liga.ua", "admin-pass-1");
  await referee(s, "bad1@liga.ua", "blocked");
  await referee(s, "bad2@liga.ua", "blocked");
  const oldId = await referee(s, "old@liga.ua");
  await referee(s, "fresh@liga.ua");
  await referee(s, "ok@liga.ua", "active");
  await s.db.query("update users set created_at = now() - interval '45 days' where id = $1", [oldId]);
  assert.equal((await sup("POST", "/api/admin/cleanup", { what: "nonsense" })).status, 400);
  assert.equal((await sup("POST", "/api/admin/cleanup", { what: "blocked" })).body.removed, 2);
  assert.equal((await sup("POST", "/api/admin/cleanup", { what: "stale-pending" })).body.removed, 1, "лише заявки старші за 30 днів");
  const left = (await s.db.query("select email from users order by email")).rows.map((r) => r.email);
  assert.deepEqual(left, ["admin@liga.ua", "fresh@liga.ua", "ok@liga.ua"]);
  const log = (await sup("GET", "/api/admin/audit")).body.entries;
  assert.equal(log[0].action, "cleanup:stale-pending");
  assert.equal(log[0].details, "1 видалено");
});
