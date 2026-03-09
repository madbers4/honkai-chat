import type { ClientMessage } from '@honkai-chat/shared';

export function createChoiceSelect(
  optionId: string,
  stepIndex: number,
): ClientMessage {
  return { type: 'choiceSelect', optionId, stepIndex };
}

export function createFreeMessage(
  messageType: 'text' | 'img' | 'sticker',
  value: string,
): ClientMessage {
  return { type: 'freeMessage', messageType, value };
}

export function createAdminReset(): ClientMessage {
  return { type: 'adminReset' };
}

export function createSwitchCharacter(characterId: string): ClientMessage {
  return { type: 'switchCharacter', characterId };
}

export function createSwitchActorMode(mode: string): ClientMessage {
  return { type: 'switchActorMode', mode };
}

export function createRequestSync(): ClientMessage {
  return { type: 'requestSync' };
}

export function createAdvanceScenario(): ClientMessage {
  return { type: 'advanceScenario' };
}

export function createAdminStartScenario(): ClientMessage {
  return { type: 'adminStartScenario' };
}

export function createSwitchVariant(variant: string): ClientMessage {
  return { type: 'switchVariant', variant } as ClientMessage;
}

export function createToggleNoScenario(enabled: boolean): ClientMessage {
  return { type: 'toggleNoScenario', enabled } as ClientMessage;
}
