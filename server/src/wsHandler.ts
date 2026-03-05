import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ChatMessage,
  Role,
  GuestMode,
  ActorMode,
  ServerInit,
  ActiveChoice,
} from '@honkai-chat/shared';
import {
  getState,
  addMessage,
  getSessionsInfo,
  resetState,
  type SessionData,
} from './state.js';
import { broadcastAll, broadcastTo, broadcastExcept } from './broadcast.js';
import { getCharactersRecord, initCharacters } from './characters.js';
import { scenarioEngine } from './scenarioEngine.js';

function buildInitMessage(session: SessionData): ServerInit {
  const state = getState();

  // Determine active choices for this session
  let activeChoices: ActiveChoice | null = null;
  if (state.pendingChoice) {
    const pc = state.pendingChoice;
    const isTarget =
      (pc.target === 'guest' && session.role === 'guest') ||
      (pc.target === 'actor' && session.role === 'actor');
    if (isTarget) {
      activeChoices = {
        stepIndex: pc.stepIndex,
        options: pc.options,
      };
    }
  }

  return {
    type: 'init',
    sessionId: session.sessionId,
    role: session.role,
    characterId: session.characterId,
    messages: state.messages,
    characters: getCharactersRecord(),
    scenarioIndex: state.scenarioIndex,
    guestMode: state.guestMode,
    activeChoices,
    connectedSessions: getSessionsInfo(),
  };
}

export function handleConnection(
  ws: WebSocket,
  params: { role: string; characterId: string; sessionId?: string },
): void {
  const state = getState();
  let session: SessionData;
  let isNew = false;

  // Check for reconnection
  if (params.sessionId && state.sessions.has(params.sessionId)) {
    // Reconnect — re-associate WebSocket
    session = state.sessions.get(params.sessionId)!;
    state.connections.set(session.sessionId, ws);
    console.log(`[ws] Reconnected session ${session.sessionId} (${session.role})`);
  } else {
    // New session
    const role = params.role as Role;
    if (role !== 'guest' && role !== 'actor') {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_ROLE', message: 'Invalid role' }));
      ws.close();
      return;
    }

    const sessionId = uuidv4();
    session = {
      sessionId,
      role,
      characterId: params.characterId || (role === 'guest' ? 'clerk' : 'sunday'),
      actorMode: role === 'actor' ? 'scenario' : 'scenario',
      guestMode: state.guestMode,
      connectedAt: Date.now(),
    };

    state.sessions.set(sessionId, session);
    state.connections.set(sessionId, ws);
    isNew = true;
    console.log(`[ws] New session ${sessionId} (${role}, char=${session.characterId})`);
  }

  // Send init to this client
  const initMsg = buildInitMessage(session);
  ws.send(JSON.stringify(initMsg));

  // Broadcast session update to others
  broadcastExcept(session.sessionId, {
    type: 'sessionUpdate',
    sessions: getSessionsInfo(),
  });

  // Auto-start scenario when a guest connects to a fresh state
  if (session.role === 'guest' && state.scenarioIndex === 0 && state.messages.length === 0) {
    // Small delay to let the client initialize
    setTimeout(() => {
      scenarioEngine.processNextStep();
    }, 500);
  }

  // ─── Message handler ───
  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      ws.send(
        JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' }),
      );
      return;
    }

    handleClientMessage(session, ws, msg);
  });

  // ─── Close handler ───
  ws.on('close', () => {
    console.log(`[ws] Session ${session.sessionId} disconnected`);
    state.connections.delete(session.sessionId);
    // Keep session in state.sessions for reconnection

    broadcastAll({
      type: 'sessionUpdate',
      sessions: getSessionsInfo(),
    });
  });

  // ─── Error handler ───
  ws.on('error', (err) => {
    console.error(`[ws] Error on session ${session.sessionId}:`, err);
    state.connections.delete(session.sessionId);
  });
}

function handleClientMessage(
  session: SessionData,
  ws: WebSocket,
  msg: ClientMessage,
): void {
  const state = getState();

  switch (msg.type) {
    case 'choiceSelect': {
      scenarioEngine.handleChoiceSelect(msg.optionId, msg.stepIndex);
      break;
    }

    case 'freeMessage': {
      // Validate: not root mode
      if (session.role === 'actor' && session.actorMode === 'root') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'ROOT_NO_FREE',
            message: 'Root mode cannot send free messages',
          }),
        );
        return;
      }

      // Validate: guest allowed free mode
      if (session.role === 'guest' && state.guestMode !== 'free') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'FREE_NOT_ALLOWED',
            message: 'Guest free mode not active',
          }),
        );
        return;
      }

      // Create and broadcast message
      const chatMsg: ChatMessage = {
        id: uuidv4(),
        characterId: session.characterId,
        type: msg.messageType,
        value: msg.value,
        timestamp: Date.now(),
      };
      addMessage(chatMsg);
      broadcastAll({ type: 'newMessage', message: chatMsg });
      break;
    }

    case 'adminReset': {
      if (session.role !== 'actor') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only actors can reset',
          }),
        );
        return;
      }

      // Reset state
      resetState();
      scenarioEngine.reset();

      // Reload scenario
      if (state.scenario) {
        initCharacters(state.scenario);
        scenarioEngine.loadScenario(state.scenario);
      }

      // Close and remove guest sessions so a new guest can join fresh
      const guestSessionIds: string[] = [];
      for (const [sid, sessionData] of state.sessions) {
        if (sessionData.role === 'guest') {
          guestSessionIds.push(sid);
        }
      }
      for (const sid of guestSessionIds) {
        const guestWs = state.connections.get(sid);
        if (guestWs && guestWs.readyState === WebSocket.OPEN) {
          guestWs.close();
        }
        state.connections.delete(sid);
        state.sessions.delete(sid);
      }

      // Send reset with fresh init to remaining (actor) connections
      for (const [sid, sessionData] of state.sessions) {
        const connWs = state.connections.get(sid);
        if (connWs && connWs.readyState === WebSocket.OPEN) {
          const freshInit = buildInitMessage(sessionData);
          connWs.send(JSON.stringify({ type: 'reset', init: freshInit }));
        }
      }
      break;
    }

    case 'switchCharacter': {
      if (session.role !== 'actor') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only actors can switch characters',
          }),
        );
        return;
      }

      session.characterId = msg.characterId;

      // If switching to root, set actorMode to root
      if (msg.characterId === 'root') {
        session.actorMode = 'root';
      } else if (session.actorMode === 'root') {
        // Switching from root to a character — go to scenario mode
        session.actorMode = 'scenario';
      }

      broadcastAll({
        type: 'sessionUpdate',
        sessions: getSessionsInfo(),
      });
      break;
    }

    case 'switchActorMode': {
      if (session.role !== 'actor') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only actors can switch mode',
          }),
        );
        return;
      }

      session.actorMode = msg.mode as ActorMode;
      break;
    }

    case 'requestSync': {
      const initMsg = buildInitMessage(session);
      ws.send(JSON.stringify(initMsg));
      break;
    }

    case 'advanceScenario': {
      if (session.role !== 'actor' || session.actorMode !== 'root') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only root mode actors can advance scenario',
          }),
        );
        return;
      }

      scenarioEngine.processNextStep();
      break;
    }
  }
}
