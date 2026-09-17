export const difficulties = {
  easy: { label: "Лёгкий", size: 5, mineCount: 4 },
  normal: { label: "Средний", size: 6, mineCount: 7 },
  hard: { label: "Сложный", size: 7, mineCount: 10 },
  chaos: { label: "Паника Искры", size: 8, mineCount: 14 },
} as const;

export type Difficulty = keyof typeof difficulties;
export const nextDifficulty: Record<Difficulty, Difficulty> = {
  easy: "normal",
  normal: "hard",
  hard: "chaos",
  chaos: "chaos",
};
