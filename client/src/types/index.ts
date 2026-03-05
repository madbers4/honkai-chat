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
  SessionInfo,
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
  SessionInfo,
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
  guestMode: GuestMode;
  actorMode: ActorMode;
  sessions: SessionInfo[];
}

export type ChatAction =
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'INIT'; payload: ServerInit }
  | { type: 'NEW_MESSAGE'; message: ChatMessage }
  | { type: 'SET_TYPING'; characterId: string; isTyping: boolean }
  | { type: 'SET_CHOICES'; choices: ActiveChoice }
  | { type: 'DISMISS_CHOICES' }
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
  | { type: 'SWITCH_ACTOR_MODE'; mode: ActorMode };
