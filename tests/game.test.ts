import test from "node:test";
import assert from "node:assert/strict";
import { dialogue } from "../client/src/game/dialogue.ts";
import {
  createGame,
  DURATION_MS,
  MAX_ATTEMPTS,
  remainingMs,
  transition,
  type Game,
} from "../client/src/game/game.ts";
import {
  adjacentMines,
  emptyBoard,
  MINE_COUNT,
  neighbors,
  reveal,
  SIZE,
  toggleFlag,
} from "../client/src/game/minesweeper.ts";
import { parseGame } from "../client/src/game/storage.ts";

const startTime = 1_000_000;
const begin = () =>
  transition(createGame("guest-a", 12345), { type: "start" }, startTime);
const choose = (game: Game, index: number) =>
  transition(game, { type: "reply", node: game.node, index }, startTime + 1000);
function playing() {
  let game = begin();
  game = choose(game, 0); // Demand → polite → brief → game.
  game = choose(game, 0);
  game = choose(game, 0);
  return choose(game, 0);
}

test("every dialogue branch is reachable, finite, and reaches the game in at most eight replies", () => {
  const visited = new Set<string>();
  let endings = 0;
  function walk(id: string, path: string[]) {
    if (id === "game") {
      endings++;
      assert.ok(path.length <= 8, path.join(" → "));
      return;
    }
    assert.ok(!path.includes(id), `Loop at ${id}`);
    const node = dialogue[id];
    assert.ok(node, `Missing node ${id}`);
    assert.ok(node.lines.length > 0 && node.replies.length > 0);
    assert.ok(node.replies.length <= 4);
    visited.add(id);
    for (const option of node.replies) walk(option.next, [...path, id]);
  }
  walk("hello", []);
  assert.equal(visited.size, Object.keys(dialogue).length);
  assert.ok(endings > 40, "Expected a wide dialogue tree");
});

test("first move and its neighbors are safe across every opening position and many seeds", () => {
  for (let seed = 0; seed < 100; seed++) {
    for (let first = 0; first < SIZE * SIZE; first++) {
      const board = reveal(emptyBoard(), first, seed);
      assert.equal(board.mines.length, MINE_COUNT);
      assert.equal(new Set(board.mines).size, MINE_COUNT);
      assert.equal(board.exploded, null);
      assert.ok(board.revealed.includes(first));
      for (const cell of [first, ...neighbors(first)])
        assert.ok(!board.mines.includes(cell));
      for (const cell of board.revealed) assert.ok(!board.mines.includes(cell));
    }
  }
});

test("corners, edges, and flood fill use only actual neighboring cells", () => {
  assert.deepEqual(neighbors(0), [1, 5, 6]);
  assert.equal(neighbors(12).length, 8);
  const board = { ...emptyBoard(), mines: [0, 4, 20, 24] };
  assert.equal(adjacentMines(board, 6), 1);
  const open = reveal(board, 12, 1);
  assert.equal(open.revealed.length, 21);
  assert.equal(open.exploded, null);
});

test("flags protect cells from accidental opening, can be removed, and do not win by themselves", () => {
  let board = toggleFlag(emptyBoard(), 0);
  assert.equal(reveal(board, 0, 2), board);
  board = toggleFlag(board, 0);
  assert.equal(board.flags.length, 0);
  for (const i of [0, 1, 2, 3, 4]) board = toggleFlag(board, i);
  assert.equal(board.flags.length, MINE_COUNT);
  assert.equal(board.revealed.length, 0);
  const game = playing();
  assert.equal(
    transition(game, { type: "flag", cell: 0 }, startTime + 5000).phase,
    "playing",
  );
});

test("five failed boards exhaust exactly five attempts, preserve deadline, and cannot retry again", () => {
  let game = playing();
  const deadline = game.deadline;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    game = transition(game, { type: "reveal", cell: 12 }, startTime + 10000);
    assert.equal(game.phase, "playing");
    game = transition(
      game,
      { type: "reveal", cell: game.board.mines[0] },
      startTime + 11000,
    );
    assert.equal(game.failedAttempts, attempt);
    assert.equal(game.deadline, deadline);
    assert.equal(game.phase, attempt === MAX_ATTEMPTS ? "lost" : "retry");
    const after = transition(game, { type: "retry" }, startTime + 12000);
    if (attempt < MAX_ATTEMPTS) {
      assert.equal(after.board.mines.length, 0);
      assert.equal(after.board.flags.length, 0);
    } else {
      assert.equal(after, game);
      assert.equal(game.lossReason, "mines");
    }
    game = after;
  }
  assert.match(game.messages.at(-1)!.text, /конфетти/);
});

