import { difficulties, type Difficulty } from "./difficulty";

export interface Board {
  size: number;
  mineCount: number;
  mines: number[];
  revealed: number[];
  flags: number[];
  exploded: number | null;
}

export const emptyBoard = (difficulty: Difficulty = "easy"): Board => ({
  size: difficulties[difficulty].size,
  mineCount: difficulties[difficulty].mineCount,
  mines: [],
  revealed: [],
  flags: [],
  exploded: null,
});

export function neighbors(index: number, size = 5): number[] {
  const row = Math.floor(index / size);
  const col = index % size;
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const y = row + dy;
      const x = col + dx;
      if ((dx || dy) && y >= 0 && y < size && x >= 0 && x < size)
        result.push(y * size + x);
    }
  }
  return result;
}

export function adjacentMines(board: Board, index: number): number {
  return neighbors(index, board.size).filter((cell) =>
    board.mines.includes(cell),
  ).length;
}

function generateMines(first: number, seed: number, board: Board): number[] {
  const { size, mineCount } = board;
  const safe = new Set([first, ...neighbors(first, size)]);
  const cells = Array.from({ length: size * size }, (_, i) => i).filter(
    (i) => !safe.has(i),
  );
  let value = seed >>> 0;
  for (let i = cells.length - 1; i > 0; i--) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((value / 4294967296) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, mineCount);
}

export function reveal(board: Board, index: number, seed: number): Board {
  const { size } = board;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= size * size ||
    board.exploded !== null ||
    board.flags.includes(index) ||
    board.revealed.includes(index)
  )
    return board;
  const mines = board.mines.length
    ? board.mines
    : generateMines(index, seed, board);
  if (mines.includes(index)) return { ...board, mines, exploded: index };
  const visible = new Set(board.revealed);
  const queue = [index];
  while (queue.length) {
    const cell = queue.pop()!;
    if (visible.has(cell) || board.flags.includes(cell) || mines.includes(cell))
      continue;
    visible.add(cell);
    if (adjacentMines({ ...board, mines }, cell) === 0)
      queue.push(...neighbors(cell, size).filter((next) => !visible.has(next)));
  }
  return { ...board, mines, revealed: [...visible] };
}

export function toggleFlag(board: Board, index: number): Board {
  const { size, mineCount } = board;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= size * size ||
    board.exploded !== null ||
    board.revealed.includes(index)
  )
    return board;
  if (board.flags.includes(index))
    return { ...board, flags: board.flags.filter((i) => i !== index) };
  if (board.flags.length >= mineCount) return board;
  return { ...board, flags: [...board.flags, index] };
}

export const isSolved = (board: Board): boolean =>
  board.exploded === null &&
  board.revealed.length === board.size * board.size - board.mineCount;
