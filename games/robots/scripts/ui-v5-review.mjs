import { WINS_TO_MATCH } from '../shared/constants.js';
// Local-only review of the compiled UI over a real WebSocket connection.
// The named fixture changes initial conditions once, never attack resolution.
import { startServer } from '../server/index.js';
const fixture = process.argv[2] || 'natural';
if (!['natural', 'finish', 'recover', 'grapple'].includes(fixture)) throw Error('Expected natural, finish, recover or grapple');
const app = await startServer({ port: Number(process.env.REVIEW_PORT) || 3040, host: '127.0.0.1', log: true });
const staged = new WeakSet();
const timer = setInterval(() => {
  if (fixture === 'natural') return;
  for (const room of app.rooms.values()) {
    const { game } = room;
    if (game.phase !== 'fight' || staged.has(game) || game.mode !== 'training') continue;
    staged.add(game);
    const [a, b] = game.players;
    a.x = -1.05; b.x = 1.05; a.facing = 1; b.facing = -1;
    a.energy = 0; a.cooldowns.ultimate = 7;
    b.brainTimer = 999; b.input.move = 0; b.input.block = false; b.input.crouch = false;
    if (fixture !== 'grapple') b.hp = 5;
    if (fixture === 'finish') a.wins = WINS_TO_MATCH - 1;
    app.broadcast(room);
    console.log(`Staged ${fixture} initial conditions in ${game.id}; use the real buttons to fight.`);
  }
}, 16);
async function close() { clearInterval(timer); await app.close(); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
console.log(`UI review fixture: ${fixture}. Training only; http://127.0.0.1:${app.port}`);
