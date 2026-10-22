/*
 * Сервер синхронізації табло.
 *
 * Роздає сайт (папка public/) і тримає WebSocket /ws — через нього працюють
 * «Посилання на матч»: міні-табло на будь-якому пристрої й пульт для
 * другого судді.
 *
 *   пульт ⇄ кімната ABC234 ⇄ пульт другого судді
 *                │
 *                └──▶ міні-табло (телефони, ТБ)
 *
 * Кімнату створює пульт: перший, хто підключився з ключем судді, закріплює
 * його (зберігається лише хеш). Інші пульти — тільки з тим самим ключем,
 * глядачі — без ключа і лише читають. Стан у памʼяті: після перезапуску
 * сервера пульт сам надішле його знову, щойно перепідключиться.
 *
 * Після перезапуску кімнати повертаються до справжніх власників: при першому
 * підключенні сервер видає пульту доказ власності — підпис HMAC(ROOM_SECRET,
 * код:хеш ключа:час створення). Пульт зберігає його й показує при кожному
 * підключенні. Якщо кімнату після рестарту встиг зайняти хтось інший, давніший
 * доказ виграє, а самозванця відключає. Без ROOM_SECRET секрет випадковий
 * на кожен запуск — тоді все працює як раніше, лише без цього захисту.
 *
 * Ключ судді окремий від ключа власника: власник повідомляє його серверу
 * ({type:"judge-key"}) і може будь-коли замінити — старі пульти судді відключаються,
 * а код кімнати й посилання глядачів лишаються. Суддя рахує (state), але не міняє
 * налаштувань показу й ключа. Доказ судді підписано для «j»+хеш його ключа і того
 * самого часу, що й доказ власника, — тож після рестарту суддя може прийти першим.
 * Старі посилання судді зі спільним ключем власника працюють, як і раніше, — як власник.
 *
 * Захист від засмічення: кімната, яку створив глядач (без пульта), зникає,
 * щойно вийде останній глядач, а з однієї IP-адреси обмежено і кількість
 * зʼєднань, і кількість нових кімнат за хвилину.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const Match = require("../public/js/core/match.js");   // ті самі правила перевірки, що й у браузері

const ROOM_RE = /^[A-Z2-9]{6}$/;          // без I, O, 0, 1 — щоб не плутати на слух і на екрані
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_MESSAGE = 512 * 1024;           // повний матч із подіями — десятки КБ
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;  // кімната без жодного підключення живе добу
const MAX_ROOMS = 2000;
const PING_MS = 30000;
// Ліміти на одну IP-адресу. Глядачі в залі часто сидять за одним Wi-Fi (одна адреса),
// тож зʼєднань дозволяємо з запасом, а нових кімнат — небагато: суддя створює одну на матч.
const MAX_CONN_PER_IP = 300;
const MAX_NEW_ROOMS_PER_IP = 20;          // за вікно RATE_WINDOW_MS
const RATE_WINDOW_MS = 60 * 1000;
const TRY_LATER = 1013;                   // «спробуйте пізніше»: клієнт перепідключиться сам
const PREF_KEYS = ["palette", "showServe", "sound", "timeoutSec", "boardPct", "boardLogo", "boardLogoOld",
                   "colorA", "colorB", "colorBg", "colorFrame", "colorText"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

const PUBLIC_DIR = path.join(__dirname, "..", "public");   // сайт роздається як є, без збирання

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const PROOF_RE = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

function createServer(opts) {
  opts = opts || {};
  const root = path.resolve(opts.root || PUBLIC_DIR);
  const log = opts.log || (() => {});
  const rooms = new Map();   // code → { keyHash, state, prefs, clients:Set, touched }
  const limits = Object.assign({ connPerIp: MAX_CONN_PER_IP, newRoomsPerIp: MAX_NEW_ROOMS_PER_IP,
                                 windowMs: RATE_WINDOW_MS }, opts.limits || {});
  // За проксі Render справжня адреса — останній запис X-Forwarded-For (його дописує сам Render;
  // перші записи клієнт може підробити). Локально проксі немає — беремо адресу сокета.
  const trustProxy = opts.trustProxy !== undefined ? !!opts.trustProxy : !!process.env.RENDER;
  const secret = opts.secret || process.env.ROOM_SECRET || crypto.randomBytes(32).toString("hex");
  const conns = new Map();   // ip → кількість відкритих зʼєднань
  const created = new Map(); // ip → [час створення кімнати, …] за останнє вікно

  function clientIp(req) {
    if (trustProxy) {
      const xff = String((req && req.headers["x-forwarded-for"]) || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return (req && req.socket && req.socket.remoteAddress) || "?";
  }

  /* Доказ власності кімнати: «час.підпис». Час — коли ключ уперше закріпив кімнату. */
  function sign(code, keyHash, since) {
    return since + "." + crypto.createHmac("sha256", secret).update(code + ":" + keyHash + ":" + since).digest("base64url");
  }

  /* Час із правильного доказу для цієї кімнати й цього ключа, інакше null. */
  function proofSince(proof, code, keyHash) {
    const m = PROOF_RE.exec(String(proof || ""));
    if (!m) return null;
    const want = Buffer.from(sign(code, keyHash, m[1]));
    const got = Buffer.from(String(proof));
    return want.length === got.length && crypto.timingSafeEqual(want, got) ? Number(m[1]) : null;
  }

  /* Чи можна цій адресі створити ще одну кімнату (і, якщо так, — врахувати її). */
  function takeRoomSlot(ip) {
    const now = Date.now();
    const list = (created.get(ip) || []).filter((t) => now - t < limits.windowMs);
    if (list.length >= limits.newRoomsPerIp) { created.set(ip, list); return false; }
    list.push(now);
    created.set(ip, list);
    return true;
  }

  /* ---------- статика ---------- */

  function serveStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
    catch (e) { res.writeHead(400).end(); return; }
    if (urlPath === "/healthz") {
      // Пульт на іншому домені (GitHub Pages) теж має змогу перевірити, що сервер живий.
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const file = path.join(root, urlPath);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }   // ../ за межі сайту
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("не знайдено"); return; }
      const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
      // sw.js і сторінки — завжди свіжі, решта змінюється разом із версією кешу.
      // Сторінки, скрипти й стилі — завжди свіжі (304, якщо не змінились), щоб після деплою не змішались версії.
      headers["Cache-Control"] = /\.(html|webmanifest|js|css)$/.test(file) ? "no-cache" : "public, max-age=3600";
      headers["X-Content-Type-Options"] = "nosniff";
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  // Акаунти (server/api.js): /api/… — якщо createServer отримав opts.api.
  const api = opts.api || null;

  const server = http.createServer((req, res) => {
    if (api && req.url.startsWith("/api/")) {
      api.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    serveStatic(req, res);
  });

  /* ---------- кімнати ---------- */

  function cleanState(raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return null;
    try {
      // Сувора перевірка: одна зіпсована подія зламала б табло всім глядачам кімнати.
      return Match.validate(JSON.parse(raw)).length ? null : raw;
    } catch (e) { return null; }
  }

  /*
   * Два пульти одного матчу: зливаємо події обох (Match.merge), а не перезаписуємо —
   * інакше очки судді, що рахував без звʼязку, губилися б. Стан старої версії пульта
   * (без id подій) лишаємо як є: так вона працювала й раніше («діє останній»).
   */
  function mergeState(prev, raw) {
    if (!prev) return raw;
    try {
      const incoming = Match.deserialize(raw);
      if (!incoming || incoming.v < 2) return raw;
      const merged = Match.merge(Match.deserialize(prev), incoming);
      return Match.syncKey(merged) === Match.syncKey(incoming) ? raw : Match.serialize(merged);
    } catch (e) { return raw; }
  }

  function cleanPrefs(p) {
    if (!p || typeof p !== "object") return null;
    const out = {};
    PREF_KEYS.forEach((k) => { if (k in p && ["string", "number", "boolean"].includes(typeof p[k])) out[k] = p[k]; });
    return out;
  }

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /*
   * Відмова з поясненням. Код закриття (4003 тощо) проксі хостингу може загубити —
   * на Render браузер бачить лише 1006 через ~20 с. Тому причину спершу шлемо
   * звичайним повідомленням (воно доходить завжди), а сокет добиваємо, якщо клієнт
   * не закрився сам.
   */
  function reject(ws, code, reason) {
    send(ws, { type: "error", code: code, reason: reason });
    try { ws.close(code, reason); } catch (e) {}
    setTimeout(() => { try { ws.terminate(); } catch (e) {} }, 2000).unref();
  }

  function broadcast(room, msg, except) {
    room.clients.forEach((c) => { if (c !== except) send(c, msg); });
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws") { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, url, req));
  });

  wss.on("connection", (ws, url, req) => {
    const ip = clientIp(req);
    if ((conns.get(ip) || 0) >= limits.connPerIp) { reject(ws, TRY_LATER, "too many connections"); return; }
    const code = (url.searchParams.get("room") || "").toUpperCase();
    const role = url.searchParams.get("role") === "control" ? "control" : "viewer";
    const key = url.searchParams.get("key") || "";

    if (!ROOM_RE.test(code)) { reject(ws, 4000, "bad room"); return; }

    let room = rooms.get(code);
    if (role === "control") {
      if (!KEY_RE.test(key)) { reject(ws, 4001, "bad key"); return; }
      const kh = sha256(key);
      const proof = url.searchParams.get("proof");
      const since = proofSince(proof, code, kh);                 // доказ власника; null — немає
      const judgeSince = proofSince(proof, code, "j" + kh);      // доказ судді; null — немає
      if (!room) {
        if (rooms.size >= MAX_ROOMS) { reject(ws, 4029, "too many rooms"); return; }
        if (!takeRoomSlot(ip)) { reject(ws, TRY_LATER, "slow down"); return; }
        room = judgeSince !== null
          // Після рестарту першим прийшов суддя з доказом — кімната чекає на власника.
          ? { keyHash: null, judgeHash: kh, since: judgeSince, state: null, prefs: null, clients: new Set(), touched: Date.now() }
          : { keyHash: kh, judgeHash: null, since: since !== null ? since : Date.now(), state: null, prefs: null,
              clients: new Set(), touched: Date.now() };
        rooms.set(code, room);
        if (judgeSince !== null) { ws.judge = true; ws.judgeHash = kh; ws.judgeSince = judgeSince; }
        log("кімната " + code + (since !== null || judgeSince !== null ? " повернулась" : " створена"));
      } else if (room.keyHash === kh) {
        if (since !== null && since < room.since) room.since = since;   // той самий ключ, давніший доказ
      } else if (room.judgeHash && room.judgeHash === kh) {
        ws.judge = true; ws.judgeHash = kh; ws.judgeSince = judgeSince !== null ? judgeSince : room.since;
      } else if (!room.judgeHash && judgeSince !== null && (room.keyHash === null || judgeSince === room.since)) {
        // Суддя з доказом для цієї сесії власника, а власник ще не нагадав серверу ключ судді.
        room.judgeHash = kh;
        if (room.keyHash === null && !room.since) room.since = judgeSince;
        ws.judge = true; ws.judgeHash = kh; ws.judgeSince = judgeSince;
      } else if (room.keyHash === null) {
        // Пульт прийшов у кімнату, створену глядачем, — закріплює ключ.
        room.keyHash = kh;
        room.since = since !== null ? since : Date.now();
      } else {
        if (since === null || since >= room.since) { reject(ws, 4003, "wrong key"); return; }   // кімната чужа
        // Давніший власник повертає кімнату, яку після рестарту зайняв хтось інший.
        room.keyHash = kh;
        room.since = since;
        room.state = null;
        room.prefs = null;
        // Самозванець і судді, яких міг призначити він, — геть. Суддя з доказом саме цієї
        // сесії власника (той самий час) лишається.
        const ours = (c) => c.judge && c.judgeSince === since;
        const keep = Array.from(room.clients).filter(ours);
        room.judgeHash = keep.length ? keep[0].judgeHash : null;
        room.clients.forEach((c) => { if (c.role === "control" && !ours(c)) { room.clients.delete(c); reject(c, 4003, "wrong key"); } });
        log("кімната " + code + " повернулась власнику, самозванця відключено");
      }
    } else if (!room) {
      // Глядач прийшов раніше за пульт — чекаємо в порожній кімнаті без ключа.
      if (rooms.size >= MAX_ROOMS) { reject(ws, 4029, "too many rooms"); return; }
      if (!takeRoomSlot(ip)) { reject(ws, TRY_LATER, "slow down"); return; }
      room = { keyHash: null, judgeHash: null, state: null, prefs: null, clients: new Set(), touched: Date.now() };
      rooms.set(code, room);
    }

    ws.role = role;
    ws.alive = true;
    conns.set(ip, (conns.get(ip) || 0) + 1);
    room.clients.add(ws);
    room.touched = Date.now();

    const hello = { type: "hello", room: code, role: role };
    if (ws.judge) { hello.judge = true; hello.proof = sign(code, "j" + ws.judgeHash, ws.judgeSince); }
    else if (role === "control") hello.proof = sign(code, room.keyHash, room.since);   // глядачам — ні
    send(ws, hello);
    if (room.state) send(ws, { type: "state", match: room.state });
    if (room.prefs) send(ws, { type: "prefs", prefs: room.prefs });

    ws.on("pong", () => { ws.alive = true; });

    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "bye") {                   // клієнт іде: прибираємо одразу, не чекаючи, чи дійде close
        leave();
        try { ws.close(1000, "bye"); } catch (e) {}
        setTimeout(() => { try { ws.terminate(); } catch (e) {} }, 2000).unref();
        return;
      }
      if (role !== "control") return;             // глядачі нічого не змінюють
      room.touched = Date.now();
      if (msg.type === "state") {
        const st = cleanState(msg.match);
        if (!st) return;
        const merged = mergeState(room.state, st);
        room.state = merged;
        broadcast(room, { type: "state", match: merged }, ws);
        // У сервера були події, яких цей пульт ще не бачив (від другого судді), — віддаємо злите й йому.
        if (merged !== st) send(ws, { type: "state", match: merged });
      } else if (msg.type === "judge-key") {
        // Лише власник призначає ключ судді; новий ключ — старі пульти судді відключаються.
        if (ws.judge || typeof msg.key !== "string" || !KEY_RE.test(msg.key)) return;
        const jh = sha256(msg.key);
        if (jh === room.keyHash) return;                  // спільний ключ — це просто ще один власник
        room.judgeHash = jh;
        room.clients.forEach((c) => {
          if (c.judge && c.judgeHash !== jh) { room.clients.delete(c); reject(c, 4003, "wrong key"); }
        });
      } else if (msg.type === "prefs") {
        if (ws.judge) return;                             // налаштування показу — справа власника
        const p = cleanPrefs(msg.prefs);
        if (!p) return;
        room.prefs = p;
        broadcast(room, { type: "prefs", prefs: p }, ws);
      } else if (msg.type === "timeout-end") {
        broadcast(room, { type: "timeout-end", ts: typeof msg.ts === "number" ? msg.ts : null }, ws);
      }
    });

    let left = false;
    function leave() {
      if (left) return;
      left = true;
      room.clients.delete(ws);
      room.touched = Date.now();
      const n = (conns.get(ip) || 1) - 1;
      if (n > 0) conns.set(ip, n); else conns.delete(ip);
      // Кімнату без пульта (її створив глядач) не тримаємо: інакше тисячі відкрити-закрити
      // на випадкові коди забили б MAX_ROOMS на добу. Прийде глядач знову — створиться нова.
      if (!room.clients.size && room.keyHash === null && rooms.get(code) === room) rooms.delete(code);
    }
    ws.on("close", leave);
  });

  /* Пінги прибирають мертві зʼєднання, а прибирання — покинуті кімнати. */
  const timer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.alive) { ws.terminate(); return; }
      ws.alive = false;
      try { ws.ping(); } catch (e) {}
    });
    const now = Date.now();
    rooms.forEach((room, code) => {
      if (!room.clients.size && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
    });
    created.forEach((list, ip) => {
      const fresh = list.filter((t) => now - t < limits.windowMs);
      if (fresh.length) created.set(ip, fresh); else created.delete(ip);
    });
  }, opts.pingMs || PING_MS);
  timer.unref();

  server.on("close", () => {
    clearInterval(timer);
    wss.clients.forEach((ws) => ws.terminate());
    wss.close();
  });
  // http.Server.close() чекає, доки закриються всі зʼєднання, — WebSocket-и теж.
  const close = server.close.bind(server);
  server.close = (cb) => {
    wss.clients.forEach((ws) => ws.terminate());
    return close(cb);
  };
  server.rooms = rooms;
  server.clientIp = clientIp;
  return server;
}

