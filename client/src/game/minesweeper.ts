export const SIZE = 5;
export const MINE_COUNT = 4;

export interface Board {
  mines: number[];
  revealed: number[];
  flags: number[];
  exploded: number | null;
}

export const emptyBoard = (): Board => ({
  mines: [],
  revealed: [],
  flags: [],
  exploded: null,
});

export function neighbors(index: number): number[] {
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  const result: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const y = row + dy;
      const x = col + dx;
      if ((dx || dy) && y >= 0 && y < SIZE && x >= 0 && x < SIZE)
        result.push(y * SIZE + x);
    }
  }
  return result;
}

export function adjacentMines(board: Board, index: number): number {
  return neighbors(index).filter((cell) => board.mines.includes(cell)).length;
}

function generateMines(first: number, seed: number): number[] {
  const safe = new Set([first, ...neighbors(first)]);
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) => i).filter(
    (i) => !safe.has(i),
  );
  let value = seed >>> 0;
  for (let i = cells.length - 1; i > 0; i--) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((value / 4294967296) * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, MINE_COUNT);
}

export function reveal(board: Board, index: number, seed: number): Board {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= SIZE * SIZE ||
    board.exploded !== null ||
    board.flags.includes(index) ||
    board.revealed.includes(index)
  )
    return board;
  const mines = board.mines.length ? board.mines : generateMines(index, seed);
  if (mines.includes(index)) return { ...board, mines, exploded: index };
  const visible = new Set(board.revealed);
  const queue = [index];
  while (queue.length) {
    const cell = queue.pop()!;
    if (visible.has(cell) || board.flags.includes(cell) || mines.includes(cell))
      continue;
    visible.add(cell);
    if (adjacentMines({ ...board, mines }, cell) === 0)
      queue.push(...neighbors(cell).filter((next) => !visible.has(next)));
  }
  return { ...board, mines, revealed: [...visible] };
}

export function toggleFlag(board: Board, index: number): Board {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= SIZE * SIZE ||
    board.exploded !== null ||
    board.revealed.includes(index)
  )
    return board;
  if (board.flags.includes(index))
    return { ...board, flags: board.flags.filter((i) => i !== index) };
  if (board.flags.length >= MINE_COUNT) return board;
  return { ...board, flags: [...board.flags, index] };
}

export const isSolved = (board: Board): boolean =>
  board.exploded === null && board.revealed.length === SIZE * SIZE - MINE_COUNT;
