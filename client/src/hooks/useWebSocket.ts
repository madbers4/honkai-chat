import { useEffect, useRef, useCallback } from 'react';
import { WsClient } from '../lib/wsClient';
import { useChatContext } from '../context/chatContext';
import type { ServerMessage } from '../types';

export function useWebSocket(
  role: string,
  characterId: string,
  sessionId: string,
  authParam: string | null,
) {
  const { dispatch } = useChatContext();
  const clientRef = useRef<WsClient | null>(null);
  // Keep characterId in a ref so the initial connection uses the current value
  // but changes don't trigger reconnection (character switch is via WS message)
  const characterIdRef = useRef(characterId);
  characterIdRef.current = characterId;

  const handleMessage = useCallback(
    (data: unknown) => {
      const msg = data as ServerMessage;
      switch (msg.type) {
        case 'init':
          dispatch({ type: 'INIT', payload: msg });
          break;
        case 'newMessage':
          dispatch({ type: 'NEW_MESSAGE', message: msg.message });
          break;
        case 'typing':
          dispatch({
            type: 'SET_TYPING',
            characterId: msg.characterId,
            isTyping: msg.isTyping,
          });
          break;
        case 'choices':
          dispatch({
            type: 'SET_CHOICES',
            choices: {
              stepIndex: msg.stepIndex,
              target: msg.target,
              targetCharacterId: msg.targetCharacterId,
              options: msg.options,
            },
          });
          break;
        case 'choicesDismissed':
          dispatch({ type: 'DISMISS_CHOICES' });
          break;
        case 'characterTransform':
          dispatch({
            type: 'CHARACTER_TRANSFORM',
            fromId: msg.fromId,
            toId: msg.toId,
            newName: msg.newName,
            newAvatarUrl: msg.newAvatarUrl,
          });
          break;
        case 'reset':
          if (role === 'guest') {
            // Guest: clear session + auth and reload to show welcome/denied screen
            localStorage.removeItem('honkai-chat-session');
            sessionStorage.removeItem('honkai-chat-auth');
            window.location.reload();
            return;
          }
          dispatch({ type: 'RESET', init: msg.init });
          break;
        case 'guestModeSwitch':
          dispatch({ type: 'GUEST_MODE_SWITCH', mode: msg.mode });
          break;
        case 'pendingAdvance':
          dispatch({
            type: 'SET_PENDING_ADVANCE',
            pendingAdvance: { target: msg.target, characterId: msg.characterId, actionText: msg.actionText },
          });
          break;
        case 'pendingAdvanceDismissed':
          dispatch({ type: 'DISMISS_PENDING_ADVANCE' });
          break;
        case 'sessionUpdate':
          dispatch({ type: 'SESSION_UPDATE', sessions: msg.sessions });
          break;
        case 'variantChanged':
          if (role === 'guest') {
            // Guest: clear session + auth and reload to show welcome/denied screen
            localStorage.removeItem('honkai-chat-session');
            sessionStorage.removeItem('honkai-chat-auth');
            window.location.reload();
            return;
          }
          dispatch({ type: 'VARIANT_CHANGED', variant: msg.variant, init: msg.init });
          break;
        case 'noScenarioChanged':
          dispatch({ type: 'NO_SCENARIO_CHANGED', noScenario: msg.noScenario });
          break;
        case 'error':
          console.error('Server error:', msg.code, msg.message);
          break;
      }
    },
    [dispatch],
  );

  const handleStatus = useCallback(
    (connected: boolean) => {
      dispatch({ type: 'SET_CONNECTED', connected });
    },
    [dispatch],
  );

  useEffect(() => {
    if (!authParam) return; // No auth — don't connect

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?role=${role}&characterId=${characterIdRef.current}&sessionId=${sessionId}&${authParam}`;

    const client = new WsClient(url, handleMessage, handleStatus);
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
    // Note: don't reconnect on characterId change — that's handled via WS message
  }, [role, sessionId, authParam, handleMessage, handleStatus]);

  const send = useCallback((msg: object) => {
    clientRef.current?.send(msg);
  }, []);

  return { send };
}
