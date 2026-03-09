import type { CharacterId, GuestMode } from './constants';

// ─── Characters ───
export interface CharacterDef {
  id: CharacterId;
  name: string;
  avatarUrl: string;
  stickerPack: string[];
  color: string;
}

// ─── Messages ───
export type MessageType = 'text' | 'img' | 'sticker' | 'action';

export interface ChatMessage {
  id: string;
  characterId: string; // CharacterId or 'system' for actions
  type: MessageType;
  value: string;
  timestamp: number;
}

export interface DisplayMessage extends ChatMessage {
  source: 'incoming' | 'outgoing';
  isLoading: boolean;
  characterName: string;
  avatarUrl: string;
}

// ─── Scenario Steps ───
export interface MessageStep {
  type: 'message';
  characterId: CharacterId;
  messageType: 'text' | 'img' | 'sticker';
  value: string;
  delay?: number;
  _comment?: string;
}

export interface ChoiceOption {
  id: string;
  label: string;
  actions: ScenarioAction[];
}

export interface ChoiceStep {
  type: 'choice';
  target: 'guest' | 'actor';
  targetCharacterId?: CharacterId;
  options: ChoiceOption[];
  _comment?: string;
}

export type ScenarioAction =
  | { type: 'message'; characterId: CharacterId; messageType: 'text' | 'img' | 'sticker'; value: string; delay?: number }
  | { type: 'action'; value: string }
  | { type: 'delay'; ms: number };

export interface ActionStep {
  type: 'action';
  value: string;
  target?: 'guest' | 'actor';
  targetCharacterId?: CharacterId;
  _comment?: string;
}

export interface TransformCharacterStep {
  type: 'transformCharacter';
  fromId: CharacterId;
  toId: CharacterId;
  newName: string;
  newAvatarUrl: string;
  _comment?: string;
}

export interface SwitchGuestModeStep {
  type: 'switchGuestMode';
  mode: GuestMode;
  _comment?: string;
}

export interface BranchStep {
  type: 'branch';
  branches: Record<string, ScenarioStep[]>;
  _comment?: string;
}

export type ScenarioStep =
  | MessageStep
  | ChoiceStep
  | ActionStep
  | TransformCharacterStep
  | SwitchGuestModeStep
  | BranchStep;

export interface Scenario {
  id: string;
  title: string;
  description: string;
  initialCharacters: CharacterDef[];
  steps: ScenarioStep[];
}

// ─── Session ───
export interface Session {
  sessionId: string;
  role: 'guest' | 'actor';
  characterId: string;
  actorMode?: string;
  guestMode?: string;
  connectedAt: number;
}
