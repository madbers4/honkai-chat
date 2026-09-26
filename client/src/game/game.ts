import { emptyCommentary, observe, type Commentary } from "./commentary";
import {
  difficulties,
  difficultyDuration,
  difficultyTimeLabel,
  nextDifficulty,
  type Difficulty,
} from "./difficulty";
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

export const BONUS_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const FAST_WIN_MS = 60 * 1000;
export const MESSAGE_GAP_MS = 350;
export type Phase =
  "welcome" | "dialogue" | "encore" | "playing" | "retry" | "won" | "lost";
export interface Message {
  id: number;
  author: "sparxie" | "trailblazer" | "system";
  text: string;
}
export interface Game {
  version: 4;
  commentary: Commentary;
  id: string;
  seed: number;
  phase: Phase;
  node: string;
  attitude: Attitude;
  difficulty: Difficulty;
  encoreGranted: boolean;
  startedAt: number | null;
  runningSince: number | null;
  remaining: number;
  finishedAt: number | null;
  failedAttempts: number;
  bonusGranted: boolean;
  lossReason: "time" | "mines" | null;
  board: Board;
  boardMessageIndex: number | null;
  messages: Message[];
  pending: string[];
  typingAt: number | null;
  messageAt: number | null;
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
    version: 4,
    commentary: emptyCommentary(),
    id,
    seed,
    phase: "welcome",
    node: "hello",
    attitude: "hero",
    difficulty: "easy",
    encoreGranted: false,
    startedAt: null,
    runningSince: null,
    remaining: difficultyDuration("easy"),
    finishedAt: null,
    failedAttempts: 0,
    bonusGranted: false,
    lossReason: null,
    board: emptyBoard(),
    boardMessageIndex: null,
    messages: [],
    pending: [],
    typingAt: null,
    messageAt: null,
  };
}

export const attemptLimit = (game: Game): number =>
  MAX_ATTEMPTS + (game.bonusGranted ? 1 : 0);
export const isActive = (game: Game): boolean =>
  game.phase === "playing" && game.runningSince !== null;
export const typingDuration = (text: string): number =>
  Math.min(800 + text.length * 35, 3500) / 2;

