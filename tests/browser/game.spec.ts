import { test, expect, type Page } from "@playwright/test";
import { difficultyDuration } from "../../client/src/game/difficulty";
import { reactionLines } from "../../client/src/game/commentary";
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
    "Искра. Немедленно отключи [ПИП].",
    "Привет. Как дела? Отключи [ПИП].",
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
  await expect(page.locator(".live-commentary")).toHaveCount(0);
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
  await expect(page.locator(".live-commentary")).toHaveCount(0);
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
  await expect(page.locator(".live-commentary")).toHaveCount(0);
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
    await expect(page.locator(".live-commentary")).toHaveCount(0);
    const failed = await saved(page);
    expect(failed.failedAttempts).toBe(attempt);
    expect(failed.runningSince).toBeNull();
    await page.reload();
    await expect(page.locator(".live-commentary")).toHaveCount(0);
    await flushChat(page);
    await page.clock.fastForward(120000);
    expect((await saved(page)).remaining).toBe(failed.remaining);
    if (attempt < 5)
      await page
        .getByRole("button", { name: `Попытка ${attempt + 1} из 5` })
        .click();
  }
  await expect(
    page.getByRole("heading", { name: "[ПИП] контент." }),
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
  await page.clock.fastForward(
    difficultyDuration((await saved(page)).difficulty) + 1,
  );
  expect((await saved(page)).board).toEqual(boardBeforeBonus);
  await expect(page.locator(".mine-cell.mine")).toHaveCount(0);
  expect((await saved(page)).bonusGranted).toBe(true);
  expect((await saved(page)).runningSince).toBeNull();
  await expect(page.locator(".live-commentary")).toHaveCount(0);
  await expect(page.locator(".mine-cell").first()).toBeDisabled();
  await flushChat(page);
  expect((await saved(page)).remaining).toBe(60000);
  // The gift must not reveal mines or reset an existing field.
  await page.clock.fastForward(60001);
  await flushChat(page);
  await expect(
    page.getByRole("heading", { name: "[ПИП] контент." }),
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
  const comment = page.locator(".commentary-caption p");
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

// Sizes are the page area left after address/status/navigation bars, not the phone's screen.
const smallViewports = [
  { width: 320, height: 480 },
  { width: 360, height: 560 },
  { width: 393, height: 650 },
  { width: 412, height: 735 },
];
async function expectUsableField(page: Page) {
  // Let ResizeObserver and scroll positioning settle after browser-bar changes.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const grid = document
          .querySelector(".mine-grid")!
          .getBoundingClientRect();
        const frame = document
          .querySelector(".board-frame")!
          .getBoundingClientRect();
        const viewport = document
          .querySelector(".chat-viewport")!
          .getBoundingClientRect();
        const caption = document
          .querySelector(".live-commentary")!
          .getBoundingClientRect();
        return (
          grid.bottom <= frame.bottom + 1 &&
          grid.y >= frame.y - 1 &&
          grid.y >= viewport.y - 1 &&
          grid.bottom <= Math.min(viewport.bottom, caption.y) + 1 &&
          caption.bottom <= window.innerHeight + 1
        );
      }),
    )
    .toBe(true);
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      grid: rect(".mine-grid"),
      modes: rect(".mode-switch"),
      viewport: rect(".chat-viewport"),
      caption: rect(".live-commentary"),
      last: rect(".mine-cell:last-child"),
      width: document.documentElement.scrollWidth,
      height: window.innerHeight,
      screenWidth: window.innerWidth,
      bodyHeight: document.documentElement.scrollHeight,
    };
  });
  expect(geometry.width).toBe(geometry.screenWidth);
  expect(geometry.bodyHeight).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.grid.y).toBeGreaterThanOrEqual(geometry.viewport.y - 1);
  expect(geometry.grid.bottom).toBeLessThanOrEqual(geometry.caption.y + 1);
  expect(geometry.caption.bottom).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.modes.y).toBeGreaterThanOrEqual(geometry.viewport.y - 1);
  expect(geometry.last.width).toBeGreaterThanOrEqual(25);
  expect(Math.abs(geometry.last.width - geometry.last.height)).toBeLessThan(2);
  const last = page.locator(".mine-cell").last();
  await last.click({ trial: true });
}

for (const viewport of smallViewports) {
  test(`browser chrome leaves ${viewport.width}x${viewport.height}: all levels fit and resize`, async ({
    page,
  }, info) => {
    // One responsive matrix per browser engine; the standard mobile tests also exercise touch.
    test.skip(info.project.name !== "mobile");
    await page.setViewportSize(viewport);
    await enterBoard(page, 2);
    await expectUsableField(page);
    await solve(page); // Hard → 8x8 encore. Test the densest board as well.
    expect((await saved(page)).phase).toBe("encore");
    await page.locator(".reply-panel button").first().click();
    await flushChat(page);
    await expect(page.locator(".mine-cell")).toHaveCount(64);
    await expectUsableField(page);
    const text = page.locator(".commentary-caption p");
    await page.clock.fastForward(16000); // A longer waiting caption must not cover the field.
    await expectUsableField(page);
    expect(
      await text.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`compact-${viewport.width}.png`),
      animations: "disabled",
    });
    const before = await saved(page);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height + 85,
    });
    await expectUsableField(page);
    await page.setViewportSize(viewport);
    await expectUsableField(page);
    expect((await saved(page)).board).toEqual(before.board);
    // Even on the smallest screen a bottom corner is a real touch target.
    await page.getByRole("button", { name: "Флажок", exact: false }).click();
    await page.locator(".mine-cell").last().tap();
    expect((await saved(page)).board.flags).toEqual([63]);
  });
}

