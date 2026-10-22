"use strict";

/*
 * Синхронізація між пристроями в справжньому браузері: пульт, міні-табло глядача,
 * пульт другого судді, перезапуск сервера посеред матчу, самозванець, відмова сервера.
 */
const { test, expect } = require("@playwright/test");
const WebSocket = require("ws");
const { liveServer, device, createLink, closeSheets } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer(); });
test.afterEach(async () => { await server.stop(); });

const score = async (page) => [await page.textContent("#scoreA"), await page.textContent("#scoreB")].map((s) => s.trim());
const board = (page) => [page.locator("#lPtsA"), page.locator("#lPtsB")];

async function expectBoard(page, a, b, timeout) {
  const [pa, pb] = board(page);
  await expect(pa).toHaveText(String(a), { timeout });
  await expect(pb).toHaveText(String(b), { timeout });
}

test("глядач бачить рахунок наживо", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { board: boardUrl } = await createLink(pult);
  expect(boardUrl).not.toContain("key=");
  await closeSheets(pult);

  const viewer = await device(browser, boardUrl);
  await expectBoard(viewer, 0, 0);
  await pult.click("#sideA");
  await pult.click("#sideA");
  await pult.click("#sideB");
  expect(await score(pult)).toEqual(["2", "1"]);
  await expectBoard(viewer, 2, 1);

  await pult.click("#undoBtn");
  await expectBoard(viewer, 2, 0);
  expect(pult.errors).toEqual([]);
  expect(viewer.errors).toEqual([]);
});

test("другий суддя керує тим самим матчем з іншого телефона", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { board: boardUrl, judge } = await createLink(pult);
  await closeSheets(pult);
  await pult.click("#sideA");

  const judgePult = await device(browser, judge);
  await expect(judgePult.locator("#scoreA")).toHaveText("1");
  expect(judgePult.url()).not.toContain("key=");                 // ключ прибрано з адресного рядка
  await expect(judgePult.locator("#linkDot")).toHaveText(/на звʼязку/);

  const viewer = await device(browser, boardUrl);
  await judgePult.click("#sideB");
  await judgePult.click("#sideB");
  await expect(pult.locator("#scoreB")).toHaveText("2");
  await expectBoard(viewer, 1, 2);

  await pult.click("#sideA");
  await expect(judgePult.locator("#scoreA")).toHaveText("2");
  await expectBoard(viewer, 2, 2);
  [pult, judgePult, viewer].forEach((p) => expect(p.errors).toEqual([]));
});

test("перезапуск сервера посеред матчу: самозванець не забирає кімнату, табло відновлюється", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { board: boardUrl, link } = await createLink(pult);
  expect(link.proof).toMatch(/^\d+\.[\w-]{43}$/);
  await closeSheets(pult);
  for (const side of ["#sideA", "#sideA", "#sideA", "#sideB"]) await pult.click(side);
  const viewer = await device(browser, boardUrl);
  await expectBoard(viewer, 3, 1);

  await server.restart();

  // Поки пульт перепідключається (пауза від 1 с), кімнату займає хтось із чужим ключем.
  const thief = new WebSocket(server.url.replace("http", "ws") + "/ws?room=" + link.room + "&role=control&key=" + "x".repeat(32));
  const thiefClosed = new Promise((r) => thief.on("close", (code) => r(code)));
  await new Promise((r) => thief.on("open", r));
  thief.send(JSON.stringify({ type: "state", match: JSON.stringify({ v: 1, names: ["Хакер", "Хакер"], rules: {}, events: [], undone: [] }) }));

  // Пульт повертається з доказом власності — самозванця відключено, табло знову з рахунком матчу.
  expect(await thiefClosed).toBe(4003);
  await expect(pult.locator("#linkDot")).toHaveText(/на звʼязку/, { timeout: 20000 });
  await expectBoard(viewer, 3, 1, 20000);
  await expect(viewer.locator("#lNameA")).not.toHaveText("Хакер");

  await pult.click("#sideB");
  await expectBoard(viewer, 3, 2);
  expect(server.rooms().get(link.room).clients.size).toBe(2);      // пульт і глядач, без самозванця
});

test("пульт з чужим ключем бачить зрозуміле пояснення, а не нескінченні спроби", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { link } = await createLink(pult);
  const wrong = server.url + "/index.html?room=" + link.room + "&key=" + "w".repeat(32);
  const stranger = await device(browser, wrong);
  await expect(stranger.locator("#linkDot")).toHaveText(/немає звʼязку/);
  await stranger.click("#linkDot");
  await expect(stranger.locator("#linkTroubleTitle")).toHaveText("Сервер не приймає це посилання");
  await expect(stranger.locator("#linkTroubleWhy")).toContainText("Ключ судді не підходить");
  // Пульт власника лишився на звʼязку.
  await expect(pult.locator("#linkDot")).toHaveText(/на звʼязку/);
});

test("глядач, що закрив табло, звільняє кімнату одразу", async ({ browser }) => {
  const viewer = await device(browser, server.url + "/live.html?room=GHST23");
  await expect.poll(() => server.rooms().has("GHST23")).toBe(true);
  await viewer.context().close();
  await expect.poll(() => server.rooms().has("GHST23"), { timeout: 5000 }).toBe(false);
});

