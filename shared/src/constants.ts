export const characterIds = ['clerk', 'sunday', 'firefly', 'himeko', 'river', 'sparkle'] as const;
export type CharacterId = typeof characterIds[number];

export const roles = ['guest', 'actor'] as const;
export type Role = typeof roles[number];

export const actorModes = ['scenario', 'free', 'root'] as const;
export type ActorMode = typeof actorModes[number];

export const guestModes = ['scenario', 'free'] as const;
export type GuestMode = typeof guestModes[number];

export const timing = {
  typingDelayBase: 1500,
  typingDelayPerChar: 30,
  typingDelayMax: 5000,
  choiceTimeout: 0,
  reconnectInterval: 2000,
  reconnectMaxAttempts: 10,
} as const;
