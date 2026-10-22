"use strict";

/*
 * Акаунти в браузері. Людьми керує лише суперадмін: підтверджує суддю, призначає адміна,
 * видає посилання для скидання пароля, блокує й видаляє. Адмін у панель не потрапляє.
 */
const { test, expect } = require("@playwright/test");
const { liveServer } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer({ accounts: true }); });
test.afterEach(async () => { await server.stop(); });

async function page(browser) {
  const p = await (await browser.newContext()).newPage();
  p.on("dialog", (d) => d.accept());           // «Видалити …?» — так
  return p;
}
async function register(p, name, email, pass) {
  await p.goto(server.url + "/account.html");
  await p.click("#tabRegister");
  await p.fill("#rName", name);
  await p.fill("#rEmail", email);
  await p.fill("#rPass", pass);
  await p.click("#rBtn");
  await expect(p.locator("#rMsg")).toContainText("Заявку надіслано");
  await p.click("#tabLogin");
}
async function login(p, email, pass) {
  await p.fill("#lEmail", email);
  await p.fill("#lPass", pass);
  await p.click("#lBtn");
}
async function superadmin(browser) {
  const p = await page(browser);
  await p.goto(server.url + "/admin.html");
  await expect(p).toHaveURL(/account\.html$/);                     // без входу — на сторінку входу
  await login(p, "admin@test.ua", "admin-pass-1");
  await expect(p.locator("#uRole")).toHaveText("суперадмін");
  await p.click("#uAdmin");
  return p;
}

test("суддя реєструється, суперадмін підтверджує й блокує", async ({ browser }) => {
  const judge = await page(browser);
  await register(judge, "Іван Коваль", "ivan@test.ua", "volley-2026");
  await login(judge, "ivan@test.ua", "volley-2026");
  await expect(judge.locator("#lMsg")).toContainText("ще не підтвердив суперадмін");

  const sa = await superadmin(browser);
  await expect(sa.locator("#aPending")).toContainText("очікують: 1");
  const row = sa.locator(".user", { hasText: "ivan@test.ua" });
  await expect(row.locator(".badge.pending")).toHaveText("очікує");
  await row.locator("button", { hasText: "Підтвердити" }).click();
  await expect(row.locator(".badge.active")).toHaveText("активний");
  await expect(sa.locator("#aPending")).toHaveText("");
  await expect(sa.locator("#aAudit")).toContainText("підтвердив або розблокував");

  // Суддя входить; пульт показує пункт «Акаунт і мої матчі».
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

  // Блокування — суддя одразу без доступу.
  await row.locator("button", { hasText: "Заблокувати" }).click();
  await judge.reload();
  await expect(judge.locator("#guest")).toBeVisible();
  await login(judge, "ivan@test.ua", "volley-2026");
  await expect(judge.locator("#lMsg")).toContainText("заблоковано");

  // Прибирання заблокованих — рядок зникає.
  await sa.click("#aCleanBlocked");
  await expect(sa.locator("#aCleanMsg")).toHaveText("Видалено: 1");
  await expect(row).toHaveCount(0);

  await sa.goto(server.url + "/account.html");
  await sa.click("#uLogout");
  await expect(sa.locator("#guest")).toBeVisible();
});