test("opening all safe cells wins and freezes the remaining time and controls", () => {
  let game = transition(
    playing(),
    { type: "reveal", cell: 12 },
    startTime + 5000,
  );
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    if (!game.board.mines.includes(cell))
      game = transition(game, { type: "reveal", cell }, startTime + 10000);
  }
  assert.equal(game.phase, "won");
  assert.equal(game.failedAttempts, 0);
  assert.equal(remainingMs(game, startTime + 500000), DURATION_MS - 10000);
  assert.equal(transition(game, { type: "tick" }, startTime + 500000), game);
  assert.equal(
    transition(
      game,
      { type: "reveal", cell: game.board.mines[0] },
      startTime + 12000,
    ),
    game,
  );
});

test("timeout applies during dialogue, play, and retry, including clicks exactly at the deadline", () => {
  let retry = transition(
    playing(),
    { type: "reveal", cell: 12 },
    startTime + 5000,
  );
  retry = transition(
    retry,
    { type: "reveal", cell: retry.board.mines[0] },
    startTime + 6000,
  );
  for (const game of [begin(), playing(), retry]) {
    for (const action of [
      { type: "tick" },
      { type: "retry" },
      { type: "reveal", cell: 0 },
      { type: "reply", node: game.node, index: 0 },
    ] as const) {
      const ended = transition(game, action, startTime + DURATION_MS);
      assert.equal(ended.phase, "lost");
      assert.equal(ended.lossReason, "time");
      assert.equal(remainingMs(ended, startTime + DURATION_MS), 0);
      assert.equal(ended.failedAttempts, game.failedAttempts);
    }
  }
});

test("refresh restores board, transcript, attempts, and deadline; returning after timeout ends the game", () => {
  let game = transition(
    playing(),
    { type: "reveal", cell: 12 },
    startTime + 5000,
  );
  game = transition(
    game,
    { type: "reveal", cell: game.board.mines[0] },
    startTime + 6000,
  );
  const saved = parseGame(JSON.stringify(game));
  assert.deepEqual(saved, game);
  const resumed = transition(saved!, { type: "retry" }, startTime + 12000);
  assert.equal(resumed.failedAttempts, 1);
  assert.equal(resumed.deadline, game.deadline);
  assert.equal(
    transition(saved!, { type: "tick" }, startTime + DURATION_MS + 100).phase,
    "lost",
  );
  for (const raw of [
    null,
    "{",
    "{}",
    "null",
    JSON.stringify({ ...game, board: null }),
    JSON.stringify({ ...game, node: "missing" }),
    JSON.stringify({ ...game, deadline: -1 }),
  ])
    assert.equal(parseGame(raw), null);
});

test("stale replies, invalid cells, and duplicate mine clicks cannot consume extra attempts", () => {
  const first = begin();
  const next = choose(first, 0);
  assert.equal(
    transition(
      next,
      { type: "reply", node: "hello", index: 0 },
      startTime + 2000,
    ),
    next,
  );
  let game = playing();
  for (const cell of [-1, 25, 0.5, NaN])
    assert.equal(
      transition(game, { type: "reveal", cell }, startTime + 5000),
      game,
    );
  game = transition(game, { type: "reveal", cell: 12 }, startTime + 5000);
  const hit = { type: "reveal" as const, cell: game.board.mines[0] };
  const failed = transition(game, hit, startTime + 6000);
  assert.equal(transition(failed, hit, startTime + 6000), failed);
});

test("each guest has independent time and game state; tone affects the first failure response", () => {
  const guestA = playing();
  const guestB = transition(
    createGame("guest-b", 77),
    { type: "start" },
    startTime + 100000,
  );
  const altered = transition(
    guestA,
    { type: "reveal", cell: 12 },
    startTime + 2000,
  );
  assert.equal(guestB.board.revealed.length, 0);
  assert.equal(guestB.deadline, startTime + 100000 + DURATION_MS);
  const hit = { type: "reveal" as const, cell: altered.board.mines[0] };
  const hero = transition(
    { ...altered, attitude: "hero" },
    hit,
    startTime + 3000,
  );
  const tired = transition(
    { ...altered, attitude: "tired" },
    hit,
    startTime + 3000,
  );
  assert.notEqual(hero.messages.at(-1)!.text, tired.messages.at(-1)!.text);
});
