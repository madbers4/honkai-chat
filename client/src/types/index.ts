import type {
  CharacterDef,
  ChatMessage,
  DisplayMessage,
  CharacterId,
  Role,
  GuestMode,
  ActorMode,
  ServerMessage,
  ClientMessage,
  ServerInit,
  ActiveChoice,
  PendingAdvance,
  SessionInfo,
  ScenarioVariant,
} from '@honkai-chat/shared';

export type {
  CharacterDef,
  ChatMessage,
  DisplayMessage,
  CharacterId,
  Role,
  GuestMode,
  ActorMode,
  ServerMessage,
  ClientMessage,
  ServerInit,
  ActiveChoice,
  PendingAdvance,
  SessionInfo,
  ScenarioVariant,
};

// ─── Client-only UI state ───

export interface ChatState {
  role: Role;
  sessionId: string | null;
  isConnected: boolean;
  currentCharacterId: string; // CharacterId | 'root'
  characters: Map<string, CharacterDef>;
  messages: ChatMessage[];
  typingCharacters: Set<string>;
  activeChoices: ActiveChoice | null;
  pendingAdvance: PendingAdvance | null;
  guestMode: GuestMode;
  actorMode: ActorMode;
  sessions: SessionInfo[];
  scenarioVariant: ScenarioVariant;
  noScenario: boolean;
}

export type ChatAction =
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'INIT'; payload: ServerInit }
  | { type: 'NEW_MESSAGE'; message: ChatMessage }
  | { type: 'SET_TYPING'; characterId: string; isTyping: boolean }
  | { type: 'SET_CHOICES'; choices: ActiveChoice }
  | { type: 'DISMISS_CHOICES' }
  | { type: 'SET_PENDING_ADVANCE'; pendingAdvance: PendingAdvance }
  | { type: 'DISMISS_PENDING_ADVANCE' }
  | {
      type: 'CHARACTER_TRANSFORM';
      fromId: string;
      toId: string;
      newName: string;
      newAvatarUrl: string;
    }
  | { type: 'RESET'; init: ServerInit }
  | { type: 'GUEST_MODE_SWITCH'; mode: GuestMode }
  | { type: 'SESSION_UPDATE'; sessions: SessionInfo[] }
  | { type: 'SWITCH_CHARACTER'; characterId: string }
  | { type: 'SWITCH_ACTOR_MODE'; mode: ActorMode }
  | { type: 'VARIANT_CHANGED'; variant: ScenarioVariant; init: ServerInit }
  | { type: 'NO_SCENARIO_CHANGED'; noScenario: boolean };
