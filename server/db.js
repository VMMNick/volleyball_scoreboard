/*
 * База даних: PostgreSQL. На сервері — DATABASE_URL (Neon, Render, будь-який Postgres) через `pg`;
 * у тестах і локальній розробці без Postgres — PGlite (той самий PostgreSQL у самому Node).
 * Обидва дають однаковий інтерфейс: query(sql, params) → { rows }, tx(fn), close().
 *
 * Міграції — файли server/migrations/NNN_назва.sql, застосовуються по черзі один раз
 * (облік у таблиці schema_migrations), кожна в окремій транзакції.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS = path.join(__dirname, "migrations");

/* Postgres за адресою (DATABASE_URL). */
function fromUrl(url) {
  const { Pool } = require("pg");
  const ssl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  return {
    kind: "pg",
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn({ query: (t, p) => client.query(t, p) });
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    close: () => pool.end()
  };
}

/* PGlite: у памʼяті (dir не задано) або у файлах (dir). Лише для тестів і розробки. */
async function fromPglite(dir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  return {
    kind: "pglite",
    query: (text, params) => db.query(text, params),
    tx: (fn) => db.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    close: () => db.close()
  };
}

async function migrate(db) {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query("select name from schema_migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    await db.tx(async (t) => {
      for (const stmt of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter((s) => s && !/^--[^\n]*$/.test(s))) {
        await t.query(stmt);
      }
      await t.query("insert into schema_migrations (name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

/* База з налаштувань: { url } — Postgres; { pglite: true | "тека" } — PGlite. */
async function open(opts) {
  const db = opts.url ? fromUrl(opts.url) : await fromPglite(typeof opts.pglite === "string" ? opts.pglite : null);
  await migrate(db);
  return db;
}

module.exports = { open, migrate, MIGRATIONS };
