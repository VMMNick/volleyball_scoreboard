"use strict";

/* Архів матчів у справжньому браузері: матч закінчився → в архіві → протокол → після перезавантаження лишається. */
const { test, expect } = require("@playwright/test");
const { liveServer, device } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer(); });
test.afterEach(async () => { await server.stop(); });

test("закінчений матч потрапляє в архів, протокол відкривається, архів переживає перезавантаження", async ({ browser }) => {
  const pult = await device(browser, server.url + "/index.html");
  pult.on("dialog", (d) => d.accept());
  // Короткий матч: один сет до 3 очок.
  await pult.evaluate(() => {
    const m = window.Match.createMatch({ names: ["Імідж", "Ліцей"], rules: { bestOf: 1, target: 3, winBy: 1 } });
    localStorage.setItem("volleyball:match", window.Match.serialize(m));
  });
  await pult.reload();
  for (let i = 0; i < 3; i++) await pult.click("#sideA");
  await expect(pult.locator("#final")).toBeVisible({ timeout: 15000 });   // 10 с паузи з рахунком сету
  await pult.click("#finalNew");

  await pult.click("#menuBtn");
  await pult.click("#mArchive");
  const item = pult.locator(".arch-item");
  await expect(item).toHaveCount(1);
  await expect(item.locator(".arch-teams")).toContainText("Імідж — Ліцей");
  await expect(item.locator(".arch-teams b")).toHaveText("1:0");
  await expect(item.locator(".arch-meta")).toContainText("3:0");

  await item.locator("button[data-act=proto]").click();
  await expect(pult.locator("#protoTitle")).toHaveText("Протокол · з архіву");
  await expect(pult.locator("#protoHead")).toContainText("Імідж — Ліцей");

  await pult.reload();
  await pult.click("#menuBtn");
  await pult.click("#mArchive");
  await expect(pult.locator(".arch-item")).toHaveCount(1);
  await pult.locator(".arch-item button[data-act=del]").click();
  await expect(pult.locator(".arch-empty")).toBeVisible();
  expect(pult.errors).toEqual([]);
});

test("пошук в архіві: за командою й турніром, лічильник, нічого не знайдено", async ({ browser }) => {
  const pult = await (await browser.newContext()).newPage();
  await pult.goto(server.url + "/index.html");
  await pult.evaluate(() => {
    const M = window.Match, A = window.Archive;
    const play = (names, title, seq, start) => {
      let m = M.createMatch({ names, title, rules: { bestOf: 1, target: 3, winBy: 1 } });
      let ts = start;
      for (const c of seq) m = M.addPoint(m, c === "A" ? 0 : 1, ts += 1000);
      return m;
    };
    let list = [];
    list = A.put(list, play(["Імідж", "Ліцей"], "Кубок міста", "AAA", Date.now() - 7200e3));
    list = A.put(list, play(["Спартак", "Динамо"], "Шкільна ліга", "BBB", Date.now() - 3600e3));
    list = A.put(list, play(["Імідж", "Динамо"], "", "ABBB", Date.now() - 600e3));
    A.save(localStorage, list);
  });
  await pult.reload();
  await pult.click("#menuBtn");
  await pult.click("#mArchive");
  const items = pult.locator(".arch-item");
  await expect(items).toHaveCount(3);

  await pult.fill("#archiveSearch", "імідж");
  await expect(items).toHaveCount(2);
  await expect(pult.locator("#archiveCount")).toHaveText("Знайдено: 2 з 3");
  await pult.fill("#archiveSearch", "Імідж динамо");
  await expect(items).toHaveCount(1);
  await pult.fill("#archiveSearch", "шкільна");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Спартак — Динамо");
  await pult.fill("#archiveSearch", "волейбол");
  await expect(items).toHaveCount(0);
  await expect(pult.locator(".arch-empty")).toContainText("Нічого не знайдено");
  await pult.fill("#archiveSearch", "");
  await expect(items).toHaveCount(3);
  await expect(pult.locator("#archiveCount")).toHaveText("");
});
