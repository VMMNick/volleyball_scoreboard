"use strict";

/* Пляжний волейбол від початку до кінця: пресет, зміна сторін кнопкою, технічний тайм-аут, вирішальний сет до 15. */
const { test, expect } = require("@playwright/test");
const { liveServer } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer(); });
test.afterEach(async () => { await server.stop(); });

test("пляжний матч: зміна сторін кожні 7 (у вирішальному — 5), технічний тайм-аут на 21, фінал 2:1", async ({ browser }) => {
  const ctx = await browser.newContext();
  const pult = await ctx.newPage();
  const errors = [];
  pult.on("pageerror", (e) => errors.push(e.message));
  await pult.goto(server.url + "/index.html");
  await pult.click("#menuBtn");
  await pult.click("#mSettings");
  await pult.click("#segPreset [data-preset=beach]");
  await expect(pult.locator("#presetHint")).toContainText("технічний тайм-аут на 21");
  await expect(pult.locator("#inTarget")).toHaveValue("21");
  await pult.click("#sheetSave");
  await expect(pult.locator("#subBox")).toBeHidden();             // на пляжі замін немає
  const board = await ctx.newPage();
  await board.goto(server.url + "/display.html");

  const swap = pult.locator("#swapBtn"), tech = pult.locator("#techBtn");
  const state = () => pult.evaluate(() => window.Match.reduce(window.Match.deserialize(localStorage.getItem("volleyball:match"))));
  // Очко команді team — на тій половині, де вона зараз стоїть (після зміни сторін — навпаки).
  const point = async (team) => {
    const s = await state();
    await pult.click((s.flipped ? 1 - team : team) === 0 ? "#sideA" : "#sideB");
  };
  // Кілька очок поспіль; зміну сторін, коли час, робить кнопкою в сітці.
  const scoreFor = async (team, n) => {
    for (let i = 0; i < n; i++) {
      await point(team);
      if (await swap.isVisible()) await swap.click();
    }
  };

  // Сет 1. На 7 очках у сумі — кнопка «поміняти сторони» в сітці.
  for (let i = 0; i < 4; i++) await point(0);
  for (let i = 0; i < 3; i++) await point(1);
  await expect(swap).toBeVisible();
  await expect(board.locator("body")).toContainText("зміна сторін");
  await swap.click();
  await expect(swap).toBeHidden();
  expect((await state()).flipped).toBe(true);
  await scoreFor(0, 7);                                           // 11:3
  for (let i = 0; i < 7; i++) await point(1);                     // 11:10 — 21 у сумі
  await expect(tech).toBeVisible();
  await expect(swap).toBeVisible();                               // 21 кратне 7 — і зміна сторін теж
  await tech.click();
  await expect(pult.locator("#toOverlay")).toBeVisible();
  await expect(pult.locator("#toWho")).toContainText("Технічний");
  await expect(board.locator("#toWho")).toContainText("Технічний тайм-аут");
  await pult.click("#toStop");
  await expect(tech).toBeHidden();                                // раз на сет
  await swap.click();

  await scoreFor(0, 10);                                          // 21:10 — сет команді А
  let s = await state();
  expect(s.sets).toEqual([1, 0]);
  expect(s.setLog[0].points).toEqual([21, 10]);

  await scoreFor(1, 21);                                          // сет 2 — команді Б
  s = await state();
  expect(s.sets).toEqual([1, 1]);
  expect(s.isDecider).toBe(true);
  expect(s.target).toBe(15);

  // Вирішальний: зміна сторін кожні 5, технічного тайм-ауту немає.
  await pult.click((s.flipped ? "#sideB" : "#sideA"));
  await pult.click((s.flipped ? "#sideA" : "#sideB"));
  await pult.click((s.flipped ? "#sideB" : "#sideA"));
  await pult.click((s.flipped ? "#sideA" : "#sideB"));
  await expect(swap).toBeHidden();
  await pult.click((s.flipped ? "#sideB" : "#sideA"));            // 3:2 — 5 очок
  await expect(swap).toBeVisible();
  await swap.click();
  s = await state();
  await scoreFor(0, 15 - s.points[0]);
  s = await state();
  expect(s.done).toBe(true);
  expect(s.sets).toEqual([2, 1]);
  expect(s.techTimeoutTaken).toBe(false);                         // у вирішальному технічного не було
  await expect(pult.locator("#final")).toBeVisible({ timeout: 15000 });
  await expect(pult.locator("#finalTally")).toContainText("2:1");
  expect(errors).toEqual([]);
});
