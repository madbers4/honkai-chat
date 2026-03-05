import { useCallback, useMemo } from 'react';
import { useChatContext } from '../context/chatContext';
import { useWebSocket } from './useWebSocket';
import { useSession } from './useSession';
import * as factory from '../lib/messageFactory';
import type { DisplayMessage, Role } from '../types';

export function useChat(role: Role) {
  const { state, dispatch } = useChatContext();
  const { sessionId } = useSession();
  const { send } = useWebSocket(role, state.currentCharacterId, sessionId);

  // Compute display messages from raw ChatMessages + character registry
  const displayMessages: DisplayMessage[] = useMemo(() => {
    return state.messages.map((msg) => {
      const character = state.characters.get(msg.characterId);
      return {
        ...msg,
        source:
          msg.characterId === state.currentCharacterId
            ? 'outgoing'
            : 'incoming',
        isLoading: false,
        characterName: character?.name || msg.characterId,
        avatarUrl: character?.avatarUrl || '',
      } as DisplayMessage;
    });
  }, [state.messages, state.characters, state.currentCharacterId]);

  const sendFreeMessage = useCallback(
    (messageType: 'text' | 'img' | 'sticker', value: string) => {
      send(factory.createFreeMessage(messageType, value));
    },
    [send],
  );

  const selectChoice = useCallback(
    (optionId: string, stepIndex: number) => {
      send(factory.createChoiceSelect(optionId, stepIndex));
    },
    [send],
  );

  const switchCharacter = useCallback(
    (characterId: string) => {
      send(factory.createSwitchCharacter(characterId));
      dispatch({ type: 'SWITCH_CHARACTER', characterId });
    },
    [send, dispatch],
  );

  const switchActorMode = useCallback(
    (mode: 'scenario' | 'free' | 'root') => {
      send(factory.createSwitchActorMode(mode));
      dispatch({ type: 'SWITCH_ACTOR_MODE', mode });
    },
    [send, dispatch],
  );

  const advanceScenario = useCallback(() => {
    send(factory.createAdvanceScenario());
  }, [send]);

  const startScenario = useCallback(() => {
    send(factory.createAdminStartScenario());
  }, [send]);

  const resetChat = useCallback(() => {
    send(factory.createAdminReset());
  }, [send]);

  const requestSync = useCallback(() => {
    send(factory.createRequestSync());
  }, [send]);

  return {
    state,
    displayMessages,
    sendFreeMessage,
    selectChoice,
    switchCharacter,
    switchActorMode,
    advanceScenario,
    startScenario,
    resetChat,
    requestSync,
  };
}