test("reduced motion disables streamer effects, and help remains usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 560 });
  await enterBoard(page, 1);
  await expectUsableField(page);
  expect(
    await page
      .locator(".stream-camera")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.getByText("Как играть?", { exact: true }).click();
  await expect(page.locator(".game-help")).toHaveAttribute("open", "");
  await page.getByText("Как играть?", { exact: true }).click();
  await expectUsableField(page);
});

test("long captions fit without moving the cells; bonus HUD also fits", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile");
  await page.setViewportSize({ width: 320, height: 480 });
  await enterBoard(page, 2);
  const longest = Object.values(reactionLines)
    .flat()
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  let lastGridHeight: number | undefined;
  for (const text of longest) {
    const state = await saved(page);
    state.commentary.text = text;
    await page.evaluate(
      ({ key, state }) => sessionStorage.setItem(key, JSON.stringify(state)),
      { key: STORAGE_KEY, state },
    );
    await page.reload();
    await expectUsableField(page);
    const caption = await page.locator(".commentary-caption p").boundingBox();
    const cameraPanel = await page.locator(".live-commentary").boundingBox();
    expect(caption!.y + caption!.height).toBeLessThanOrEqual(
      cameraPanel!.y + cameraPanel!.height - 5,
    );
    const height = (await page.locator(".mine-grid").boundingBox())!.height;
    if (lastGridHeight !== undefined) expect(height).toBe(lastGridHeight);
    lastGridHeight = height;
  }
  await page.clock.fastForward(
    difficultyDuration((await saved(page)).difficulty) + 1,
  );
  await expect(page.locator(".live-commentary")).toHaveCount(0);
  await flushChat(page);
  await expectUsableField(page);
  await page.screenshot({
    path: info.outputPath("small-bonus.png"),
    animations: "disabled",
  });
});

test("each selected difficulty has its own visible timer and the encore adds only one minute", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile");
  for (const [level, minutes] of [3, 4, 5].entries()) {
    await page.goto("/");
    await page.evaluate((key) => sessionStorage.removeItem(key), STORAGE_KEY);
    await enterBoard(page, level);
    const game = await saved(page);
    expect(game.remaining).toBe(minutes * 60000);
    await expect(page.locator(".mission-bar strong")).toHaveText(
      `0${minutes}:00`,
    );
    const fraction = await page
      .locator(".timer-track span")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().width /
          el.parentElement!.getBoundingClientRect().width,
      );
    expect(fraction).toBeGreaterThan(0.99);
    await page.clock.fastForward(10000);
    await page.reload();
    await expect(page.locator(".mission-bar strong")).toHaveText(
      new RegExp(`0${minutes - 1}:4[89]|0${minutes - 1}:50`),
    );
    await solve(page);
    const next = await saved(page);
    expect(next.phase).toBe("encore");
    expect(next.remaining).toBeGreaterThan((minutes + 1) * 60000 - 20000);
    expect(next.remaining).toBeLessThan((minutes + 1) * 60000 - 9000);
  }
});

test("tall phones show hints without blank space or overlapping help; messages keep their padding after a board", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile");
  await page.setViewportSize({ width: 412, height: 915 });
  await enterBoard(page, 1);
  await expect(page.locator(".board-tips")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)!.getBoundingClientRect().toJSON();
    return {
      grid: box(".mine-grid"),
      modes: box(".mode-switch"),
      help: box(".game-help summary"),
      tips: box(".board-tips"),
      panel: box(".mine-panel"),
    };
  });
  expect(geometry.grid.y - geometry.modes.bottom).toBeLessThan(12);
  expect(geometry.help.bottom).toBeLessThanOrEqual(geometry.modes.y);
  expect(geometry.tips.y - geometry.grid.bottom).toBeLessThan(5);
  expect(geometry.panel.bottom - geometry.tips.bottom).toBeLessThan(15);
  await page.screenshot({
    path: info.outputPath("tall-phone-hints.png"),
    animations: "disabled",
  });
  await page.clock.fastForward(240001);
  await flushChat(page);
  // Once the gifted minute starts the message below the field remains part of the history.
  await page
    .locator(".message-history > .chat-message")
    .last()
    .scrollIntoViewIfNeeded();
  const spacing = await page.evaluate(() => {
    const board = document
      .querySelector(".mine-panel")!
      .getBoundingClientRect();
    const message = document
      .querySelector(".board-slot + .chat-message")!
      .getBoundingClientRect();
    return {
      vertical: message.y - board.bottom,
      left: message.x,
      right: innerWidth - message.right,
    };
  });
  expect(spacing.vertical).toBeGreaterThanOrEqual(18);
  expect(spacing.left).toBeGreaterThanOrEqual(12);
  expect(spacing.right).toBeGreaterThanOrEqual(12);
  await page.screenshot({
    path: info.outputPath("message-after-field.png"),
    animations: "disabled",
  });
});
