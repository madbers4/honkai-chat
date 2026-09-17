import { reactionLines } from "./commentary";
import { dialogue } from "./dialogue";
import { BONUS_MS, MAX_ATTEMPTS, type Game } from "./game";
import {
  difficulties,
  difficultyDuration,
  type Difficulty,
} from "./difficulty";

export const STORAGE_KEY = "constanta.sparxie.game.v3";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nullableTime = (value: unknown) => value === null || finite(value);
const cells = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) &&
  value.every((i) => Number.isInteger(i) && i >= 0 && i < size * size) &&
  new Set(value).size === value.length;

export function parseGame(raw: string | null): Game | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      ![3, 4].includes(value.version as number) ||
      typeof value.id !== "string" ||
      !finite(value.seed) ||
      typeof value.bonusGranted !== "boolean"
    )
      return null;
    if (
      typeof value.difficulty !== "string" ||
      !Object.hasOwn(difficulties, value.difficulty) ||
      typeof value.encoreGranted !== "boolean"
    )
      return null;
    const { size, mineCount, durationMs } =
      difficulties[value.difficulty as Difficulty];
    const legacy = value.version === 3;
    const budget = legacy ? 300000 : durationMs;
    if (
      typeof value.phase !== "string" ||
      ![
        "welcome",
        "dialogue",
        "encore",
        "playing",
        "retry",
        "won",
        "lost",
      ].includes(value.phase)
    )
      return null;
    if (typeof value.node !== "string" || !Object.hasOwn(dialogue, value.node))
      return null;
    if (
      !["hero", "deal", "chaos", "detective", "tired"].includes(
        value.attitude as string,
      )
    )
      return null;
    if (
      !Number.isInteger(value.failedAttempts) ||
      (value.failedAttempts as number) < 0 ||
      (value.failedAttempts as number) >
        MAX_ATTEMPTS + (value.bonusGranted ? 1 : 0)
    )
      return null;
    if (![null, "time", "mines"].includes(value.lossReason as null))
      return null;
    if (
      !finite(value.remaining) ||
      value.remaining < 0 ||
      value.remaining > (value.bonusGranted ? BONUS_MS : budget)
    )
      return null;
    if (
      !nullableTime(value.startedAt) ||
      !nullableTime(value.runningSince) ||
      !nullableTime(value.finishedAt)
    )
      return null;
    if (
      !Array.isArray(value.pending) ||
      value.pending.length > 20 ||
      !value.pending.every((line) => typeof line === "string")
    )
      return null;
    if (value.pending.length) {
      if (
        !finite(value.typingAt) ||
        !finite(value.messageAt) ||
        value.messageAt < value.typingAt ||
        value.runningSince !== null
      )
        return null;
    } else if (value.typingAt !== null || value.messageAt !== null) return null;
    if (value.phase === "welcome" || value.phase === "dialogue") {
      if (
        value.startedAt !== null ||
        value.runningSince !== null ||
        value.bonusGranted ||
        value.remaining !== budget
      )
        return null;
    }
    if (
      value.phase === "encore" &&
      (!value.encoreGranted ||
        value.node !== "encore" ||
        !finite(value.startedAt) ||
        value.runningSince !== null)
    )
      return null;
    if (
      value.runningSince !== null &&
      (value.phase !== "playing" || !finite(value.startedAt))
    )
      return null;
    if (
      value.phase === "playing" &&
      !value.pending.length &&
      value.runningSince === null
    )
      return null;
    const finished = value.phase === "won" || value.phase === "lost";
    if (finished ? !finite(value.finishedAt) : value.finishedAt !== null)
      return null;
    const commentary = value.commentary;
    if (
      !record(commentary) ||
      typeof commentary.text !== "string" ||
      typeof commentary.kind !== "string" ||
      !Object.hasOwn(reactionLines, commentary.kind)
    )
      return null;
    if (
      ![
        commentary.serial,
        commentary.lastAt,
        commentary.lastMoveAt,
        commentary.lastProgressAt,
        commentary.streak,
      ].every(finite)
    )
      return null;
    if (
      !Array.isArray(commentary.seen) ||
      commentary.seen.length > 100 ||
      !commentary.seen.every((id) => typeof id === "string")
    )
      return null;
    if (
      !Array.isArray(commentary.milestones) ||
      commentary.milestones.length > 40 ||
      !commentary.milestones.every((id) => typeof id === "string")
    )
      return null;
    const board = value.board;
    if (
      !record(board) ||
      !cells(board.mines, size) ||
      !cells(board.revealed, size) ||
      !cells(board.flags, size)
    )
      return null;
    if (board.size !== size || board.mineCount !== mineCount) return null;
    if (
      ![0, mineCount].includes(board.mines.length) ||
      board.flags.length > mineCount
    )
      return null;
    if (
      board.exploded !== null &&
      (!Number.isInteger(board.exploded) ||
        !board.mines.includes(board.exploded as number))
    )
      return null;
    const { mines, flags, revealed } = board;
    if (revealed.some((cell) => mines.includes(cell) || flags.includes(cell)))
      return null;
    if (
      !Array.isArray(value.messages) ||
      value.messages.length > 200 ||
      !value.messages.every(
        (message) =>
          record(message) &&
          Number.isInteger(message.id) &&
          ["sparxie", "trailblazer", "system"].includes(
            message.author as string,
          ) &&
          typeof message.text === "string",
      )
    )
      return null;
    if (
      value.boardMessageIndex !== null &&
      (!Number.isInteger(value.boardMessageIndex) ||
        (value.boardMessageIndex as number) < 0 ||
        (value.boardMessageIndex as number) > value.messages.length)
    )
      return null;
    if (legacy) {
      value.version = 4;
      if (!value.bonusGranted)
        value.remaining = Math.max(
          0,
          difficultyDuration(value.difficulty as Difficulty) -
            (300000 - value.remaining),
        );
    }
    return value as unknown as Game;
  } catch {
    return null;
  }
}
