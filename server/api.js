/*
 * HTTP API акаунтів: /api/…  (JSON туди й назад).
 *
 *   GET  /api/config              { accounts: true|false } — чи увімкнені акаунти на цьому сервері
 *   GET  /api/me                  поточний користувач (401 — не ввійшли)
 *   POST /api/register            { email, name, password } → суддя зі статусом «очікує»
 *   POST /api/login               { email, password } → cookie сесії
 *   POST /api/logout
 *   POST /api/me/password         { old, password } — змінити свій пароль
 *   POST /api/reset               { token, password } — новий пароль за посиланням від адміна
 *
 * Керування користувачами — ЛИШЕ суперадмін (адміни й судді отримують 403):
 *   GET    /api/admin/users              усі користувачі, спершу ті, що очікують
 *   POST   /api/admin/users/:id          { status: "active" | "blocked" | "pending" }
 *   POST   /api/admin/users/:id/reset    → { url } — одноразове посилання на 24 години
 *   POST   /api/admin/users/:id/role     { role: "admin" | "referee" }
 *   DELETE /api/admin/users/:id          видалити користувача
 *   POST   /api/admin/cleanup            { what: "blocked" | "stale-pending" }
 *   GET    /api/admin/audit              журнал дій
 *
 * Хто що може з ким — server/auth.js (can).
 *
 * Захист: змінювати дані можна лише JSON-запитом із того самого сайту (Origin = Host) —
 * інший сайт не зробить це від імені судді; ліміти спроб входу й реєстрації на IP;
 * відповіді не кешуються. Без бази (DATABASE_URL не задано) — 503 «accounts-disabled»,
 * а табло працює, як і раніше.
 */
"use strict";

const A = require("./auth.js");

const MAX_BODY = 16 * 1024;

