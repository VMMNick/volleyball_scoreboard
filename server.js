/*
 * Сервер синхронізації табло.
 *
 * Роздає зібраний сайт (_site) і тримає WebSocket /ws — через нього працюють
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
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const ROOM_RE = /^[A-Z2-9]{6}$/;          // без I, O, 0, 1 — щоб не плутати на слух і на екрані
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_MESSAGE = 512 * 1024;           // повний матч із подіями — десятки КБ
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;  // кімната без жодного підключення живе добу
const MAX_ROOMS = 2000;
const PING_MS = 30000;
const PREF_KEYS = ["palette", "showServe", "sound", "timeoutSec", "overlaySize", "overlayPos"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function createServer(opts) {
  opts = opts || {};
  const root = path.resolve(opts.root || path.join(__dirname, "_site"));
  const log = opts.log || (() => {});
  const rooms = new Map();   // code → { keyHash, state, prefs, clients:Set, touched }

  /* ---------- статика ---------- */

  function serveStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
    catch (e) { res.writeHead(400).end(); return; }
    if (urlPath === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
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
      headers["Cache-Control"] = /\.(html|webmanifest)$|sw\.js$/.test(file) ? "no-cache" : "public, max-age=3600";
      headers["X-Content-Type-Options"] = "nosniff";
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    serveStatic(req, res);
  });

  /* ---------- кімнати ---------- */

  function cleanState(raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return null;
    try {
      const m = JSON.parse(raw);
      return m && Array.isArray(m.events) && Array.isArray(m.names) ? raw : null;
    } catch (e) { return null; }
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

  function broadcast(room, msg, except) {
    room.clients.forEach((c) => { if (c !== except) send(c, msg); });
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws") { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, url));
  });

  wss.on("connection", (ws, url) => {
    const code = (url.searchParams.get("room") || "").toUpperCase();
    const role = url.searchParams.get("role") === "control" ? "control" : "viewer";
    const key = url.searchParams.get("key") || "";

    if (!ROOM_RE.test(code)) { ws.close(4000, "bad room"); return; }

    let room = rooms.get(code);
    if (role === "control") {
      if (!KEY_RE.test(key)) { ws.close(4001, "bad key"); return; }
      if (!room) {
        if (rooms.size >= MAX_ROOMS) { ws.close(4029, "too many rooms"); return; }
        room = { keyHash: sha256(key), state: null, prefs: null, clients: new Set(), touched: Date.now() };
        rooms.set(code, room);
        log("кімната " + code + " створена");
      } else if (room.keyHash !== null && room.keyHash !== sha256(key)) {
        ws.close(4003, "wrong key"); return;      // кімната чужа
      }
    } else if (!room) {
      // Глядач прийшов раніше за пульт — чекаємо в порожній кімнаті без ключа.
      if (rooms.size >= MAX_ROOMS) { ws.close(4029, "too many rooms"); return; }
      room = { keyHash: null, state: null, prefs: null, clients: new Set(), touched: Date.now() };
      rooms.set(code, room);
    }

    // Пульт, що прийшов у кімнату, створену глядачем, — закріплює ключ.
    if (role === "control" && room.keyHash === null) room.keyHash = sha256(key);

    ws.role = role;
    ws.alive = true;
    room.clients.add(ws);
    room.touched = Date.now();

    send(ws, { type: "hello", room: code, role: role });
    if (room.state) send(ws, { type: "state", match: room.state });
    if (room.prefs) send(ws, { type: "prefs", prefs: room.prefs });

    ws.on("pong", () => { ws.alive = true; });

    ws.on("message", (data) => {
      if (role !== "control") return;             // глядачі нічого не змінюють
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (!msg || typeof msg !== "object") return;
      room.touched = Date.now();
      if (msg.type === "state") {
        const st = cleanState(msg.match);
        if (!st) return;
        room.state = st;
        broadcast(room, { type: "state", match: st }, ws);
      } else if (msg.type === "prefs") {
        const p = cleanPrefs(msg.prefs);
        if (!p) return;
        room.prefs = p;
        broadcast(room, { type: "prefs", prefs: p }, ws);
      } else if (msg.type === "timeout-end") {
        broadcast(room, { type: "timeout-end", ts: typeof msg.ts === "number" ? msg.ts : null }, ws);
      }
    });

    ws.on("close", () => {
      room.clients.delete(ws);
      room.touched = Date.now();
    });
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
  return server;
}

module.exports = { createServer, ROOM_RE };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const root = path.join(__dirname, "_site");
  if (!fs.existsSync(path.join(root, "index.html"))) {
    console.error("Немає _site — спершу npm run build");
    process.exit(1);
  }
  createServer({ root, log: (m) => console.log(m) }).listen(port, () => {
    console.log("Табло: http://localhost:" + port + "  (синхронізація — ws://localhost:" + port + "/ws)");
  });
}
