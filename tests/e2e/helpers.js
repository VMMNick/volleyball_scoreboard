"use strict";

/*
 * Спільне для e2e: справжній сервер (server/server.js) на випадковому порту, який можна
 * «перезапустити» на тому ж порту, і пристрої — окремі контексти браузера (своє сховище,
 * свої вкладки), як різні телефони в залі.
 */
const { createServer } = require("../../server/server.js");

const SECRET = "e2e-" + "s".repeat(60);

async function startServer(port, api) {
  const srv = createServer({ secret: SECRET, pingMs: 60000, api });
  // Усі сокети, зокрема ті, що перейшли на WebSocket: http-сервер їх уже не бачить,
  // і closeAllConnections() їх не закриє (на Windows close() тоді висить до тайм-ауту тесту).
  srv.sockets = new Set();
  srv.on("connection", (sock) => {
    srv.sockets.add(sock);
    sock.on("close", () => srv.sockets.delete(sock));
  });
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port || 0, "127.0.0.1", resolve);
  });
  return srv;
}

/*
 * Зупинити одразу. server.close() чекає, доки браузер сам закриє keep-alive зʼєднання
 * (на Windows — секунди, а то й до тайм-ауту тесту), тож закриваємо їх примусово.
 */
function shutdown(srv) {
  if (!srv.listening) return Promise.resolve();
  const closed = new Promise((r) => {
    srv.close(r);
    srv.closeAllConnections();
    srv.sockets.forEach((sock) => sock.destroy());
  });
  // Остання страховка: порт уже звільнено (listening = false), тож не чекаємо вічно.
  return Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
}

/*
 * Сервер, який можна перезапустити посеред матчу: та сама адреса, порожня памʼять.
 * { accounts: true } — з акаунтами: PostgreSQL у памʼяті (PGlite) і адмін admin@test.ua / admin-pass-1.
 */
async function liveServer(opts) {
  let api = null, db = null;
  if (opts && opts.accounts) {
    db = await require("../../server/db.js").open({ pglite: true });
    api = require("../../server/api.js").createApi({ db });
    await api.auth.ensureSuperadmin("admin@test.ua", "admin-pass-1", "Суперадмін");
  }
  let srv = await startServer(0, api);
  const port = srv.address().port;
  return {
    db,
    url: "http://127.0.0.1:" + port,
    port,
    rooms: () => srv.rooms,
    async restart() {
      await shutdown(srv);
      srv = await startServer(port, api);
    },
    stop: async () => { await shutdown(srv); if (db) await db.close(); }
  };
}

/* Новий «пристрій»: окремий контекст браузера. Помилки сторінки збираємо, щоб тест їх бачив. */
async function device(browser, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  if (url) await page.goto(url);
  return page;
}

/* Пульт створює посилання на матч; повертає адреси міні-табла й пульта судді. */
async function createLink(pult) {
  await pult.click("#menuBtn");
  await pult.click("#mLink");
  await pult.click("#linkCreate");
  await pult.locator("#linkDot", { hasText: "на звʼязку" }).waitFor();
  return {
    board: (await pult.textContent("#linkBoard")).trim(),
    judge: (await pult.textContent("#linkJudge")).trim(),
    link: JSON.parse(await pult.evaluate(() => localStorage.getItem("volleyball:link")))
  };
}

/* Закрити шторку посилання, щоб тапати по полю. */
async function closeSheets(pult) {
  await pult.keyboard.press("Escape");
}

module.exports = { SECRET, liveServer, device, createLink, closeSheets };
