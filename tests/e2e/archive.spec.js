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
