// Local-only acceptance server. Stage initial positions/resources once, then
// exercise the compiled production controls over the real WebSocket protocol.
import { startServer } from '../server/index.js';
import { ARENA_EDGE } from '../shared/constants.js';

const fixture = process.argv[2] || 'close';
if (!['close', 'whiff', 'edge'].includes(fixture)) throw Error('Expected close, whiff or edge');
const app = await startServer({ port: Number(process.env.REVIEW_PORT) || 3070, host: '127.0.0.1', log: true });
const staged = new WeakSet();
const timer = setInterval(() => {
  for (const room of app.rooms.values()) {
    const { game } = room;
    if (game.mode !== 'training' || game.players.length !== 2 || staged.has(game)) continue;
    staged.add(game);
    // This diagnostic fixture bypasses only the already accepted story opening.
    room.story = null;
    game.startRound(); game.phase = 'fight';
    const [a, b] = game.players;
    const center = fixture === 'edge' ? ARENA_EDGE - 1.5 : 0;
    const distance = fixture === 'whiff' ? 8 : 2.3;
    a.x = center - distance / 2; b.x = center + distance / 2;
    a.energy = 100; a.facing = 1; b.facing = -1;
    a.action = b.action = 'idle'; a.actionTime = b.actionTime = 0;
    a.actionDuration = b.actionDuration = 0; a.variant = b.variant = '';
    b.brainTimer = 999; b.input.move = 0; b.input.block = false; b.input.crouch = false;
    app.broadcast(room);
    console.log(`Staged ${fixture} in ${game.id}; subsequent input and combat are unmodified.`);
  }
}, 16);
async function close() { clearInterval(timer); await app.close(); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
console.log(`Production UI acceptance fixture ${fixture}: http://127.0.0.1:${app.port}`);