function createApi(opts) {
  opts = opts || {};
  const db = opts.db || null;
  const auth = db ? A.createAuth(db) : null;
  const log = opts.log || (() => {});
  const api = {};
  const clientIp = (req) => (api.clientIp || opts.clientIp || ((r) => r.socket.remoteAddress || "?"))(req);
  const trustProxy = !!opts.trustProxy;
  const limits = Object.assign({ loginPerWindow: 10, registerPerWindow: 5, windowMs: 10 * 60 * 1000 }, opts.limits || {});
  const attempts = new Map();   // "login:ip" → [час, …]

  function tooMany(kind, ip, max) {
    const key = kind + ":" + ip, now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < limits.windowMs);
    attempts.set(key, list);
    return list.length >= max;
  }
  function note(kind, ip) { const key = kind + ":" + ip; (attempts.get(key) || attempts.set(key, []).get(key)).push(Date.now()); }

  function json(res, status, body, headers) {
    res.writeHead(status, Object.assign({
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    }, headers || {}));
    res.end(JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); resolve(undefined); } else chunks.push(c); });
      req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { resolve(undefined); } });
      req.on("error", () => resolve(undefined));
    });
  }

  /* Запит, що змінює дані, — лише JSON і лише з цього ж сайту. */
  function sameSite(req) {
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return false;
    const origin = req.headers.origin;
    if (!origin) return true;                                   // не браузер (curl, тести) — cookie сайту в нього немає
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
  }

  const secure = (req) => !!req.socket.encrypted || (trustProxy && /^https/i.test(req.headers["x-forwarded-proto"] || ""));
  const sessionMax = A.SESSION_DAYS * 24 * 3600;

  /* true — запит оброблено (це /api/…). */
  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    const route = req.method + " " + url.pathname;
    try {
      if (route === "GET /api/config") { json(res, 200, { accounts: !!db }); return true; }
      if (!db) { json(res, 503, { error: "accounts-disabled" }); return true; }
      if (req.method !== "GET" && !sameSite(req)) { json(res, 403, { error: "cross-site" }); return true; }
      const ip = clientIp(req);

      if (route === "GET /api/me") {
        const u = await auth.userFromRequest(req);
        json(res, u ? 200 : 401, u ? { user: A.publicUser(u) } : { error: "unauthorized" });
        return true;
      }
      if (route === "POST /api/register") {
        if (tooMany("register", ip, limits.registerPerWindow)) { json(res, 429, { error: "too-many" }); return true; }
        const r = await auth.register(await readJson(req));
        if (r.error) { json(res, r.error === "email-taken" ? 409 : 400, { error: r.error }); return true; }
        note("register", ip);
        log("новий суддя очікує підтвердження: " + r.user.email);
        json(res, 201, { status: "pending" });
        return true;
      }
      if (route === "POST /api/login") {
        if (tooMany("login", ip, limits.loginPerWindow)) { json(res, 429, { error: "too-many" }); return true; }
        const b = (await readJson(req)) || {};
        const r = await auth.login(b.email, b.password);
        if (r.error) {
          if (r.error === "bad-credentials") note("login", ip);   // лише невдалі спроби
          json(res, r.error === "bad-credentials" ? 401 : 403, { error: r.error });
          return true;
        }
        json(res, 200, { user: A.publicUser(r.user) }, { "Set-Cookie": A.sessionCookie(r.token, secure(req), sessionMax) });
        return true;
      }
      if (route === "POST /api/reset") {
        if (tooMany("reset", ip, limits.loginPerWindow)) { json(res, 429, { error: "too-many" }); return true; }
        const b = (await readJson(req)) || {};
        const r = await auth.useReset(b.token, b.password);
        if (r.error) { if (r.error === "bad-reset") note("reset", ip); json(res, 400, { error: r.error }); return true; }
        log("пароль скинуто за посиланням: " + r.user.email);
        json(res, 200, { ok: true });
        return true;
      }
      if (route === "POST /api/me/password") {
        const u = await auth.userFromRequest(req);
        if (!u) { json(res, 401, { error: "unauthorized" }); return true; }
        if (tooMany("password", u.id, limits.loginPerWindow)) { json(res, 429, { error: "too-many" }); return true; }
        const b = (await readJson(req)) || {};
        const r = await auth.changePassword(u, b.old, b.password, auth.sessionHash(req));
        if (r.error) { if (r.error === "bad-old-password") note("password", u.id); json(res, 400, { error: r.error }); return true; }
        json(res, 200, { ok: true });
        return true;
      }
      if (route === "POST /api/logout") {
        await auth.destroySession(req);
        json(res, 200, { ok: true }, { "Set-Cookie": A.sessionCookie("", secure(req), 0) });
        return true;
      }

      // ---- далі лише для адміна ----
      if (url.pathname.startsWith("/api/admin/")) {
        const u = await auth.userFromRequest(req);
        if (!u) { json(res, 401, { error: "unauthorized" }); return true; }
        if (u.role !== "superadmin") { json(res, 403, { error: "forbidden" }); return true; }   // людьми керує лише суперадмін
        const fail = (r) => json(res, r.error === "not-found" ? 404 : r.error === "forbidden" ? 403 : 400, { error: r.error });
        if (route === "GET /api/admin/users") { json(res, 200, { users: await auth.listUsers(u), me: A.publicUser(u) }); return true; }
        if (route === "GET /api/admin/audit") {
          const r = await auth.auditLog(u, url.searchParams.get("limit"));
          if (r.error) fail(r); else json(res, 200, r);
          return true;
        }
        if (route === "POST /api/admin/cleanup") {
          const b = (await readJson(req)) || {};
          const r = await auth.cleanup(u, b.what, b.days);
          if (r.error) fail(r); else { log("прибирання (" + b.what + "): " + r.removed); json(res, 200, r); }
          return true;
        }
        const m = /^\/api\/admin\/users\/(\d+)(?:\/(reset|role))?$/.exec(url.pathname);
        if (m) {
          const b = req.method === "POST" || req.method === "DELETE" ? (await readJson(req)) || {} : {};
          let r = null;
          if (req.method === "POST" && !m[2]) r = await auth.setStatus(u, m[1], b.status);
          else if (req.method === "POST" && m[2] === "role") r = await auth.setRole(u, m[1], b.role);
          else if (req.method === "POST" && m[2] === "reset") {
            r = await auth.createReset(u, m[1]);
            // Токен — лише в частині після «#»: вона не йде на сервер і в журнали проксі.
            if (!r.error) r = { url: "/account.html#reset=" + r.token, hours: r.hours, user: r.user };
          } else if (req.method === "DELETE" && !m[2]) r = await auth.removeUser(u, m[1]);
          if (r) {
            if (r.error) fail(r);
            else { log("адмін " + u.email + ": " + req.method + " " + url.pathname); json(res, 200, r); }
            return true;
          }
        }
      }
      json(res, 404, { error: "not-found" });
    } catch (e) {
      log("api: " + (e && e.message));
      json(res, 500, { error: "server-error" });
    }
    return true;
  }

  api.handle = handle;
  api.auth = auth;
  return api;
}

module.exports = { createApi };
