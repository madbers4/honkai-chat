export const characterIds = ['clerk', 'sunday', 'firefly', 'himeko', 'river', 'sparkle', 'robin'] as const;
export type CharacterId = typeof characterIds[number];

export const roles = ['guest', 'actor'] as const;
export type Role = typeof roles[number];

export const actorModes = ['scenario', 'free', 'root'] as const;
export type ActorMode = typeof actorModes[number];

export const guestModes = ['scenario', 'free'] as const;
export type GuestMode = typeof guestModes[number];

export const scenarioVariants = ['default', 'no-sunday', 'no-firefly', 'no-robin'] as const;
export type ScenarioVariant = typeof scenarioVariants[number];

export const scenarioVariantLabels: Record<ScenarioVariant, string> = {
  'default': 'Полный состав',
  'no-sunday': 'Без Понедельника',
  'no-firefly': 'Без Светлячка',
  'no-robin': 'Без Зарянки',
};

// ─── Auth ───

export const guestToken = 'hsr-guest-2026';
export const actorKey = 'hsr-actor-penaconia';
export const testGuestKey = 'hsr-test-guest';

export const timing = {
  typingDelayBase: 1500,
  typingDelayPerChar: 30,
  typingDelayMax: 5000,
  choiceTimeout: 0,
  reconnectInterval: 2000,
  reconnectMaxAttempts: 10,
} as const;
