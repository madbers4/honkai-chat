export const CHARACTER_LIMIT = 60;
export const ROBOT_NAME_LIMIT = 20;

export function cleanRobotName(value, fallback = 'Автоматон') {
  return [...cleanCharacter(value)].slice(0, ROBOT_NAME_LIMIT).join('').trim() || fallback;
}

/** Optional plain-text roleplay metadata, shared by server and browser. */
export function cleanCharacter(value) {
  if (typeof value !== 'string') return '';
  const plain = value.normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[<>\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    .trim();
  // Count Unicode code points, retaining emoji pairs but discarding lone surrogates.
  return [...plain].filter(character => !/^[\ud800-\udfff]$/u.test(character)).slice(0, CHARACTER_LIMIT).join('').trim();
}
