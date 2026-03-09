import React, {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
} from "react";
import type {
  ChatState,
  ChatAction,
  CharacterDef,
  ServerInit,
  Role,
} from "../types";

const characterStorageKey = "honkai-chat-character";

function readStoredCharacterId(): string | null {
  try {
    return localStorage.getItem(characterStorageKey);
  } catch {
    return null;
  }
}

function saveCharacterId(characterId: string): void {
  try {
    localStorage.setItem(characterStorageKey, characterId);
  } catch {
    // ignore
  }
}

function initStateFromRole(role: Role): ChatState {
  const defaultCharacterId = role === "guest" ? "clerk" : "root";
  // Only actors restore stored characterId — guests are always clerk
  const storedCharacterId = role === "guest" ? null : readStoredCharacterId();

  return {
    role,
    sessionId: null,
    isConnected: false,
    currentCharacterId: storedCharacterId ?? defaultCharacterId,
    characters: new Map(),
    messages: [],
    typingCharacters: new Set(),
    activeChoices: null,
    pendingAdvance: null,
    guestMode: "scenario",
    actorMode: "scenario",
    sessions: [],
    scenarioVariant: "default",
    noScenario: false,
  };
}

function applyInit(state: ChatState, init: ServerInit): ChatState {
  const characters = new Map<string, CharacterDef>();
  for (const [id, char] of Object.entries(init.characters)) {
    characters.set(id, char);
  }
  // Only actors persist characterId — guests are always clerk
  if (init.role !== "guest") {
    saveCharacterId(init.characterId);
  }
  return {
    ...state,
    sessionId: init.sessionId,
    role: init.role,
    characters,
    messages: init.messages,
    typingCharacters: new Set(),
    guestMode: init.guestMode,
    activeChoices: init.activeChoices,
    pendingAdvance: init.pendingAdvance,
    sessions: init.connectedSessions,
    currentCharacterId: init.characterId,
    scenarioVariant: init.scenarioVariant,
    noScenario: init.noScenario,
  };
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, isConnected: action.connected };

    case "INIT":
      return { ...applyInit(state, action.payload), isConnected: true };

    case "NEW_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "SET_TYPING": {
      const typing = new Set(state.typingCharacters);
      if (action.isTyping) typing.add(action.characterId);
      else typing.delete(action.characterId);
      return { ...state, typingCharacters: typing };
    }

    case "SET_CHOICES":
      return { ...state, activeChoices: action.choices };

    case "DISMISS_CHOICES":
      return { ...state, activeChoices: null };

    case "SET_PENDING_ADVANCE":
      return { ...state, pendingAdvance: action.pendingAdvance };

    case "DISMISS_PENDING_ADVANCE":
      return { ...state, pendingAdvance: null };

    case "CHARACTER_TRANSFORM": {
      const characters = new Map(state.characters);
      const oldChar = characters.get(action.fromId);
      const newChar = {
        ...(oldChar ?? { stickerPack: [], color: "#9B59B6" }),
        id: action.toId as CharacterDef["id"],
        name: action.newName,
        avatarUrl: action.newAvatarUrl,
      } as CharacterDef;
      // Keep old entry so historical messages (characterId=fromId) still resolve
      characters.set(action.fromId, newChar);
      characters.set(action.toId, newChar);
      let currentCharacterId = state.currentCharacterId;
      if (currentCharacterId === action.fromId) {
        currentCharacterId = action.toId;
        if (state.role !== "guest") {
          saveCharacterId(currentCharacterId);
        }
      }
      return { ...state, characters, currentCharacterId };
    }

    case "RESET":
      return { ...applyInit(state, action.init), isConnected: true };

    case "GUEST_MODE_SWITCH":
      return { ...state, guestMode: action.mode };

    case "SESSION_UPDATE":
      return { ...state, sessions: action.sessions };

    case "SWITCH_CHARACTER":
      saveCharacterId(action.characterId);
      return {
        ...state,
        currentCharacterId: action.characterId,
        actorMode:
          action.characterId === "root"
            ? "root"
            : state.actorMode === "root"
              ? "scenario"
              : state.actorMode,
      };

    case "SWITCH_ACTOR_MODE":
      return { ...state, actorMode: action.mode };

    case "VARIANT_CHANGED":
      return {
        ...applyInit(state, action.init),
        isConnected: true,
        scenarioVariant: action.variant,
      };

    case "NO_SCENARIO_CHANGED":
      return { ...state, noScenario: action.noScenario };

    default:
      return state;
  }
}

interface ChatContextValue {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(chatReducer, role, initStateFromRole);
  return (
    <ChatContext.Provider value={{ state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