export function remainingMs(game: Game, now: number): number {
  return Math.max(
    0,
    game.remaining -
      (isActive(game) ? Math.max(0, now - game.runningSince!) : 0),
  );
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

function pause(game: Game, now: number): Game {
  return { ...game, remaining: remainingMs(game, now), runningSince: null };
}

function queue(game: Game, now: number, ...lines: string[]): Game {
  const pending = [...game.pending, ...lines];
  const typingAt = game.typingAt ?? now + MESSAGE_GAP_MS;
  return {
    ...pause(game, now),
    pending,
    typingAt,
    messageAt: game.messageAt ?? typingAt + typingDuration(pending[0]),
  };
}

function resumeBoard(game: Game, now: number): Game {
  return {
    ...game,
    runningSince: now,
    startedAt: game.startedAt ?? now,
    boardMessageIndex: game.boardMessageIndex ?? game.messages.length,
  };
}

function deliver(game: Game, now: number): Game {
  if (game.messageAt === null || now < game.messageAt || !game.pending.length)
    return game;
  let next = say(game, "sparxie", game.pending[0]);
  const pending = game.pending.slice(1);
  const typingAt = pending.length ? now + MESSAGE_GAP_MS : null;
  next = {
    ...next,
    pending,
    typingAt,
    messageAt: typingAt === null ? null : typingAt + typingDuration(pending[0]),
  };
  if (!pending.length && next.phase === "playing")
    next = resumeBoard(next, now);
  return next;
}

function expire(game: Game, now: number): Game {
  if (!isActive(game) || remainingMs(game, now) > 0) return game;
  const paused = pause(game, now);
  if (!game.bonusGranted) {
    return queue(
      { ...paused, bonusGranted: true, remaining: BONUS_MS },
      now,
      "Стоп, чат! На таком моменте эфир не заканчивают. Дарю ещё минуту и одну попытку. Только один раз — хочу красивый камбэк ♥",
    );
  }
  return queue(
    { ...paused, phase: "lost", lossReason: "time", finishedAt: now },
    now,
    "Всё, даже подаренная минута закончилась! Чат, встречаем финальный спецэффект — —!",
    "Раунд проигран. Режиссёр пересматривает жизненные решения, а ты теперь звезда моей нарезки ♥",
  );
}

function advance(current: Game, action: Action, now: number): Game {
  const game = deliver(expire(current, now), now);
  if (
    action.type === "tick" ||
    game.pending.length ||
    game.phase === "won" ||
    game.phase === "lost"
  )
    return game;

  if (action.type === "start" && game.phase === "welcome") {
    return queue({ ...game, phase: "dialogue" }, now, ...dialogue.hello.lines);
  }

  if (
    action.type === "reply" &&
    (game.phase === "dialogue" || game.phase === "encore") &&
    action.node === game.node
  ) {
    const option = dialogue[game.node]?.replies[action.index];
    if (!option) return game;
    const next = say(
      {
        ...game,
        attitude: option.attitude ?? game.attitude,
        difficulty: option.difficulty ?? game.difficulty,
      },
      "trailblazer",
      option.text,
    );
    if (option.next === "game") {
      const level = difficulties[next.difficulty];
      return queue(
        {
          ...next,
          phase: "playing",
          remaining:
            game.phase === "encore" ? next.remaining : level.durationMs,
          board: emptyBoard(next.difficulty),
          boardMessageIndex: null,
        },
        now,
        game.phase === "encore"
          ? `Это не жульничество, это продление сезона! «${level.label}»: ${level.size} × ${level.size}, мин — ${level.mineCount}. После этого поля точно отпущу. Обещаю. Слышишь, чат?`
          : `«${level.label}» принят! Поле ${level.size} × ${level.size}, мин — ${level.mineCount}. Панель открыта, ${difficultyTimeLabel(next.difficulty)} пошли. Любоваться мной будешь после победы.`,
      );
    }
    return queue(
      { ...next, node: option.next },
      now,
      ...dialogue[option.next].lines,
    );
  }

  if (
    action.type === "retry" &&
    game.phase === "retry" &&
    game.failedAttempts < attemptLimit(game)
  ) {
    const next = say(
      {
        ...game,
        phase: "playing",
        board: emptyBoard(game.difficulty),
        boardMessageIndex: null,
      },
      "system",
      `Попытка ${game.failedAttempts + 1} из ${attemptLimit(game)}. Новое поле, оставшееся время.`,
    );
    return resumeBoard(next, now);
  }

  if (!isActive(game)) return game;
  if (action.type === "flag") {
    const board = toggleFlag(game.board, action.cell);
    return board === game.board ? game : { ...game, board };
  }
  if (action.type !== "reveal") return game;
  const board = reveal(
    game.board,
    action.cell,
    (game.seed +
      game.failedAttempts * 104729 +
      (game.encoreGranted ? 999983 : 0)) >>>
      0,
  );
  if (board === game.board) return game;
  if (board.exploded !== null) {
    const failedAttempts = game.failedAttempts + 1;
    const last = failedAttempts >= attemptLimit(game);
    const lines = [
      last
        ? "Попытки закончились. Чат, финал сезона — БУМ! Спасибо, что были с Искрой ♥"
        : mistakeTaunts[failedAttempts - 1],
    ];
    if (failedAttempts === 1 || failedAttempts === 3)
      lines.push(attitudeTaunts[game.attitude]);
    if (last)
      lines.push(
        "— сработала. Раунд за мной! Съёмочная группа просит больше так не рекламировать газировку.",
      );
    return queue(
      {
        ...game,
        board,
        failedAttempts,
        phase: last ? "lost" : "retry",
        remaining: remainingMs(game, now),
        runningSince: null,
        lossReason: last ? "mines" : null,
        finishedAt: last ? now : null,
      },
      now,
      ...lines,
    );
  }
  if (isSolved(board)) {
    const paused = pause(game, now);
    if (
      !game.encoreGranted &&
      !game.bonusGranted &&
      game.failedAttempts === 0 &&
      difficultyDuration(game.difficulty) - paused.remaining < FAST_WIN_MS
    ) {
      const difficulty = nextDifficulty[game.difficulty];
      const level = difficulties[difficulty];
      return queue(
        {
          ...paused,
          phase: "encore",
          node: "encore",
          difficulty,
          remaining:
            paused.remaining +
            level.durationMs -
            difficultyDuration(game.difficulty),
          encoreGranted: true,
          board: emptyBoard(difficulty),
          boardMessageIndex: null,
        },
        now,
        "Стой. СТОЙ. С первой попытки?! Даже минуты не прошло! Чат, я ещё превью не выбрала!",
        `Так. Я совершенно спокойна. Просто это был… пробный выпуск! Повышаю сложность: «${level.label}», ${level.size} × ${level.size}, мин — ${level.mineCount}. Ещё одно поле. ОДНО.`,
        "Добавляю минуту за новый уровень. Потраченное время не обнуляется, попытки остаются. Сейчас отдышусь — и продолжим. Не смей писать, что у ведущей паника.",
      );
    }
    return queue(
      { ...pause(game, now), board, phase: "won", finishedAt: now },
      now,
      "Чат?.. Он это сделал. Все безопасные клетки открыты. — выключена.",
      "Ладно, этот момент оставляем целиком. Без монтажа. Ты заслужил свои аплодисменты, Первопроходец ♥",
      "Съёмка «Услады» спасена. Иди за печатью, пока режиссёр не назначил тебя ответственным за весь реквизит.",
    );
  }
  return { ...game, board };
}

export function transition(current: Game, action: Action, now: number): Game {
  return observe(current, advance(current, action, now), action, now);
}
