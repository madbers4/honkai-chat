export const difficulties = {
  easy: { durationMs: 3 * 60 * 1000, label: "Лёгкий", size: 5, mineCount: 4 },
  normal: {
    durationMs: 4 * 60 * 1000,
    label: "Средний",
    size: 6,
    mineCount: 7,
  },
  hard: { durationMs: 5 * 60 * 1000, label: "Сложный", size: 7, mineCount: 10 },
  chaos: {
    durationMs: 6 * 60 * 1000,
    label: "Паника Искры",
    size: 8,
    mineCount: 14,
  },
} as const;

export type Difficulty = keyof typeof difficulties;
export const nextDifficulty: Record<Difficulty, Difficulty> = {
  easy: "normal",
  normal: "hard",
  hard: "chaos",
  chaos: "chaos",
};

export const difficultyDuration = (difficulty: Difficulty): number =>
  difficulties[difficulty].durationMs;
export const difficultyTimeLabel = (difficulty: Difficulty): string =>
  `${difficulties[difficulty].durationMs / 60000} ${difficulty === "easy" || difficulty === "normal" ? "минуты" : "минут"}`;
