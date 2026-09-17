import { dialogue } from "./dialogue";
import { DURATION_MS, MAX_ATTEMPTS, type Game } from "./game";
import { MINE_COUNT, SIZE } from "./minesweeper";

export const STORAGE_KEY = "constanta.sparxie.game.v1";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const cells = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((i) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE) &&
  new Set(value).size === value.length;

// A stale or incomplete snapshot must never crash the guest's QR landing page.
export function parseGame(raw: string | null): Game | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      value.version !== 1 ||
      typeof value.id !== "string" ||
      !finite(value.seed)
    )
      return null;
    if (
      typeof value.phase !== "string" ||
      !["welcome", "dialogue", "playing", "retry", "won", "lost"].includes(
        value.phase,
      )
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
      (value.failedAttempts as number) > MAX_ATTEMPTS
    )
      return null;
    if (![null, "time", "mines"].includes(value.lossReason as null))
      return null;
    if (value.phase === "welcome") {
      if (value.startedAt !== null || value.deadline !== null) return null;
    } else if (
      !finite(value.startedAt) ||
      !finite(value.deadline) ||
      value.deadline - value.startedAt !== DURATION_MS
    )
      return null;
    const finished = value.phase === "won" || value.phase === "lost";
    if (finished ? !finite(value.finishedAt) : value.finishedAt !== null)
      return null;
    const board = value.board;
    if (
      !record(board) ||
      !cells(board.mines) ||
      !cells(board.revealed) ||
      !cells(board.flags)
    )
      return null;
    if (
      ![0, MINE_COUNT].includes(board.mines.length) ||
      board.flags.length > MINE_COUNT
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
    return value as unknown as Game;
  } catch {
    return null;
  }
}
