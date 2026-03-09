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
  PendingAdvance,
  ScenarioVariant,
} from '@honkai-chat/shared';
import { scenarioVariants, guestToken, actorKey, testGuestKey } from '@honkai-chat/shared';
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
import { loadScenario } from './scenarioLoader.js';

function buildInitMessage(session: SessionData): ServerInit {
  const state = getState();

  // Send active choices to ALL sessions — visibility is handled client-side
  let activeChoices: ActiveChoice | null = null;
  if (state.pendingChoice) {
    const pc = state.pendingChoice;
    activeChoices = {
      stepIndex: pc.stepIndex,
      target: pc.target,
      targetCharacterId: pc.targetCharacterId ?? 'system',
      options: pc.options,
    };
  }

  // Determine pending advance for this session
  let pendingAdvance: PendingAdvance | null = null;
  if (state.pendingAdvance) {
    pendingAdvance = {
      target: state.pendingAdvance.target,
      characterId: state.pendingAdvance.characterId,
      actionText: state.pendingAdvance.actionText,
    };
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
  pendingAdvance,
  connectedSessions: getSessionsInfo(),
  scenarioVariant: state.scenarioVariant,
  noScenario: state.noScenario,
};
}

function validateAuth(role: Role, token?: string, key?: string): boolean {
  if (role === 'actor') {
    return key === actorKey;
  }
  // role === 'guest': accept either valid key (testGuest) or valid token (regular guest)
  if (key) return key === testGuestKey;
  if (token) return token === guestToken;
  return false;
}

export function handleConnection(
  ws: WebSocket,
  params: { role: string; characterId: string; sessionId?: string; token?: string; key?: string },
): void {
  const state = getState();
  let session: SessionData;
  let isNew = false;

  // Check for reconnection
  if (params.sessionId && state.sessions.has(params.sessionId)) {
    // Reconnect — re-associate WebSocket, skip auth (already validated)
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

    // ─── Auth validation ───
    if (!validateAuth(role, params.token, params.key)) {
      console.log(`[ws] Auth failed for role=${role}`);
      ws.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Invalid or missing auth credentials' }));
      ws.close();
      return;
    }

    const sessionId = uuidv4();
    session = {
      sessionId,
      role,
      characterId: role === 'guest' ? 'clerk' : (params.characterId || 'root'),
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

  // Scenario is started explicitly via adminStartScenario (from guest "Войти" or actor admin panel)

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

      // In noScenario mode everyone can write freely regardless of guestMode
      // Otherwise block free messages during scenario mode (between activities)
      if (!state.noScenario && state.guestMode !== 'free') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'FREE_NOT_ALLOWED',
            message: 'Free mode not active — scenario in progress',
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

      // Send reset to ALL connections first, then close guest sessions
      for (const [sid, sessionData] of state.sessions) {
        const connWs = state.connections.get(sid);
        if (connWs && connWs.readyState === WebSocket.OPEN) {
          const freshInit = buildInitMessage(sessionData);
          connWs.send(JSON.stringify({ type: 'reset', init: freshInit }));
        }
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

      // No need to re-evaluate choices — visibility is handled client-side
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
      if (state.pendingAdvance) {
        const pa = state.pendingAdvance;
        const isRoot = session.role === 'actor' && session.actorMode === 'root';

        let authorized = false;
        if (pa.target === 'guest') {
          authorized = session.role === 'guest' || isRoot;
        } else {
          // target === 'actor'
          authorized = isRoot || (session.role === 'actor' && session.characterId === pa.characterId);
        }

        if (!authorized) {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'UNAUTHORIZED',
              message: 'Not authorized to advance this action',
            }),
          );
          return;
        }
        scenarioEngine.handleAdvance();
      } else {
        // No pending advance — only actors may force-advance
        if (session.role !== 'actor') {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'UNAUTHORIZED',
              message: 'Only actors can advance scenario',
            }),
          );
          return;
        }
        scenarioEngine.processNextStep();
      }
      break;
    }

    case 'adminStartScenario': {
      // Both guest ("Войти в чат") and actor ("Запустить сценарий") can trigger
      // Only start if scenario hasn't begun yet
      if (state.scenarioIndex === 0 && state.messages.length === 0) {
        scenarioEngine.startScenario();
      }
      break;
    }

    case 'toggleNoScenario': {
      if (session.role !== 'actor') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only actors can toggle no-scenario mode',
          }),
        );
        return;
      }

      state.noScenario = msg.enabled;
      console.log(`[server] No-scenario mode ${msg.enabled ? 'enabled' : 'disabled'}`);

      broadcastAll({ type: 'noScenarioChanged', noScenario: msg.enabled });
      break;
    }

    case 'switchVariant': {
      if (session.role !== 'actor') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Only actors can switch scenario variant',
          }),
        );
        return;
      }

      const variant = msg.variant as ScenarioVariant;
      if (!scenarioVariants.includes(variant)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'INVALID_VARIANT',
            message: `Invalid variant: ${variant}`,
          }),
        );
        return;
      }

      // Load new scenario variant
      try {
        const newScenario = loadScenario(variant);

        // Reset state
        resetState();
        scenarioEngine.reset();

        // Apply new scenario
        state.scenario = newScenario;
        state.scenarioVariant = variant;
        initCharacters(newScenario);
        scenarioEngine.loadScenario(newScenario);

        console.log(`[server] Switched to variant "${variant}": "${newScenario.title}" (${newScenario.steps.length} steps)`);

        // Send variantChanged to ALL connections first, then close guest sessions
        for (const [sid, sessionData] of state.sessions) {
          const connWs = state.connections.get(sid);
          if (connWs && connWs.readyState === WebSocket.OPEN) {
            const freshInit = buildInitMessage(sessionData);
            connWs.send(JSON.stringify({ type: 'variantChanged', variant, init: freshInit }));
          }
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
      } catch (err) {
        console.error(`[server] Failed to load variant "${variant}":`, err);
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'VARIANT_LOAD_ERROR',
            message: `Failed to load variant: ${variant}`,
          }),
        );
      }
      break;
    }
  }
}
