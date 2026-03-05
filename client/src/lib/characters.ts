// Map characterId → CSS variable name for username color
const characterColorMap: Record<string, string> = {
  clerk: 'var(--name-clerk)',
  sunday: 'var(--name-sunday)',
  firefly: 'var(--name-firefly)',
  himeko: 'var(--name-himeko)',
  river: 'var(--name-river)',
  sparkle: 'var(--name-sparkle)',
};

export function getCharacterColor(characterId: string): string {
  return characterColorMap[characterId] || '#666';
}
