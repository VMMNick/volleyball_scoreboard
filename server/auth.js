/*
 * Акаунти й сесії — без сторонніх бібліотек, лише node:crypto.
 *
 *  • паролі — scrypt із сіллю ("scrypt$N$r$p$сіль$хеш"), порівняння за сталий час;
 *  • сесія — випадковий токен у cookie (HttpOnly, SameSite=Lax, Secure за HTTPS),
 *    у базі — лише SHA-256 токена: витік бази не дає увійти;
 *  • перший і єдиний адмін — з ADMIN_EMAIL / ADMIN_PASSWORD при старті сервера;
 *  • судді реєструються самі зі статусом pending, адмін підтверджує (active) чи блокує.
 */
"use strict";

const crypto = require("crypto");

const COOKIE = "vs_session";
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
  return u ? { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status } : null;
}

function createAuth(db) {
  async function createSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)",
      [sha256(token), userId, String(SESSION_DAYS)]);
    return token;
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

  /* Адмін із ADMIN_EMAIL / ADMIN_PASSWORD: створює або оновлює (пароль — завжди з налаштувань). */
  async function ensureAdmin(email, password, name) {
    if (!email || !password) return null;
    const e = normEmail(email);
    const r = await db.query(
      "insert into users (email, name, password_hash, role, status) values ($1, $2, $3, 'admin', 'active') " +
      "on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', status = 'active' returning *",
      [e, name || "Адмін", hashPassword(password)]);
    return r.rows[0];
  }

  async function listUsers() {
    const r = await db.query("select * from users order by (status = 'pending') desc, created_at desc");
    return r.rows.map(publicUser);
  }

  /* Адмін змінює статус судді. Адміна не чіпаємо. */
  async function setStatus(id, status) {
    if (!["active", "blocked", "pending"].includes(status)) return { error: "bad-status" };
    const r = await db.query("update users set status = $2 where id = $1 and role <> 'admin' returning *", [Number(id), status]);
    if (!r.rows[0]) return { error: "not-found" };
    if (status !== "active") await db.query("delete from sessions where user_id = $1", [Number(id)]);   // заблокований — одразу без доступу
    return { user: publicUser(r.rows[0]) };
  }

  return { createSession, userFromRequest, destroySession, register, login, ensureAdmin, listUsers, setStatus };
}

module.exports = { createAuth, hashPassword, verifyPassword, checkRegistration, parseCookies, sessionCookie,
                   publicUser, COOKIE, SESSION_DAYS };
