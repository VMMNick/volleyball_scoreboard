/*
 * Акаунти й сесії — без сторонніх бібліотек, лише node:crypto.
 *
 *  • паролі — scrypt із сіллю ("scrypt$N$r$p$сіль$хеш"), порівняння за сталий час;
 *  • сесія — випадковий токен у cookie (HttpOnly, SameSite=Lax, Secure за HTTPS),
 *    у базі — лише SHA-256 токена: витік бази не дає увійти;
 *  • ролі: суперадмін (один, із SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) → адміни → судді;
 *    КОРИСТУВАЧАМИ КЕРУЄ ЛИШЕ СУПЕРАДМІН: підтверджує, блокує, скидає паролі, призначає й знімає
 *    адмінів, видаляє, прибирає зайве; кожна його дія — у журналі. Адміни людьми не керують:
 *    їм делегуються інші можливості (створення окремих матчів-табло — етап А2);
 *  • судді реєструються самі зі статусом pending, адмін підтверджує (active) чи блокує;
 *  • пароль: свій — змінити, знаючи старий; забутий — одноразове посилання на 24 години від
 *    адміна; суперадмін — новий SUPERADMIN_PASSWORD у налаштуваннях сервера.
 * Права перевіряє can(actor, дія, ціль) — одне місце для всіх правил.
 * Адмін-панель відкривається лише суперадміну (requireSuperadmin в api.js).
 */
"use strict";

const crypto = require("crypto");

const COOKIE = "vs_session";
const RESET_HOURS = 24;
const ROLES = ["superadmin", "admin", "referee"];
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/* ---------- паролі ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, "base64url");
  let got;
  try {
    got = crypto.scryptSync(String(password), Buffer.from(salt, "base64url"), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  } catch (e) { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* Вимоги до даних реєстрації. Повертає текст помилки або null. */
function checkRegistration(b) {
  if (!b || typeof b !== "object") return "bad-request";
  if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim())) return "bad-email";
  if (typeof b.name !== "string" || !b.name.trim() || b.name.trim().length > 80) return "bad-name";
  if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200) return "weak-password";
  return null;
}

const normEmail = (e) => String(e || "").trim().toLowerCase();

/* ---------- cookie ---------- */

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(token, secure, maxAgeSec) {
  return COOKIE + "=" + (token || "") + "; Path=/; HttpOnly; SameSite=Lax" + (secure ? "; Secure" : "") +
    "; Max-Age=" + (token ? maxAgeSec : 0);
}

/* ---------- сесії й користувачі ---------- */

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
               createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined } : null;
}

const isAdmin = (u) => !!u && (u.role === "admin" || u.role === "superadmin");

/*
 * Хто що може з ким. Користувачами керує лише суперадмін — усім, крім себе (себе не видалити
 * й не заблокувати: інакше система лишилась би без власника). Адміни й судді — нічого.
 */
const USER_ACTIONS = ["list", "status", "reset", "role", "delete", "cleanup", "audit"];
function can(actor, action, target) {
  if (!actor || actor.role !== "superadmin" || actor.status === "blocked") return false;
  if (USER_ACTIONS.indexOf(action) < 0) return false;
  if (target && (target.id === actor.id || target.role === "superadmin")) return false;
  return true;
}

