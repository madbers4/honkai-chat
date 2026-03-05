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

function initStateFromRole(role: Role): ChatState {
  return {
    role,
    sessionId: null,
    isConnected: false,
    currentCharacterId: role === "guest" ? "clerk" : "sunday",
    characters: new Map(),
    messages: [],
    typingCharacters: new Set(),
    activeChoices: null,
    guestMode: "scenario",
    actorMode: "scenario",
    sessions: [],
  };
}

function applyInit(state: ChatState, init: ServerInit): ChatState {
  const characters = new Map<string, CharacterDef>();
  for (const [id, char] of Object.entries(init.characters)) {
    characters.set(id, char);
  }
  return {
    ...state,
    sessionId: init.sessionId,
    role: init.role,
    characters,
    messages: init.messages,
    guestMode: init.guestMode,
    activeChoices: init.activeChoices,
    sessions: init.connectedSessions,
    currentCharacterId: init.characterId,
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

    case "CHARACTER_TRANSFORM": {
      const characters = new Map(state.characters);
      const oldChar = characters.get(action.fromId);
      if (oldChar) {
        characters.delete(action.fromId);
        characters.set(action.toId, {
          ...oldChar,
          id: action.toId as CharacterDef["id"],
          name: action.newName,
          avatarUrl: action.newAvatarUrl,
        });
      }
      let currentCharacterId = state.currentCharacterId;
      if (currentCharacterId === action.fromId) {
        currentCharacterId = action.toId;
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
