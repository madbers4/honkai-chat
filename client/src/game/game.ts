import {
  attitudeTaunts,
  dialogue,
  mistakeTaunts,
  type Attitude,
} from "./dialogue";
import {
  emptyBoard,
  isSolved,
  reveal,
  toggleFlag,
  type Board,
} from "./minesweeper";

export const DURATION_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export type Phase =
  "welcome" | "dialogue" | "playing" | "retry" | "won" | "lost";
export interface Message {
  id: number;
  author: "sparxie" | "trailblazer" | "system";
  text: string;
}
export interface Game {
  version: 1;
  id: string;
  seed: number;
  phase: Phase;
  node: string;
  attitude: Attitude;
  startedAt: number | null;
  deadline: number | null;
  finishedAt: number | null;
  failedAttempts: number;
  lossReason: "time" | "mines" | null;
  board: Board;
  boardMessageIndex: number | null;
  messages: Message[];
}

export type Action =
  | { type: "start" }
  | { type: "reply"; node: string; index: number }
  | { type: "reveal"; cell: number }
  | { type: "flag"; cell: number }
  | { type: "retry" }
  | { type: "tick" };

export function createGame(id: string, seed: number): Game {
  return {
    version: 1,
    id,
    seed,
    phase: "welcome",
    node: "hello",
    attitude: "hero",
    startedAt: null,
    deadline: null,
    finishedAt: null,
    failedAttempts: 0,
    lossReason: null,
    board: emptyBoard(),
    boardMessageIndex: null,
    messages: [],
  };
}

function say(game: Game, author: Message["author"], ...lines: string[]): Game {
  return {
    ...game,
    messages: [
      ...game.messages,
      ...lines.map((text, i) => ({
        id: game.messages.length + i,
        author,
        text,
      })),
    ],
  };
}

export const isActive = (game: Game): boolean =>
  ["dialogue", "playing", "retry"].includes(game.phase);

export function remainingMs(game: Game, now: number): number {
  if (game.deadline === null) return DURATION_MS;
  return Math.max(0, game.deadline - (game.finishedAt ?? now));
}

function expire(game: Game, now: number): Game {
  if (!isActive(game) || game.deadline === null || now < game.deadline)
    return game;
  return say(
    { ...game, phase: "lost", lossReason: "time", finishedAt: game.deadline },
    "sparxie",
    "Время! Чат, встречаем самый пунктуальный участник нашего эфира — ВЗРЫВ!",
    "Конфетти по всей площадке. Лягушка невредима, режиссёр пересматривает жизненные решения. А ты теперь звезда моей нарезки ♥",
  );
}

export function transition(current: Game, action: Action, now: number): Game {
  const game = expire(current, now);
  if (action.type === "tick" || game.phase === "won" || game.phase === "lost")
    return game;

  if (action.type === "start" && game.phase === "welcome") {
    return say(
      {
        ...game,
        phase: "dialogue",
        startedAt: now,
        deadline: now + DURATION_MS,
      },
      "sparxie",
      ...dialogue.hello.lines,
    );
  }

  if (
    action.type === "reply" &&
    game.phase === "dialogue" &&
    action.node === game.node
  ) {
    const option = dialogue[game.node]?.replies[action.index];
    if (!option) return game;
    let next = say(
      { ...game, attitude: option.attitude ?? game.attitude },
      "trailblazer",
      option.text,
    );
    if (option.next === "game") {
      const opened = say(
        { ...next, phase: "playing" },
        "sparxie",
        "Панель открыта. Чат, делаем прогнозы! А ты смотри на цифры. Любоваться мной будешь после победы.",
      );
      return { ...opened, boardMessageIndex: opened.messages.length };
    }
    next = { ...next, node: option.next };
    return say(next, "sparxie", ...dialogue[option.next].lines);
  }

  if (
    action.type === "retry" &&
    game.phase === "retry" &&
    game.failedAttempts < MAX_ATTEMPTS
  ) {
    const next = say(
      { ...game, phase: "playing", board: emptyBoard() },
      "system",
      `Попытка ${game.failedAttempts + 1} из ${MAX_ATTEMPTS}. Новое поле, прежний таймер.`,
    );
    return { ...next, boardMessageIndex: next.messages.length };
  }

  if (game.phase !== "playing") return game;
  if (action.type === "flag") {
    const board = toggleFlag(game.board, action.cell);
    return board === game.board ? game : { ...game, board };
  }
  if (action.type !== "reveal") return game;
  const board = reveal(
    game.board,
    action.cell,
    (game.seed + game.failedAttempts * 104729) >>> 0,
  );
  if (board === game.board) return game;
  if (board.exploded !== null) {
    const failedAttempts = game.failedAttempts + 1;
    const last = failedAttempts >= MAX_ATTEMPTS;
    let next = say(
      {
        ...game,
        board,
        failedAttempts,
        phase: last ? "lost" : "retry",
        lossReason: last ? "mines" : null,
        finishedAt: last ? now : null,
      },
      "sparxie",
      mistakeTaunts[failedAttempts - 1],
    );
    if (failedAttempts === 1 || failedAttempts === 3)
      next = say(next, "sparxie", attitudeTaunts[game.attitude]);
    if (last)
      next = say(
        next,
        "sparxie",
        "Реквизит хлопнул конфетти. Ни одна лягушка не пострадала. Съёмочная группа просит больше так не рекламировать газировку.",
      );
    return next;
  }
  if (isSolved(board)) {
    return say(
      { ...game, board, phase: "won", finishedAt: now },
      "sparxie",
      "Чат?.. Он это сделал. Все безопасные клетки открыты. Бомба выключена.",
      "Ладно, этот момент оставляем целиком. Без монтажа. Ты заслужил свои аплодисменты, Первопроходец ♥",
      "Съёмка «Услады» спасена. Иди за печатью, пока режиссёр не назначил тебя ответственным за весь реквизит.",
    );
  }
  return { ...game, board };
}
