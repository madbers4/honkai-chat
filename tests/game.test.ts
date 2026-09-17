import test from "node:test";
import assert from "node:assert/strict";
import { dialogue } from "../client/src/game/dialogue.ts";
import {
  createGame,
  BONUS_MS,
  FAST_WIN_MS,
  attemptLimit,
  remainingMs,
  transition,
  type Game,
  type Action,
} from "../client/src/game/game.ts";
import {
  difficulties,
  difficultyDuration,
  type Difficulty,
} from "../client/src/game/difficulty.ts";
import {
  adjacentMines,
  emptyBoard,
  neighbors,
  reveal,
  toggleFlag,
} from "../client/src/game/minesweeper.ts";
import { parseGame } from "../client/src/game/storage.ts";
import { reactionLines } from "../client/src/game/commentary.ts";

const DURATION_MS = difficultyDuration("easy");

function session() {
  let now = 1_000_000;
  let game = createGame("guest-a", 12345);
  const act = (action: Action, elapsed = 0) => {
    now += elapsed;
    game = transition(game, action, now);
    assert.deepEqual(
      parseGame(JSON.stringify(game)),
      game,
      "Every live state must survive refresh",
    );
    return game;
  };
  const flush = () => {
    while (game.pending.length)
      act({ type: "tick" }, Math.max(0, game.messageAt! - now));
    return game;
  };
  const choose = (index = 0) => {
    act({ type: "reply", node: game.node, index });
    return flush();
  };
  const begin = (difficulty = 0) => {
    act({ type: "start" });
    flush();
    while (game.node !== "difficulty") choose();
    return choose(difficulty);
  };
  const hit = () => {
    act({ type: "reveal", cell: 0 }, 100);
    assert.equal(game.phase, "playing");
    return act({ type: "reveal", cell: game.board.mines[0] }, 100);
  };
  const solve = (elapsed = 1000) => {
    act({ type: "reveal", cell: 0 }, elapsed);
    const { size, mines } = game.board;
    for (let cell = 0; cell < size ** 2; cell++) {
      if (!mines.includes(cell) && game.phase === "playing")
        act({ type: "reveal", cell });
    }
    return game;
  };
  return {
    get game() {
      return game;
    },
    get now() {
      return now;
    },
    act,
    flush,
    choose,
    begin,
    hit,
    solve,
  };
}

test("all initial dialogue routes reach difficulty selection; the encore is finite", () => {
  const visited = new Set<string>();
  let endings = 0;
  function walk(id: string, path: string[]) {
    if (id === "game") {
      endings++;
      assert.ok(path.includes("difficulty") || path.includes("encore"));
      assert.ok(path.length <= 9, path.join(" → "));
      return;
    }
    assert.ok(!path.includes(id), `Loop at ${id}`);
    const node = dialogue[id];
    assert.ok(node, `Missing node ${id}`);
    assert.ok(
      node.lines.length > 0 &&
        node.replies.length > 0 &&
        node.replies.length <= 4,
    );
    visited.add(id);
    for (const option of node.replies) walk(option.next, [...path, id]);
  }
  walk("hello", []);
  walk("encore", []);
  assert.equal(visited.size, Object.keys(dialogue).length);
  assert.ok(endings > 100);
});

test("every difficulty protects the first cell and neighbors, with correct bounds and mine counts", () => {
  for (const difficulty of Object.keys(difficulties) as Difficulty[]) {
    const { size, mineCount } = difficulties[difficulty];
    for (let seed = 0; seed < 40; seed++)
      for (let first = 0; first < size ** 2; first++) {
        const board = reveal(emptyBoard(difficulty), first, seed);
        assert.equal(new Set(board.mines).size, mineCount);
        assert.equal(board.exploded, null);
        assert.ok(board.revealed.includes(first));
        for (const cell of [first, ...neighbors(first, size)])
          assert.ok(!board.mines.includes(cell));
        for (const cell of board.revealed)
          assert.ok(!board.mines.includes(cell));
        assert.equal(reveal(board, size ** 2, seed), board);
      }
  }
});

test("corners, flood fill and reversible flags retain correct rules", () => {
  assert.deepEqual(neighbors(0), [1, 5, 6]);
  assert.deepEqual(neighbors(0, 8), [1, 8, 9]);
  const board = { ...emptyBoard(), mines: [0, 4, 20, 24] };
  assert.equal(adjacentMines(board, 6), 1);
  assert.equal(reveal(board, 12, 1).revealed.length, 21);
  let flagged = toggleFlag(emptyBoard("hard"), 0);
  assert.equal(reveal(flagged, 0, 2), flagged);
  flagged = toggleFlag(flagged, 0);
  assert.equal(flagged.flags.length, 0);
  for (let i = 0; i < 20; i++) flagged = toggleFlag(flagged, i);
  assert.equal(flagged.flags.length, difficulties.hard.mineCount);
  assert.equal(flagged.revealed.length, 0);
});

