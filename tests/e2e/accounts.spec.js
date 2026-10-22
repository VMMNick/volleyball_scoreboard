"use strict";

/* Акаунти в браузері: суддя реєструється → адмін підтверджує в панелі → суддя входить; пульт показує пункт «Акаунт». */
const { test, expect } = require("@playwright/test");
const { liveServer } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer({ accounts: true }); });
test.afterEach(async () => { await server.stop(); });

test("реєстрація судді, підтвердження адміном, вхід і вихід", async ({ browser }) => {
  const judge = await (await browser.newContext()).newPage();
  await judge.goto(server.url + "/account.html");
  await judge.click("#tabRegister");
  await judge.fill("#rName", "Іван Коваль");
  await judge.fill("#rEmail", "ivan@test.ua");
  await judge.fill("#rPass", "volley-2026");
  await judge.click("#rBtn");
  await expect(judge.locator("#rMsg")).toContainText("Заявку надіслано");

  await judge.click("#tabLogin");
  await judge.fill("#lEmail", "ivan@test.ua");
  await judge.fill("#lPass", "volley-2026");
  await judge.click("#lBtn");
  await expect(judge.locator("#lMsg")).toContainText("ще не підтвердив адмін");

  // Адмін: вхід → панель → підтвердити.
  const admin = await (await browser.newContext()).newPage();
  await admin.goto(server.url + "/admin.html");
  await expect(admin).toHaveURL(/account\.html$/);                 // без входу — на сторінку входу
  await admin.fill("#lEmail", "admin@test.ua");
  await admin.fill("#lPass", "admin-pass-1");
  await admin.click("#lBtn");
  await expect(admin.locator("#uRole")).toHaveText("адмін");
  await admin.click("#uAdmin");
  await expect(admin.locator("#aPending")).toContainText("очікують: 1");
  const row = admin.locator(".user", { hasText: "ivan@test.ua" });
  await expect(row.locator(".badge")).toHaveText("очікує");
  await row.locator("button", { hasText: "Підтвердити" }).click();
  await expect(row.locator(".badge")).toHaveText("активний");
  await expect(admin.locator("#aPending")).toHaveText("");

  // Тепер суддя входить і бачить свій акаунт; пульт показує пункт «Акаунт і мої матчі».
  await judge.click("#lBtn");
  await expect(judge.locator("#uName")).toHaveText("Іван Коваль");
  await expect(judge.locator("#uRole")).toHaveText("суддя");
  await expect(judge.locator("#uAdmin")).toBeHidden();
  await judge.reload();
  await expect(judge.locator("#uName")).toHaveText("Іван Коваль", { timeout: 5000 });   // сесія живе після перезавантаження
  await judge.goto(server.url + "/index.html");
  await judge.click("#menuBtn");
  await expect(judge.locator("#mAccount")).toBeVisible();
  await judge.click("#mAccount");
  await expect(judge).toHaveURL(/account\.html$/);

  // Адмін блокує — суддя одразу без доступу.
  await row.locator("button", { hasText: "Заблокувати" }).click();
  await judge.reload();
  await expect(judge.locator("#guest")).toBeVisible();
  await judge.fill("#lEmail", "ivan@test.ua");
  await judge.fill("#lPass", "volley-2026");
  await judge.click("#lBtn");
  await expect(judge.locator("#lMsg")).toContainText("заблоковано");

  await admin.goto(server.url + "/account.html");
  await admin.click("#uLogout");
  await expect(admin.locator("#guest")).toBeVisible();
});

test("без акаунтів на сервері: пункту в меню немає, сторінка пояснює", async ({ browser }) => {
  const plain = await liveServer();
  try {
    const p = await (await browser.newContext()).newPage();
    await p.goto(plain.url + "/index.html");
    await p.click("#menuBtn");
    await p.waitForTimeout(300);
    await expect(p.locator("#mAccount")).toBeHidden();
    await p.goto(plain.url + "/account.html");
    await expect(p.locator("#off")).toBeVisible();
  } finally { await plain.stop(); }
});
