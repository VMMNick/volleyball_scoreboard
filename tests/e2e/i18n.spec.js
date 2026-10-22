"use strict";

/* Англійська версія в справжньому браузері: перемикач у налаштуваннях і жодного українського тексту на сторінках. */
const { test, expect } = require("@playwright/test");
const { liveServer } = require("./helpers");

let server;
test.beforeEach(async () => { server = await liveServer(); });
test.afterEach(async () => { await server.stop(); });

const ALLOW = ["Мова / Language"];

/* Український текст, що лишився на сторінці (крім назв команд — translate="no"). */
function leftovers(page) {
  return page.evaluate((allow) => {
    const out = [];
    const w = document.createTreeWalker(document.documentElement, 4);
    let n;
    while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || /SCRIPT|STYLE/.test(el.tagName) || el.closest('[translate="no"]')) continue;
      const t = n.nodeValue.replace(/\s+/g, " ").trim();
      if (/[А-Яа-яЇїІіЄєҐґ]/.test(t) && !allow.includes(t)) out.push(t);
    }
    document.querySelectorAll("[title],[placeholder],[aria-label]").forEach((e) => ["title", "placeholder", "aria-label"].forEach((a) => {
      const v = e.getAttribute(a);
      if (v && /[А-Яа-яЇїІіЄєҐґ]/.test(v)) out.push("@" + a + ": " + v);
    }));
    if (/[А-Яа-яЇїІіЄєҐґ]/.test(document.title)) out.push("title: " + document.title);
    return out;
  }, ALLOW);
}

test("мова перемикається в налаштуваннях і запамʼятовується; англійською — без українського тексту", async ({ browser }) => {
  const ctx = await browser.newContext();
  const pult = await ctx.newPage();
  const dialogs = [];
  pult.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await pult.goto(server.url + "/index.html");
  await expect(pult.locator("#setsLog")).toHaveText("почати матч");

  await pult.click("#menuBtn");
  await pult.click("#mSettings");
  await Promise.all([pult.waitForNavigation(), pult.click("[data-lang=en]")]);
  await expect(pult.locator("#setsLog")).toHaveText("start match");
  await expect(pult.locator("html")).toHaveAttribute("lang", "en");
  await expect(pult.locator("#nameA")).toHaveText("Team A");

  // Короткий матч до кінця: сетбол, матчбол, тайм-аут, заміна, фінал.
  await pult.evaluate(() => {
    const m = window.Match.createMatch({ rules: { bestOf: 3, target: 3, decider: 3, winBy: 1 } });
    localStorage.setItem("volleyball:match", window.Match.serialize(m));
  });
  await pult.reload();
  const board = await ctx.newPage(); await board.goto(server.url + "/display.html");
  const mini = await ctx.newPage(); await mini.goto(server.url + "/mini.html");
  const live = await ctx.newPage(); await live.goto(server.url + "/live.html");
  const all = [pult, board, mini, live];
  const seen = new Set();
  const collect = async () => { for (const p of all) (await leftovers(p)).forEach((t) => seen.add(p.url().split("/").pop() + " → " + t)); };

  await collect();
  await pult.click("#sideA"); await pult.click("#sideA");
  await collect();
  await pult.click("#toA");
  await collect();
  await pult.keyboard.press("Escape");
  await pult.click("#menuBtn"); await pult.click("#mSubs");
  await pult.fill("#inSubOut", "3"); await pult.fill("#inSubIn", "9"); await pult.click("#subBtn");
  await collect();
  await pult.keyboard.press("Escape");
  await pult.click("#menuBtn"); await pult.click("#mProto");
  await collect();
  await pult.keyboard.press("Escape");
  for (const s of ["#sideA", "#sideB", "#sideB", "#sideB", "#sideA", "#sideA", "#sideA"]) await pult.click(s);
  await expect(pult.locator("#final")).toBeVisible({ timeout: 15000 });
  await collect();
  await pult.click("#finalNew");
  await pult.click("#menuBtn"); await pult.click("#mArchive");
  await collect();
  expect([...seen]).toEqual([]);
  expect(dialogs.every((m) => !/[А-Яа-яЇїІіЄєҐґ]/.test(m))).toBe(true);

  // Назад українською.
  await pult.keyboard.press("Escape");
  await pult.click("#menuBtn"); await pult.click("#mSettings");
  await Promise.all([pult.waitForNavigation(), pult.click("[data-lang=uk]")]);
  await expect(pult.locator("#setsLog")).toHaveText("почати матч");
  await ctx.close();
});

test("табло глядача мовою з адреси (?lang=en) на будь-якому пристрої", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(server.url + "/live.html?room=LANG23&lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await leftovers(page)).toEqual([]);
});
