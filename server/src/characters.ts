import type { CharacterDef, Scenario } from '@honkai-chat/shared';
import { getState } from './state.js';

export function initCharacters(scenario: Scenario): void {
  const state = getState();
  state.characters.clear();
  for (const char of scenario.initialCharacters) {
    state.characters.set(char.id, { ...char });
  }
}

export function getCharacter(id: string): CharacterDef | undefined {
  return getState().characters.get(id);
}

export function transformCharacter(
  fromId: string,
  toId: string,
  newName: string,
  newAvatarUrl: string,
): void {
  const state = getState();
  const existing = state.characters.get(fromId);

  // Create the new character entry based on existing or from scratch
  const newChar: CharacterDef = {
    id: toId as CharacterDef['id'],
    name: newName,
    avatarUrl: newAvatarUrl,
    stickerPack: existing?.stickerPack ?? [],
    color: existing?.color ?? '#9B59B6',
  };

  // Keep old entry so historical messages (characterId=fromId) still resolve
  state.characters.set(fromId, newChar);
  state.characters.set(toId, newChar);
}

export function getCharactersRecord(): Record<string, CharacterDef> {
  const state = getState();
  const record: Record<string, CharacterDef> = {};
  for (const [id, char] of state.characters) {
    record[id] = char;
  }
  return record;
}
