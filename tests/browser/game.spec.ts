import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { STORAGE_KEY } from "../../client/src/game/storage";
import { createGame, type Game } from "../../client/src/game/game";

async function saved(page: Page): Promise<Game> {
  return page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    STORAGE_KEY,
  );
}
async function flushChat(page: Page) {
  for (let i = 0; i < 12; i++) {
    const state = await saved(page);
    if (!state.pending.length) return;
    const now = await page.evaluate(() => Date.now());
    await page.clock.fastForward(Math.max(250, state.messageAt! - now + 260));
  }
  throw new Error("Dialogue queue did not finish");
}
async function enterBoard(page: Page, level = 0) {
  await page.addInitScript(
    ({ key, data }) => {
      if (!sessionStorage.getItem(key))
        sessionStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: createGame("browser-test", 12345) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Войти на стрим" }).click();
  await flushChat(page);
  for (const name of [
    "Искра. Немедленно отключи бомбу.",
    "Привет. Как дела? Отключи бомбу.",
    "Ты его получила. Давай инструкцию.",
    "Понял. Открывай панель.",
  ]) {
    await page.getByRole("button", { name }).click();
    await flushChat(page);
  }
  await page.locator(".reply-panel button").nth(level).click();
  await flushChat(page);
  await expect(page.getByRole("group", { name: "Поле сапёра" })).toBeVisible();
}
async function solve(page: Page) {
  await page.locator(".mine-cell").first().click();
  const before = await saved(page);
  for (let cell = 0; cell < before.board.size ** 2; cell++) {
    const current = await saved(page);
    if (current.phase !== "playing") break;
    if (
      !before.board.mines.includes(cell) &&
      !current.board.revealed.includes(cell)
    )
      await page.locator(".mine-cell").nth(cell).click();
  }
  await flushChat(page);
}
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

test("fast victory leads to one harder encore; reload and offline play preserve the story", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterBoard(page);
  await page.locator(".mine-cell").first().click();
  const before = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(before);
  await expect(page.locator(".mine-panel")).toBeVisible();
  await context.setOffline(true);
  // Continue the already opened board.
  for (let cell = 0; cell < 25; cell++) {
    if ((await saved(page)).phase !== "playing") break;
    if (
      !before.board.mines.includes(cell) &&
      !(await saved(page)).board.revealed.includes(cell)
    )
      await page.locator(".mine-cell").nth(cell).click();
  }
  await flushChat(page);
  expect((await saved(page)).phase).toBe("encore");
  await expect(
    page.getByRole("heading", { name: "Площадка спасена!" }),
  ).toHaveCount(0);
  const remaining = (await saved(page)).remaining;
  await page.clock.fastForward(180000);
  expect((await saved(page)).remaining).toBe(remaining);
  await page
    .getByRole("button", { name: "Ладно. Только потом точно отпускаешь." })
    .click();
  await flushChat(page);
  expect((await saved(page)).board.size).toBe(6);
  await solve(page);
  await expect(
    page.getByRole("heading", { name: "Площадка спасена!" }),
  ).toBeVisible();
  await expect(page.getByText("и забери печать за Пенаконию.")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("win.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("five failures use five attempts; the clock pauses for messages and between retries", async ({
  page,
}, info) => {
  await enterBoard(page);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.locator(".mine-cell").first().click();
    const game = await saved(page);
    await page.locator(".mine-cell").nth(game.board.mines[0]).click();
    const failed = await saved(page);
    expect(failed.failedAttempts).toBe(attempt);
    expect(failed.runningSince).toBeNull();
    await page.reload();
    await flushChat(page);
    await page.clock.fastForward(120000);
    expect((await saved(page)).remaining).toBe(failed.remaining);
    if (attempt < 5)
      await page
        .getByRole("button", { name: `Попытка ${attempt + 1} из 5` })
        .click();
  }
  await expect(
    page.getByRole("heading", { name: "Взрывной контент." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Попытка/ })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("explosion.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Начать новую игру" }).click();
  await expect(
    page.getByRole("button", { name: "Войти на стрим" }),
  ).toBeVisible();
});

test("chat is untimed, messages type in sequence, game timeout gives a single bonus, tabs remain independent", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Войти на стрим" }).click();
  await page.clock.fastForward(500);
  await expect(
    page.getByRole("status", { name: "Искра печатает" }),
  ).toBeVisible();
  await expect(page.locator(".reply-panel")).toHaveCount(0);
  await expect(page.locator(".mission-bar")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("typing.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.clock.fastForward(600000);
  await flushChat(page);
  expect((await saved(page)).phase).toBe("dialogue");
  expect((await saved(page)).startedAt).toBeNull();
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("button", { name: "Войти на стрим" }),
  ).toBeVisible();
  // Follow the first reply route from the initial conversation.
  while ((await saved(page)).phase === "dialogue") {
    await page.locator(".reply-panel button").first().click();
    await flushChat(page);
  }
  await page.locator(".mine-cell").first().click();
  const boardBeforeBonus = (await saved(page)).board;
  await page.clock.fastForward(300001);
  expect((await saved(page)).board).toEqual(boardBeforeBonus);
  await expect(page.locator(".mine-cell.mine")).toHaveCount(0);
  expect((await saved(page)).bonusGranted).toBe(true);
  expect((await saved(page)).runningSince).toBeNull();
  await expect(page.locator(".mine-cell").first()).toBeDisabled();
  await flushChat(page);
  expect((await saved(page)).remaining).toBe(60000);
  // The gift must not reveal mines or reset an existing field.
  await page.clock.fastForward(60001);
  await flushChat(page);
  await expect(
    page.getByRole("heading", { name: "Взрывной контент." }),
  ).toBeVisible();
  await page.reload();
  expect((await saved(page)).lossReason).toBe("time");
  await expect(
    other.getByRole("button", { name: "Войти на стрим" }),
  ).toBeVisible();
});

test("the printed QR decodes to the supplied URL", async ({ page }, info) => {
  await page.goto("/?staff=1");
  const url = "https://festival.example/penaconia/";
  await page.getByRole("textbox", { name: "Адрес игры" }).fill(url);
  const qr = page.getByRole("img", { name: "QR-код входа в игру с Искрой" });
  await expect(qr).toBeVisible();
  const src = await qr.getAttribute("src");
  const png = PNG.sync.read(Buffer.from(src!.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toBe(url);
  await page
    .getByRole("textbox", { name: "Адрес игры" })
    .fill("javascript:alert(1)");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(qr).toHaveCount(0);
  await page.getByRole("textbox", { name: "Адрес игры" }).fill(url);
  await expect(qr).toBeVisible();
  await page.screenshot({
    path: info.outputPath("qr.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("320px screens fit the hardest normal board, controls and commentator", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page
    .locator(".entry-portrait")
    .evaluate((img: HTMLImageElement) => img.decode());
  await page.clock.fastForward(1200);
  await page.screenshot({
    path: info.outputPath("welcome-small.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await enterBoard(page, 2);
  await expect(page.locator(".mine-cell")).toHaveCount(49);
  await page.getByRole("button", { name: "Флажок", exact: false }).click();
  await page.locator(".mine-cell").first().click();
  expect((await saved(page)).board.flags).toEqual([0]);
  await page.locator(".mine-cell").first().click();
  await page.getByRole("button", { name: "Открыть", exact: false }).click();
  await page.locator(".mine-cell").first().click();
  expect((await saved(page)).board.revealed.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await expect(
    page.getByRole("complementary", { name: "Комментарии Искры" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("board-small.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("entry cover is clean and live commentary changes without blocking the board", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .locator(".entry-portrait")
    .evaluate((img: HTMLImageElement) => img.decode());
  await page.clock.fastForward(1200);
  await page.screenshot({
    path: info.outputPath("welcome.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.locator(".mission-bar")).toHaveCount(0);
  await enterBoard(page, 1);
  const comment = page.locator(".commentary-cloud p");
  const initial = await comment.textContent();
  await page.clock.fastForward(16000);
  await expect(comment).not.toHaveText(initial!);
  expect((await saved(page)).commentary.kind).toBe("idleStart");
  await expect(page.locator(".mine-cell").first()).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("commentator.png"),
    fullPage: true,
    animations: "disabled",
  });
});