test("адмін не керує людьми; скидання пароля за посиланням; зміна свого пароля", async ({ browser }) => {
  const olha = await page(browser);
  await register(olha, "Ольга Бондар", "olha@test.ua", "first-pass-1");

  const sa = await superadmin(browser);
  const row = sa.locator(".user", { hasText: "olha@test.ua" });
  await row.locator("button", { hasText: "Підтвердити" }).click();
  await row.locator("button", { hasText: "Зробити адміном" }).click();
  await expect(row.locator(".badge.admin")).toHaveText("адмін");
  await expect(sa.locator(".user", { hasText: "admin@test.ua" }).locator("button")).toHaveCount(0);   // себе не чіпає

  // Адмін: посилання на панель немає, а сама панель — «Немає доступу».
  await login(olha, "olha@test.ua", "first-pass-1");
  await expect(olha.locator("#uRole")).toHaveText("адмін");
  await expect(olha.locator("#uAdmin")).toBeHidden();
  await expect(olha.locator("#uAdminNote")).toBeVisible();
  await olha.goto(server.url + "/admin.html");
  await expect(olha.locator("#aDenied")).toBeVisible();
  await expect(olha.locator("#aBody")).toBeHidden();

  // Ольга забула пароль: суперадмін видає посилання.
  await row.locator("button", { hasText: "Скинути пароль" }).click();
  await expect(sa.locator("#aReset")).toBeVisible();
  await expect(sa.locator("#aResetWho")).toHaveText("Ольга Бондар");
  const link = await sa.locator("#aResetUrl").textContent();
  expect(link).toMatch(/\/account\.html#reset=[\w-]{20,}$/);

  const fresh = await page(browser);
  await fresh.goto(link);
  await expect(fresh.locator("#reset")).toBeVisible();
  await expect(fresh).toHaveURL(/account\.html$/);                 // токен прибрано з адресного рядка
  await fresh.fill("#nPass", "second-pass-2");
  await fresh.fill("#nPass2", "second-pass-2");
  await fresh.click("#nBtn");
  await expect(fresh.locator("#lMsg")).toContainText("Пароль змінено");
  await login(fresh, "olha@test.ua", "second-pass-2");
  await expect(fresh.locator("#uName")).toHaveText("Ольга Бондар");

  // Посилання одноразове.
  const again = await page(browser);
  await again.goto(link);
  await again.fill("#nPass", "third-pass-3");
  await again.fill("#nPass2", "third-pass-3");
  await again.click("#nBtn");
  await expect(again.locator("#nMsg")).toContainText("Посилання недійсне");

  // Старий сеанс Ольги після скидання закрито.
  await olha.goto(server.url + "/account.html");
  await expect(olha.locator("#guest")).toBeVisible();

  // Зміна свого пароля.
  await fresh.fill("#pOld", "wrong-pass-0");
  await fresh.fill("#pNew", "fourth-pass-4");
  await fresh.click("#pBtn");
  await expect(fresh.locator("#pMsg")).toContainText("Поточний пароль неправильний");
  await fresh.fill("#pOld", "second-pass-2");
  await fresh.fill("#pNew", "fourth-pass-4");
  await fresh.click("#pBtn");
  await expect(fresh.locator("#pMsg")).toHaveText("Пароль змінено.");
  await fresh.reload();
  await expect(fresh.locator("#uName")).toHaveText("Ольга Бондар", { timeout: 5000 });   // цей сеанс лишився

  // Зняти адміна й видалити.
  await sa.reload();
  await row.locator("button", { hasText: "Зняти адміна" }).click();
  await expect(row.locator(".badge.referee")).toHaveText("суддя");
  await row.locator("button", { hasText: "Видалити" }).click();
  await expect(row).toHaveCount(0);
  await expect(sa.locator("#aAudit")).toContainText("видалив");
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

/* Український текст, що лишився на сторінці (крім імен і email — translate="no"). */
function leftovers(p) {
  return p.evaluate(() => {
    const out = [], w = document.createTreeWalker(document.body, 4);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || /SCRIPT|STYLE/.test(el.tagName) || el.closest('[translate="no"]') || el.closest("[hidden]")) continue;
      const t = n.nodeValue.replace(/\s+/g, " ").trim();
      if (/[А-Яа-яЇїІіЄєҐґ]/.test(t)) out.push(t);
    }
    if (/[А-Яа-яЇїІіЄєҐґ]/.test(document.title)) out.push("title: " + document.title);
    return out;
  });
}

test("акаунт і панель суперадміна англійською — без українського тексту", async ({ browser }) => {
  const judge = await page(browser);
  await register(judge, "Іван Коваль", "ivan@test.ua", "volley-2026");

  const sa = await page(browser);
  await sa.goto(server.url + "/account.html?lang=en");
  await login(sa, "admin@test.ua", "admin-pass-1");
  await expect(sa.locator("#uRole")).toHaveText("superadmin");
  expect(await leftovers(sa)).toEqual([]);
  await sa.click("#uAdmin");
  const row = sa.locator(".user", { hasText: "ivan@test.ua" });
  await row.locator("button", { hasText: "Approve" }).click();
  await row.locator("button", { hasText: "Make admin" }).click();
  await row.locator("button", { hasText: "Reset password" }).click();
  await expect(sa.locator("#aReset")).toBeVisible();
  await sa.click("#aCleanStale");
  await expect(sa.locator("#aCleanMsg")).toHaveText("Removed: 0");
  await expect(sa.locator("#aAudit .row")).toHaveCount(5);
  expect(await leftovers(sa)).toEqual([]);

  const link = await sa.locator("#aResetUrl").textContent();
  await judge.goto(server.url + "/account.html?lang=en");
  await judge.goto(link);
  await expect(judge.locator("#reset")).toBeVisible();
  expect(await leftovers(judge)).toEqual([]);
  await judge.fill("#nPass", "second-pass-2");
  await judge.fill("#nPass2", "second-pass-3");
  await judge.click("#nBtn");
  await expect(judge.locator("#nMsg")).toHaveText("Passwords do not match.");
  await judge.fill("#nPass", "second-pass-2");
  await judge.fill("#nPass2", "second-pass-2");
  await judge.click("#nBtn");
  await login(judge, "ivan@test.ua", "second-pass-2");
  await expect(judge.locator("#uRole")).toHaveText("admin");
  expect(await leftovers(judge)).toEqual([]);
});