function createAuth(db) {
  async function createSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)",
      [sha256(token), userId, String(SESSION_DAYS)]);
    return token;
  }

  async function audit(actor, action, target, details) {
    await db.query("insert into audit_log (actor_id, actor, action, target, details) values ($1, $2, $3, $4, $5)",
      [actor ? actor.id : null, actor ? actor.email : null, action, target || null, details || null]);
  }

  async function byId(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    return (await db.query("select * from users where id = $1", [n])).rows[0] || null;
  }

  /* Користувач за cookie запиту (лише активний), або null. */
  async function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const r = await db.query(
      "select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()",
      [sha256(token)]);
    const u = r.rows[0];
    return u && u.status === "active" ? u : null;
  }

  async function destroySession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.query("delete from sessions where token_hash = $1", [sha256(token)]);
  }

  async function register(b) {
    const err = checkRegistration(b);
    if (err) return { error: err };
    try {
      const r = await db.query(
        "insert into users (email, name, password_hash) values ($1, $2, $3) returning *",
        [normEmail(b.email), b.name.trim(), hashPassword(b.password)]);
      return { user: r.rows[0] };
    } catch (e) {
      if (e.code === "23505") return { error: "email-taken" };
      throw e;
    }
  }

  /* Вхід: { user, token } або { error }. Неправильний email і пароль — та сама помилка. */
  async function login(email, password) {
    const r = await db.query("select * from users where email = $1", [normEmail(email)]);
    const u = r.rows[0];
    // Навіть без користувача рахуємо хеш — щоб за часом відповіді не вгадати, чи є такий email.
    const ok = verifyPassword(password, u ? u.password_hash : hashPassword("x"));
    if (!u || !ok) return { error: "bad-credentials" };
    if (u.status === "pending") return { error: "pending" };
    if (u.status === "blocked") return { error: "blocked" };
    return { user: u, token: await createSession(u.id) };
  }

  /*
   * Суперадмін із налаштувань сервера. Створюється при першому старті; пароль із налаштувань
   * застосовується лише тоді, коли його змінили в налаштуваннях (сервер памʼятає scrypt-хеш
   * застосованого) — тож пароль, змінений на сайті, не злітає при перезапуску, а забутий
   * відновлюється новим SUPERADMIN_PASSWORD. Суперадмін завжди один: якщо email у
   * налаштуваннях змінили, попередній стає звичайним адміном.
   */
  async function ensureSuperadmin(email, password, name) {
    if (!email || !password) return null;
    const e = normEmail(email);
    return db.tx(async (t) => {
      const seen = (await t.query("select value from settings where key = 'superadmin_env'")).rows[0];
      const envChanged = !seen || !verifyPassword(password + "\u0000" + e, seen.value);
      const existing = (await t.query("select * from users where email = $1", [e])).rows[0];
      await t.query("update users set role = 'admin' where role = 'superadmin' and email <> $1", [e]);
      let u;
      if (!existing) {
        u = (await t.query("insert into users (email, name, password_hash, role, status) values ($1, $2, $3, 'superadmin', 'active') returning *",
          [e, name || "Суперадмін", hashPassword(password)])).rows[0];
      } else {
        u = (await t.query("update users set role = 'superadmin', status = 'active'" + (envChanged ? ", password_hash = $2" : "") +
          " where id = $1 returning *", envChanged ? [existing.id, hashPassword(password)] : [existing.id])).rows[0];
        if (envChanged) await t.query("delete from sessions where user_id = $1", [u.id]);
      }
      if (envChanged) {
        await t.query("insert into settings (key, value) values ('superadmin_env', $1) on conflict (key) do update set value = excluded.value",
          [hashPassword(password + "\u0000" + e)]);
        await t.query("insert into audit_log (actor_id, action, target) values (null, 'superadmin-from-settings', $1)", [e]);
      }
      return u;
    });
  }

  async function listUsers(actor) {
    if (!can(actor, "list")) return null;
    const r = await db.query("select * from users order by (status = 'pending') desc, " +
      "case role when 'superadmin' then 0 when 'admin' then 1 else 2 end, created_at desc");
    return r.rows.map(publicUser);
  }

  /* Дія адміна над користувачем — з перевіркою прав. { user } або { error }. */
  async function guarded(actor, id, action) {
    const target = await byId(id);
    if (!target) return { error: "not-found" };
    if (!can(actor, action, target)) return { error: "forbidden" };
    return { target };
  }

  async function setStatus(actor, id, status) {
    if (!["active", "blocked", "pending"].includes(status)) return { error: "bad-status" };
    const g = await guarded(actor, id, "status");
    if (g.error) return g;
    const u = (await db.query("update users set status = $2 where id = $1 returning *", [g.target.id, status])).rows[0];
    if (status !== "active") await db.query("delete from sessions where user_id = $1", [u.id]);   // заблокований — одразу без доступу
    await audit(actor, "status:" + status, u.email);
    return { user: publicUser(u) };
  }

  async function setRole(actor, id, role) {
    if (role !== "admin" && role !== "referee") return { error: "bad-role" };
    const g = await guarded(actor, id, "role");
    if (g.error) return g;
    const u = (await db.query("update users set role = $2, status = case when $2 = 'admin' then 'active' else status end where id = $1 returning *",
      [g.target.id, role])).rows[0];
    await audit(actor, "role:" + role, u.email);
    return { user: publicUser(u) };
  }

  async function removeUser(actor, id) {
    const g = await guarded(actor, id, "delete");
    if (g.error) return g;
    await db.query("delete from users where id = $1", [g.target.id]);
    await audit(actor, "delete", g.target.email);
    return { ok: true };
  }

  /* Прибрати зайве: заблокованих і (або) заявки, що чекають довше за staleDays. */
  async function cleanup(actor, what, staleDays) {
    if (!can(actor, "cleanup")) return { error: "forbidden" };
    if (what !== "blocked" && what !== "stale-pending") return { error: "bad-request" };
    const r = what === "blocked"
      ? await db.query("delete from users where status = 'blocked' and role = 'referee' returning email")
      : await db.query("delete from users where status = 'pending' and role = 'referee' and created_at < now() - ($1 || ' days')::interval returning email",
          [String(staleDays || 30)]);
    const expired = await db.query("delete from sessions where expires_at < now() returning token_hash");
    await db.query("delete from password_resets where expires_at < now() or used_at is not null");
    await audit(actor, "cleanup:" + what, null, r.rows.length + " видалено");
    return { removed: r.rows.length, sessions: expired.rows.length };
  }

  async function auditLog(actor, limit) {
    if (!can(actor, "audit")) return { error: "forbidden" };
    const r = await db.query(
      "select at, action, target, details, actor from audit_log order by at desc, id desc limit $1", [Math.min(Number(limit) || 50, 200)]);
    return { entries: r.rows.map((e) => ({ at: new Date(e.at).toISOString(), actor: e.actor || null, action: e.action,
                                            target: e.target, details: e.details })) };
  }

  /* Посилання для скидання пароля: токен лише в посиланні, у базі — його хеш. */
  async function createReset(actor, id) {
    const g = await guarded(actor, id, "reset");
    if (g.error) return g;
    const token = crypto.randomBytes(32).toString("base64url");
    await db.query("delete from password_resets where user_id = $1 and used_at is null", [g.target.id]);   // діє лише останнє
    await db.query("insert into password_resets (token_hash, user_id, created_by, expires_at) values ($1, $2, $3, now() + ($4 || ' hours')::interval)",
      [sha256(token), g.target.id, actor.id, String(RESET_HOURS)]);
    await audit(actor, "reset-link", g.target.email);
    return { token, hours: RESET_HOURS, user: publicUser(g.target) };
  }

  /* Новий пароль за посиланням. Усі сесії користувача закриваються. */
  async function useReset(token, password) {
    if (typeof password !== "string" || password.length < 8 || password.length > 200) return { error: "weak-password" };
    if (typeof token !== "string" || token.length > 100) return { error: "bad-reset" };
    return db.tx(async (t) => {
      const r = (await t.query("select * from password_resets where token_hash = $1 and used_at is null and expires_at > now() for update",
        [sha256(token)])).rows[0];
      if (!r) return { error: "bad-reset" };
      await t.query("update password_resets set used_at = now() where token_hash = $1", [r.token_hash]);
      const u = (await t.query("update users set password_hash = $2 where id = $1 returning *", [r.user_id, hashPassword(password)])).rows[0];
      await t.query("delete from sessions where user_id = $1", [r.user_id]);
      await t.query("insert into audit_log (actor_id, actor, action, target) values ($1, $2, 'reset-used', $2)", [u.id, u.email]);
      return { user: publicUser(u) };
    });
  }

  /* Змінити свій пароль, знаючи старий. Інші сесії закриваються, поточна лишається. */
  async function changePassword(user, oldPassword, newPassword, keepTokenHash) {
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 200) return { error: "weak-password" };
    if (!verifyPassword(oldPassword, user.password_hash)) return { error: "bad-old-password" };
    await db.query("update users set password_hash = $2 where id = $1", [user.id, hashPassword(newPassword)]);
    await db.query("delete from sessions where user_id = $1 and token_hash <> $2", [user.id, keepTokenHash || ""]);
    await audit(user, "password-changed", user.email);
    return { ok: true };
  }

  /* Хеш токена поточної сесії — щоб, змінюючи пароль, не викинути самого себе. */
  function sessionHash(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return token ? sha256(token) : "";
  }

  return { createSession, userFromRequest, destroySession, register, login, ensureSuperadmin, listUsers,
           setStatus, setRole, removeUser, cleanup, auditLog, createReset, useReset, changePassword, sessionHash };
}

module.exports = { createAuth, hashPassword, verifyPassword, checkRegistration, parseCookies, sessionCookie,
                   publicUser, can, isAdmin, ROLES, COOKIE, SESSION_DAYS, RESET_HOURS };