module.exports = { createServer, ROOM_RE, PUBLIC_DIR };

/*
 * Запуск. Акаунти вмикаються, якщо є база:
 *   DATABASE_URL=postgres://…     — Postgres (на Render — Neon);
 *   PGLITE_DIR=.data              — локально без Postgres (PGlite у теці; лише для розробки);
 *   npm run dev:accounts          — те саме одною командою (і на Windows): база в .data,
 *                                   суперадмін admin@local / admin12345, якщо не задано інше.
 * Суперадмін — SUPERADMIN_EMAIL і SUPERADMIN_PASSWORD (старі назви ADMIN_EMAIL / ADMIN_PASSWORD
 * теж діють). Створюється при першому старті; новий пароль у налаштуваннях — відновлення доступу.
 * Без бази — табло працює, як і раніше, лише без входу й керованих матчів.
 */
async function main() {
  const log = (m) => console.log(m);
  const port = Number(process.env.PORT) || 3000;
  const trustProxy = !!process.env.RENDER;
  let api = null;
  const devDir = process.argv.indexOf("--pglite") >= 0 ? (process.argv[process.argv.indexOf("--pglite") + 1] || ".data") : "";
  if (devDir && !process.env.PGLITE_DIR) process.env.PGLITE_DIR = devDir;
  const env = process.env;
  let supEmail = env.SUPERADMIN_EMAIL || env.ADMIN_EMAIL, supPass = env.SUPERADMIN_PASSWORD || env.ADMIN_PASSWORD;
  if (devDir && !supEmail) { supEmail = "admin@local"; supPass = "admin12345"; }
  if (process.env.DATABASE_URL || process.env.PGLITE_DIR) {
    const { open } = require("./db.js");
    const { createApi } = require("./api.js");
    const db = await open(process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : { pglite: process.env.PGLITE_DIR });
    api = createApi({ db, log, trustProxy });
    const sup = await api.auth.ensureSuperadmin(supEmail, supPass, env.SUPERADMIN_NAME || env.ADMIN_NAME);
    log("акаунти увімкнено (" + db.kind + ")" + (sup ? ", суперадмін: " + sup.email : " — SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD не задано, суперадміна немає"));
  }
  const server = createServer({ log, api, trustProxy });
  if (api) api.clientIp = server.clientIp;
  server.listen(port, () => {
    console.log("Табло: http://localhost:" + port + "  (синхронізація — ws://localhost:" + port + "/ws)");
  });
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
