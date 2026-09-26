import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refreshSavedCopy } from "../client/src/game/retired-copy.ts";
import { createGame, transition } from "../client/src/game/game.ts";
import { parseGame } from "../client/src/game/storage.ts";
import { findRetiredStoryWords } from "../scripts/check-story-copy.mjs";
import { dialogue } from "../client/src/game/dialogue.ts";
import { reactionLines } from "../client/src/game/commentary.ts";

test("all retired forms from the previous release are removed from local prose, without altering ordinary words", () => {
  const words: string[] = JSON.parse(readFileSync(new URL('./retired-copy-fixture.json', import.meta.url), 'utf8'));
  for (const word of words) {
    assert.equal(refreshSavedCopy(`«${word}», ${word.toUpperCase()}!`), '«[ПИП]», [ПИП]!');
  }
  const ordinary = "Искра: мина, мины, мину, сапёр, сапёра, заминировала, обезвреживание, минута, минуты, минус ♥";
  assert.equal(refreshSavedCopy(ordinary), ordinary);
  for (const text of [...Object.values(dialogue).flatMap(node => [...node.lines, ...node.replies.map(reply => reply.text)]), ...Object.values(reactionLines).flat()])
    assert.equal(refreshSavedCopy(text), text);
});

test("old saves restore with redacted history, queued replies and commentary while preserving progress and timing", () => {
  const saved = transition(createGame("existing-guest", 12345), { type: "start" }, 1000);
  saved.messages = [{ id: 0, author: "trailblazer", text: "Отключи бомбу." }];
  saved.pending = ["Бомба подстроится под твой первый ход."];
  saved.commentary.text = "Предыдущий взрыв назовём репетицией.";
  const restored = parseGame(JSON.stringify(saved))!;
  assert.deepEqual(restored, {
    ...saved,
    messages: [{ ...saved.messages[0], text: "Отключи [ПИП]." }],
    pending: ["[ПИП] подстроится под твой первый ход."],
    commentary: { ...saved.commentary, text: "Предыдущий [ПИП] назовём репетицией." },
  });
  const delivered = transition(restored, { type: "tick" }, restored.messageAt!);
  assert.equal(delivered.messages.at(-1)!.text, restored.pending[0]);
  assert.deepEqual(parseGame(JSON.stringify(delivered)), delivered);
});

test("build policy inspects literal and escaped text while allowing time labels", () => {
  assert.deepEqual(findRetiredStoryWords('БОМБА \\u0431\\u043e\\u043c\\u0431\\u0430'), ['БОМБА', 'бомба']);
  assert.deepEqual(findRetiredStoryWords('3 минуты, 1 минута, администрация, ловушка'), []);
});

test("saved dash placeholders become broadcast bleeps without changing punctuation or repeating the migration", () => {
  const lines: { before: string; after: string }[] = JSON.parse(readFileSync(new URL('./retired-dash-copy-fixture.json', import.meta.url), 'utf8'));
  for (const { before, after } of lines) {
    assert.equal(refreshSavedCopy(before), after);
    assert.equal(refreshSavedCopy(after), after);
  }
  const ordinary = "Мины — рядом. Первый ход — безопасный. Искра — нет.";
  assert.equal(refreshSavedCopy(ordinary), ordinary);
  const saved = transition(createGame("existing-dash-guest", 12345), { type: "start" }, 1000);
  saved.messages = [{ id: 0, author: "trailblazer", text: "Искра. Немедленно отключи —." }];
  saved.pending = ["Всё, даже подаренная минута закончилась! Чат, встречаем финальный спецэффект — —!"];
  saved.commentary.text = "Вот! Уже лучше. Предыдущий — назовём репетицией.";
  assert.deepEqual(parseGame(JSON.stringify(saved)), {
    ...saved,
    messages: [{ ...saved.messages[0], text: "Искра. Немедленно отключи [ПИП]." }],
    pending: ["Всё, даже подаренная минута закончилась! Чат, встречаем финальный спецэффект — [ПИП]!"],
    commentary: { ...saved.commentary, text: "Вот! Уже лучше. Предыдущий [ПИП] назовём репетицией." },
  });
});
