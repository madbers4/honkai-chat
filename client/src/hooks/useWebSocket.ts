import { useEffect, useRef, useCallback } from 'react';
import { WsClient } from '../lib/wsClient';
import { useChatContext } from '../context/chatContext';
import type { ServerMessage } from '../types';

export function useWebSocket(
  role: string,
  characterId: string,
  sessionId: string,
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
            choices: { stepIndex: msg.stepIndex, options: msg.options },
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
          dispatch({ type: 'RESET', init: msg.init });
          break;
        case 'guestModeSwitch':
          dispatch({ type: 'GUEST_MODE_SWITCH', mode: msg.mode });
          break;
        case 'sessionUpdate':
          dispatch({ type: 'SESSION_UPDATE', sessions: msg.sessions });
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?role=${role}&characterId=${characterIdRef.current}&sessionId=${sessionId}`;

    const client = new WsClient(url, handleMessage, handleStatus);
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
    // Note: don't reconnect on characterId change — that's handled via WS message
  }, [role, sessionId, handleMessage, handleStatus]);

  const send = useCallback((msg: object) => {
    clientRef.current?.send(msg);
  }, []);

  return { send };
}
