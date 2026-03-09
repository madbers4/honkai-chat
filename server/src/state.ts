import type WebSocket from 'ws';
import type {
  ChatMessage,
  CharacterDef,
  Scenario,
  GuestMode,
  ActorMode,
  Role,
  SessionInfo,
  ScenarioVariant,
} from '@honkai-chat/shared';

// ─── Server-only types ───

export interface SessionData {
  sessionId: string;
  role: Role;
  characterId: string;
  actorMode: ActorMode;
  guestMode: GuestMode;
  connectedAt: number;
}

export interface PendingChoice {
  stepIndex: number;
  target: 'guest' | 'actor';
  targetCharacterId?: string;
  options: { id: string; label: string }[];
}

export interface PendingAdvanceData {
  target: 'guest' | 'actor';
  characterId: string;
  actionText: string;
}

export interface ServerState {
  messages: ChatMessage[];
  sessions: Map<string, SessionData>;
  connections: Map<string, WebSocket>;
  characters: Map<string, CharacterDef>;
  scenarioIndex: number;
  guestMode: GuestMode;
  pendingChoice: PendingChoice | null;
  pendingAdvance: PendingAdvanceData | null;
  branchContext: Map<string, string>;
  scenario: Scenario | null;
  scenarioVariant: ScenarioVariant;
  noScenario: boolean;
}

// ─── Singleton ───

let state: ServerState = createInitialState();

function createInitialState(): ServerState {
  return {
    messages: [],
    sessions: new Map(),
    connections: new Map(),
    characters: new Map(),
    scenarioIndex: 0,
    guestMode: 'scenario',
    pendingChoice: null,
    pendingAdvance: null,
    branchContext: new Map(),
    scenario: null,
    scenarioVariant: 'default',
    noScenario: false,
  };
}

export function getState(): ServerState {
  return state;
}

export function resetState(): void {
  // Preserve connections and sessions — only reset game state
  const oldConnections = state.connections;
  const oldSessions = state.sessions;

  state.messages = [];
  state.scenarioIndex = 0;
  state.guestMode = 'scenario';
  state.pendingChoice = null;
  state.pendingAdvance = null;
  state.branchContext = new Map();
  state.characters = new Map();

  // Re-init characters from scenario if available
  if (state.scenario) {
    for (const char of state.scenario.initialCharacters) {
      state.characters.set(char.id, { ...char });
    }
  }
}

export function addMessage(msg: ChatMessage): void {
  state.messages.push(msg);
}

export function getSessionsInfo(): SessionInfo[] {
  const infos: SessionInfo[] = [];
  for (const [, session] of state.sessions) {
    infos.push({
      sessionId: session.sessionId,
      role: session.role,
      characterId: session.characterId,
    });
  }
  return infos;
}