test("messages arrive one at a time with typing delays; waiting and refresh do not start the clock", () => {
  const s = session();
  s.act({ type: "start" });
  assert.equal(s.game.messages.length, 0);
  assert.ok(s.game.typingAt! < s.game.messageAt!);
  s.act({ type: "reply", node: "hello", index: 0 });
  assert.equal(s.game.node, "hello");
  s.act({ type: "tick" }, 900000);
  assert.equal(s.game.messages.length, 1);
  assert.equal(s.game.pending.length, 1);
  assert.equal(remainingMs(s.game, s.now), DURATION_MS);
  assert.equal(s.game.startedAt, null);
  s.flush();
  assert.equal(s.game.messages.length, 2);
  while (s.game.node !== "difficulty") s.choose();
  s.act({ type: "reply", node: "difficulty", index: 1 });
  assert.equal(s.game.runningSince, null);
  s.flush();
  assert.equal(s.game.startedAt, s.now);
  assert.equal(s.game.board.size, 6);
});

test("five failed fields exhaust five attempts; pauses, reload and retries never reset remaining time", () => {
  const s = session();
  s.begin();
  for (let attempt = 1; attempt <= 5; attempt++) {
    s.hit();
    assert.equal(s.game.failedAttempts, attempt);
    assert.equal(s.game.remaining, DURATION_MS - attempt * 200);
    assert.equal(s.game.runningSince, null);
    s.act({ type: "tick" }, 600000);
    s.flush();
    assert.equal(s.game.remaining, DURATION_MS - attempt * 200);
    s.act({ type: "retry" });
    assert.equal(s.game.phase, attempt === 5 ? "lost" : "playing");
  }
  assert.equal(s.game.lossReason, "mines");
  assert.equal(s.game.bonusGranted, false);
  assert.notEqual(s.game.finishedAt, null);
});

test("timeout grants one minute and one attempt, pauses for the gift message, then expires once", () => {
  const s = session();
  s.begin();
  s.act({ type: "reveal", cell: 0 }, 1000);
  const board = s.game.board;
  s.act({ type: "tick" }, DURATION_MS);
  assert.equal(s.game.bonusGranted, true);
  assert.equal(attemptLimit(s.game), 6);
  assert.equal(s.game.remaining, BONUS_MS);
  assert.deepEqual(s.game.board, board);
  assert.equal(s.game.runningSince, null);
  // Refreshing after a long pause delivers the gift, with the whole minute intact.
  s.act({ type: "tick" }, 600000);
  assert.equal(remainingMs(s.game, s.now), BONUS_MS);
  assert.equal(s.game.commentary.kind, "bonus");
  s.act({ type: "reveal", cell: 1 }, BONUS_MS);
  assert.equal(s.game.phase, "lost");
  assert.equal(s.game.lossReason, "time");
  s.flush();
  s.act({ type: "retry" }, 600000);
  assert.equal(remainingMs(s.game, s.now), 0);
});

test("bonus permits exactly a sixth attempt and no seventh", () => {
  const s = session();
  s.begin();
  s.act({ type: "tick" }, DURATION_MS);
  s.flush();
  for (let i = 1; i <= 6; i++) {
    s.hit();
    s.flush();
    assert.equal(s.game.failedAttempts, i);
    s.act({ type: "retry" });
    assert.equal(s.game.phase, i === 6 ? "lost" : "playing");
  }
});

test("fast first wins raise each selected difficulty exactly once, extending the budget without resetting elapsed time or attempts", () => {
  for (let level = 0; level < 3; level++) {
    const s = session();
    s.begin(level);
    const size = s.game.board.size;
    s.solve();
    assert.equal(s.game.phase, "encore");
    assert.equal(s.game.board.size, size + 1);
    assert.equal(s.game.encoreGranted, true);
    assert.equal(
      s.game.remaining,
      difficultyDuration(s.game.difficulty) - 1000,
    );
    s.act({ type: "tick" }, 600000);
    s.flush();
    assert.equal(
      s.game.remaining,
      difficultyDuration(s.game.difficulty) - 1000,
    );
    s.choose();
    s.solve();
    assert.equal(s.game.phase, "won");
    assert.equal(
      s.game.remaining,
      difficultyDuration(s.game.difficulty) - 2000,
    );
    assert.equal(s.game.failedAttempts, 0);
    s.flush();
    assert.match(s.game.messages.at(-1)!.text, /печать/);
  }
});

test("a slow win, a recovered win, or a bonus win finishes without an encore", () => {
  const slow = session();
  slow.begin();
  slow.solve(FAST_WIN_MS);
  assert.equal(slow.game.phase, "won");
  const retry = session();
  retry.begin();
  retry.hit();
  retry.flush();
  retry.act({ type: "retry" });
  retry.solve();
  assert.equal(retry.game.phase, "won");
  const bonus = session();
  bonus.begin();
  bonus.act({ type: "tick" }, DURATION_MS);
  bonus.flush();
  bonus.solve();
  assert.equal(bonus.game.phase, "won");
  bonus.flush();
  const frozen = remainingMs(bonus.game, bonus.now);
  bonus.act({ type: "tick" }, 999999);
  assert.equal(remainingMs(bonus.game, bonus.now), frozen);
});

