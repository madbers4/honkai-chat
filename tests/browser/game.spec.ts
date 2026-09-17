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

async function enterBoard(page: Page) {
  await page.addInitScript(
    ({ key, data }) => {
      if (!sessionStorage.getItem(key))
        sessionStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: createGame("browser-test", 12345) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в эфир" }).click();
  await page
    .getByRole("button", { name: "Искра. Немедленно отключи бомбу." })
    .click();
  await page
    .getByRole("button", { name: "Привет. Как дела? Отключи бомбу." })
    .click();
  await page
    .getByRole("button", { name: "Ты его получила. Давай инструкцию." })
    .click();
  await page.getByRole("button", { name: "Понял. Открывай панель." }).click();
  await expect(page.getByRole("group", { name: "Поле сапёра" })).toBeVisible();
}

test("mobile game wins, survives reload, and works offline without a backend", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterBoard(page);
  await page.locator(".mine-cell").nth(12).click();
  const before = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(before);
  await expect(page.locator(".mine-panel")).toBeVisible();
  await context.setOffline(true);
  for (let cell = 0; cell < 25; cell++) {
    if (
      !before.board.mines.includes(cell) &&
      !(await saved(page)).board.revealed.includes(cell)
    )
      await page.locator(".mine-cell").nth(cell).click();
  }
  await expect(
    page.getByRole("heading", { name: "Площадка спасена!" }),
  ).toBeVisible();
  await expect(page.getByText("и забери печать за Пенаконию.")).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("win.png"), fullPage: true });
});

test("five mines consume five attempts; retry and refresh cannot reset the clock", async ({
  page,
}, info) => {
  await enterBoard(page);
  const deadline = (await saved(page)).deadline;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.locator(".mine-cell").nth(12).click();
    const game = await saved(page);
    if (game.phase === "won")
      throw new Error("Test opening unexpectedly solved the board");
    await page.locator(".mine-cell").nth(game.board.mines[0]).click();
    const failed = await saved(page);
    expect(failed.failedAttempts).toBe(attempt);
    expect(failed.deadline).toBe(deadline);
    await page.reload();
    expect((await saved(page)).failedAttempts).toBe(attempt);
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
  });
  await page.getByRole("button", { name: "Начать новую игру" }).click();
  await expect(
    page.getByRole("button", { name: "Войти в эфир" }),
  ).toBeVisible();
});

test("timeout during chat ends the story; independent tabs have independent sessions", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в эфир" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("button", { name: "Войти в эфир" }),
  ).toBeVisible();
  await page.clock.fastForward(300001);
  await expect(
    page.getByRole("heading", { name: "Взрывной контент." }),
  ).toBeVisible();
  expect((await saved(page)).lossReason).toBe("time");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Взрывной контент." }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Войти в эфир" }),
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
  await page.screenshot({ path: info.outputPath("qr.png"), fullPage: true });
});

test("small screens keep choices and cells usable without horizontal overflow", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.screenshot({
    path: info.outputPath("welcome-small.png"),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await enterBoard(page);
  await page.getByRole("button", { name: "Флажок", exact: false }).click();
  await page.locator(".mine-cell").first().click();
  expect((await saved(page)).board.flags).toEqual([0]);
  await page.locator(".mine-cell").first().click();
  await page.getByRole("button", { name: "Открыть", exact: false }).click();
  await page.locator(".mine-cell").nth(12).click();
  expect((await saved(page)).board.revealed.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.screenshot({
    path: info.outputPath("board-small.png"),
    fullPage: true,
  });
});
