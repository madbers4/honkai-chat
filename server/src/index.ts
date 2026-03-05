import { createServer } from 'http';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { Scenario } from '@honkai-chat/shared';
import { getState } from './state.js';
import { initCharacters } from './characters.js';
import { scenarioEngine } from './scenarioEngine.js';
import { handleConnection } from './wsHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = 3001;

// ─── Express app ───
const app = express();

// Serve static client build in production
const clientDistPath = join(__dirname, '../../client/dist');
if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // Fallback for SPA routes
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// ─── HTTP + WS server ───
const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const role = url.searchParams.get('role') ?? '';
  const characterId = url.searchParams.get('characterId') ?? '';
  const sessionId = url.searchParams.get('sessionId') ?? undefined;

  handleConnection(ws, { role, characterId, sessionId });
});

// ─── Load scenario and start ───
function loadScenario(): Scenario {
  const scenarioPath = join(__dirname, 'scenario', 'penaconia.json');
  const raw = readFileSync(scenarioPath, 'utf-8');
  return JSON.parse(raw) as Scenario;
}

try {
  const scenario = loadScenario();
  const state = getState();
  state.scenario = scenario;
  initCharacters(scenario);
  scenarioEngine.loadScenario(scenario);
  console.log(`[server] Loaded scenario: "${scenario.title}" (${scenario.steps.length} steps)`);
} catch (err) {
  console.error('[server] Failed to load scenario:', err);
}

// ─── Start listening ───
server.listen(port, () => {
  console.log(`[server] Listening on http://localhost:${port}`);
  console.log(`[server] WebSocket path: ws://localhost:${port}/ws`);
});
