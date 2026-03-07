import { WebSocket } from 'ws';
import type { ServerMessage, Role } from '@honkai-chat/shared';
import { getState } from './state.js';

function safeSend(ws: WebSocket, msg: ServerMessage): boolean {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('[broadcast] send error:', err);
      return false;
    }
  }
  return false;
}

/** Remove stale connections that are no longer open */
function cleanupStale(sessionId: string, ws: WebSocket): void {
  if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
    getState().connections.delete(sessionId);
  }
}

export function broadcastAll(msg: ServerMessage): void {
  const state = getState();
  for (const [sessionId, ws] of state.connections) {
    if (!safeSend(ws, msg)) {
      cleanupStale(sessionId, ws);
    }
  }
}

export function broadcastTo(sessionId: string, msg: ServerMessage): void {
  const state = getState();
  const ws = state.connections.get(sessionId);
  if (ws) {
    if (!safeSend(ws, msg)) {
      cleanupStale(sessionId, ws);
    }
  }
}

export function broadcastToRole(role: Role, msg: ServerMessage): void {
  const state = getState();
  for (const [sessionId, session] of state.sessions) {
    if (session.role === role) {
      const ws = state.connections.get(sessionId);
      if (ws) {
        if (!safeSend(ws, msg)) {
          cleanupStale(sessionId, ws);
        }
      }
    }
  }
}

export function broadcastExcept(sessionId: string, msg: ServerMessage): void {
  const state = getState();
  for (const [sid, ws] of state.connections) {
    if (sid !== sessionId) {
      if (!safeSend(ws, msg)) {
        cleanupStale(sid, ws);
      }
    }
  }
}

/** Send to sessions whose current characterId matches + root actors */
export function broadcastToCharacterId(characterId: string, msg: ServerMessage): void {
  const state = getState();
  const sent = new Set<string>();

  for (const [sessionId, session] of state.sessions) {
    if (session.characterId === characterId || (session.role === 'actor' && session.actorMode === 'root')) {
      if (!sent.has(sessionId)) {
        const ws = state.connections.get(sessionId);
        if (ws) {
          if (!safeSend(ws, msg)) {
            cleanupStale(sessionId, ws);
          }
        }
        sent.add(sessionId);
      }
    }
  }
}