test("invalid saves, stale replies and duplicate mine clicks do not corrupt progress", () => {
  const s = session();
  s.begin();
  const before = s.game;
  s.act({ type: "reply", node: "hello", index: 0 });
  assert.equal(s.game, before);
  for (const cell of [-1, 25, 0.5, NaN]) {
    s.act({ type: "reveal", cell });
    assert.equal(s.game, before);
  }
  s.hit();
  const failed = s.game;
  s.act({ type: "reveal", cell: s.game.board.mines[0] });
  assert.equal(s.game, failed);
  for (const value of [
    null,
    {},
    { ...s.game, board: null },
    { ...s.game, difficulty: "impossible" },
    { ...s.game, node: "missing" },
    { ...s.game, commentary: null },
    { ...s.game, remaining: -1 },
    { ...s.game, runningSince: s.now },
    { ...s.game, pending: [], typingAt: 1 },
  ])
    assert.equal(parseGame(JSON.stringify(value)), null);
});

test("commentary responds to inactivity, actual moves and flags without spending pauses or spamming", () => {
  const s = session();
  s.begin();
  assert.equal(s.game.commentary.kind, "start");
  s.act({ type: "tick" }, 16000);
  assert.equal(s.game.commentary.kind, "idleStart");
  const serial = s.game.commentary.serial;
  for (let i = 0; i < 10; i++) s.act({ type: "tick" }, 250);
  assert.equal(s.game.commentary.serial, serial);
  s.act({ type: "flag", cell: 24 }, 7000);
  assert.equal(s.game.commentary.kind, "flag");
  s.act({ type: "flag", cell: 24 }, 7000);
  assert.equal(s.game.commentary.kind, "unflag");
  s.act({ type: "reveal", cell: 0 }, 7000);
  assert.ok(["safe", "flood", "near"].includes(s.game.commentary.kind));
  s.act({ type: "tick" }, 35000);
  assert.equal(s.game.commentary.kind, "longIdle");
  s.act({ type: "reveal", cell: s.game.board.mines[0] });
  assert.equal(s.game.commentary.kind, "mistake");
  s.flush();
  const text = s.game.commentary.text;
  s.act({ type: "tick" }, 500000);
  assert.equal(s.game.commentary.text, text);
  assert.equal(s.game.phase, "retry");
});

test("reaction banks vary without repetition; urgency supersedes chatter and never reveals hidden mines", () => {
  assert.ok(Object.values(reactionLines).flat().length >= 160);
  const s = session();
  s.begin(2);
  const heard: string[] = [];
  for (let i = 0; i < 6; i++) {
    s.act({ type: "tick" }, 16000);
    assert.equal(s.game.commentary.kind, "idleStart");
    heard.push(s.game.commentary.text);
  }
  assert.equal(new Set(heard).size, 6);
  s.act({ type: "tick" }, difficultyDuration("hard") - 96_000 - 10_000);
  assert.equal(s.game.commentary.kind, "time15");
  s.act({ type: "tick" }, 250);
  assert.equal(s.game.commentary.kind, "time15");
  const base = s.game;
  const alternative = {
    ...base,
    board: { ...base.board, mines: [1, 2, 3, 4] },
  };
  const action = { type: "flag", cell: 20 } as const;
  const when = s.now + 7000;
  assert.equal(
    transition(base, action, when).commentary.text,
    transition(alternative, action, when).commentary.text,
  );
});

test("difficulty sets 3/4/5-minute budgets and timeout occurs at each actual boundary", () => {
  for (const [level, minutes] of [3, 4, 5].entries()) {
    const s = session();
    s.begin(level);
    assert.equal(s.game.remaining, minutes * 60000);
    assert.match(s.game.messages.at(-1)!.text, new RegExp(`${minutes} минут`));
    s.act({ type: "tick" }, minutes * 60000 - 1);
    assert.equal(s.game.bonusGranted, false);
    assert.equal(remainingMs(s.game, s.now), 1);
    s.act({ type: "tick" }, 1);
    assert.equal(s.game.bonusGranted, true);
    assert.equal(s.game.remaining, BONUS_MS);
  }
});

test("old five-minute saves migrate once with elapsed time, board and bonus preserved", () => {
  const s = session();
  s.begin(1);
  s.hit();
  s.flush();
  const legacy = { ...s.game, version: 3, remaining: 300000 - 200 };
  const migrated = parseGame(JSON.stringify(legacy))!;
  assert.equal(migrated.version, 4);
  assert.equal(migrated.remaining, 240000 - 200);
  assert.deepEqual(migrated.board, legacy.board);
  assert.equal(migrated.failedAttempts, legacy.failedAttempts);
  assert.deepEqual(parseGame(JSON.stringify(migrated)), migrated);
  const active = {
    ...legacy,
    phase: "playing",
    runningSince: s.now,
    board: emptyBoard("normal"),
  };
  const restored = parseGame(JSON.stringify(active))!;
  assert.equal(remainingMs(restored, s.now + 10000), 240000 - 10200);
  const bonus = parseGame(
    JSON.stringify({ ...legacy, bonusGranted: true, remaining: 50000 }),
  )!;
  assert.equal(bonus.remaining, 50000);
  assert.equal(bonus.bonusGranted, true);
});
