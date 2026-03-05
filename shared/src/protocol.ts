import type { ChatMessage, CharacterDef } from './models';
import type { CharacterId, GuestMode, Role } from './constants';

// ─── Server → Client ───

export interface SessionInfo {
  sessionId: string;
  role: Role;
  characterId: string;
}

export interface ActiveChoice {
  stepIndex: number;
  options: { id: string; label: string }[];
}

export interface ServerInit {
  type: 'init';
  sessionId: string;
  role: Role;
  characterId: string;
  messages: ChatMessage[];
  characters: Record<string, CharacterDef>;
  scenarioIndex: number;
  guestMode: GuestMode;
  activeChoices: ActiveChoice | null;
  connectedSessions: SessionInfo[];
}

export interface ServerNewMessage {
  type: 'newMessage';
  message: ChatMessage;
}

export interface ServerTyping {
  type: 'typing';
  characterId: string;
  isTyping: boolean;
}

export interface ServerChoices {
  type: 'choices';
  stepIndex: number;
  options: { id: string; label: string }[];
}

export interface ServerChoicesDismissed {
  type: 'choicesDismissed';
}

export interface ServerCharacterTransform {
  type: 'characterTransform';
  fromId: string;
  toId: string;
  newName: string;
  newAvatarUrl: string;
}

export interface ServerReset {
  type: 'reset';
  init: ServerInit;
}

export interface ServerGuestModeSwitch {
  type: 'guestModeSwitch';
  mode: GuestMode;
}

export interface ServerSessionUpdate {
  type: 'sessionUpdate';
  sessions: SessionInfo[];
}

export interface ServerError {
  type: 'error';
  code: string;
  message: string;
}

export type ServerMessage =
  | ServerInit
  | ServerNewMessage
  | ServerTyping
  | ServerChoices
  | ServerChoicesDismissed
  | ServerCharacterTransform
  | ServerReset
  | ServerGuestModeSwitch
  | ServerSessionUpdate
  | ServerError;

// ─── Client → Server ───

export interface ClientChoiceSelect {
  type: 'choiceSelect';
  optionId: string;
  stepIndex: number;
}

export interface ClientFreeMessage {
  type: 'freeMessage';
  messageType: 'text' | 'img' | 'sticker';
  value: string;
}

export interface ClientAdminReset {
  type: 'adminReset';
}

export interface ClientSwitchCharacter {
  type: 'switchCharacter';
  characterId: string;
}

export interface ClientSwitchActorMode {
  type: 'switchActorMode';
  mode: string;
}

export interface ClientRequestSync {
  type: 'requestSync';
}

export interface ClientAdvanceScenario {
  type: 'advanceScenario';
}

export type ClientMessage =
  | ClientChoiceSelect
  | ClientFreeMessage
  | ClientAdminReset
  | ClientSwitchCharacter
  | ClientSwitchActorMode
  | ClientRequestSync
  | ClientAdvanceScenario;