/*
 * Два судді без втрат: пульти зливають стани подія за подією (Match.merge), тож очки,
 * набрані на будь-якому з них без звʼязку, після перепідключення є в обох.
 */
test("обидва судді рахують, поки сервер лежить, — після звʼязку жодне очко не губиться", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { judge } = await createLink(pult);
  await closeSheets(pult);
  const judgePult = await device(browser, judge);
  await expect(judgePult.locator("#linkDot")).toHaveText(/на звʼязку/);

  await server.stop();
  await expect(pult.locator("#linkDot")).toHaveText(/немає звʼязку/);
  await pult.click("#sideA");                // основний суддя: 1:0
  await judgePult.click("#sideB");           // другий суддя: 0:1
  await server.restart();

  await expect(pult.locator("#linkDot")).toHaveText(/на звʼязку/, { timeout: 20000 });
  await expect(judgePult.locator("#linkDot")).toHaveText(/на звʼязку/, { timeout: 20000 });
  await expect(pult.locator("#scoreA")).toHaveText("1", { timeout: 3000 });
  await expect(pult.locator("#scoreB")).toHaveText("1", { timeout: 3000 });
  await expect(judgePult.locator("#scoreA")).toHaveText("1", { timeout: 3000 });
  await expect(judgePult.locator("#scoreB")).toHaveText("1", { timeout: 3000 });
});

test("після злиття пристрої не пересилають стан один одному безкінечно", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { judge } = await createLink(pult);
  await closeSheets(pult);
  const judgePult = await device(browser, judge);
  await expect(judgePult.locator("#linkDot")).toHaveText(/на звʼязку/);

  await server.stop();
  await pult.click("#sideA");
  await judgePult.click("#sideB");
  await server.restart();
  await expect(pult.locator("#scoreB")).toHaveText("1", { timeout: 20000 });
  await expect(judgePult.locator("#scoreA")).toHaveText("1", { timeout: 20000 });

  // Тиша: рахуємо, скільки станів пульти надсилають за 3 с після злиття, — має бути нуль.
  const both = [pult, judgePult];
  await pult.waitForTimeout(500);
  await Promise.all(both.map((p) => p.evaluate(() => {
    const orig = WebSocket.prototype.send;
    window.__sentStates = 0;
    WebSocket.prototype.send = function (d) { if (String(d).includes('"type":"state"')) window.__sentStates++; return orig.call(this, d); };
  })));
  await pult.waitForTimeout(3000);
  const sent = await Promise.all(both.map((p) => p.evaluate(() => window.__sentStates)));
  expect(sent).toEqual([0, 0]);
});

test("скасування без звʼязку не воскресає, а очко другого судді лишається", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  const { judge, board: boardUrl } = await createLink(pult);
  await closeSheets(pult);
  await pult.click("#sideA");
  await pult.click("#sideA");                                   // 2:0
  const judgePult = await device(browser, judge);
  await expect(judgePult.locator("#scoreA")).toHaveText("2");
  const viewer = await device(browser, boardUrl);

  await server.stop();
  await pult.click("#undoBtn");                                 // основний скасував одне очко А
  await judgePult.click("#sideB");                              // другий додав очко Б
  await server.restart();

  for (const p of [pult, judgePult]) {
    await expect(p.locator("#scoreA")).toHaveText("1", { timeout: 20000 });
    await expect(p.locator("#scoreB")).toHaveText("1", { timeout: 20000 });
  }
  await expectBoard(viewer, 1, 1, 20000);
});

test("новий ключ судді: старий суддя відключений із поясненням, новий працює, глядачі не помітили", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  pult.on("dialog", (d) => d.accept());
  const { judge, board: boardUrl, link } = await createLink(pult);
  expect(judge).not.toContain(link.key);                         // ключ власника — не в посиланні судді
  const oldJudge = await device(browser, judge);
  await expect(oldJudge.locator("#linkDot")).toHaveText(/на звʼязку/);
  await oldJudge.click("#sideA");
  await expect(pult.locator("#scoreA")).toHaveText("1");
  const viewer = await device(browser, boardUrl);
  await expectBoard(viewer, 1, 0);

  await pult.click("#linkJudgeNew");
  const judge2 = (await pult.textContent("#linkJudge")).trim();
  expect(judge2).not.toBe(judge);
  await expect(oldJudge.locator("#linkDot")).toHaveText(/немає звʼязку/);
  await oldJudge.click("#linkDot");
  await expect(oldJudge.locator("#linkTroubleWhy")).toContainText("Ключ судді не підходить");

  const newJudge = await device(browser, judge2);
  await expect(newJudge.locator("#scoreA")).toHaveText("1");
  await newJudge.click("#sideB");
  await expect(pult.locator("#scoreB")).toHaveText("1");
  await expectBoard(viewer, 1, 1);
  await closeSheets(oldJudge);
  await oldJudge.click("#sideA");                                   // старий суддя рахує лише в себе
  await pult.waitForTimeout(500);
  await expect(pult.locator("#scoreA")).toHaveText("1");
  [pult, newJudge, viewer].forEach((p) => expect(p.errors).toEqual([]));
});
