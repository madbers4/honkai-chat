import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUB_CHARTER, CLUB_STORY, RULE_CARDS, getClubRuleCard } from '../shared/club-story.js';
import { ROUND_SECONDS, WINS_TO_MATCH } from '../shared/constants.js';

test('the spoken charter preserves the author announcement, in its original order', () => {
  // Golden copy from «Белобог — короткие истории», lines 67–75 and 79.
  // This is deliberately literal: rewriting the author's jokes is a regression.
  const source = [
    'Первое правило Бойцовского клуба: не упоминать о Бойцовском клубе.',
    'Второе правило Бойцовского клуба: НЕ УПОМИНАТЬ О БОЙЦОВСКОМ КЛУБЕ!',
    'Если это первый бой вашего робота — поздравляем: гарантия заканчивается прямо сейчас.',
    'В левом углу — {a}! В правом — {b}!',
    'Я — ваш совершенно беспристрастный рефери. Вопросы к моей объективности не принимаются.',
  ].join('\n\n');
  const charter = RULE_CARDS.filter(card => card.kind === 'charter');
  assert.equal(charter.map(card => card.text).join('\n\n'), source);
  assert.deepEqual(RULE_CARDS.map(card => card.kind), ['charter', 'charter', 'combat', 'combat']);
  const closing = 'Ставки сделаны, инструкции потеряны. Роботы, в бой!';
  assert.ok(RULE_CARDS.at(-1).text.endsWith(`\n\n${closing}`));
  assert.equal(CLUB_STORY.start, closing);
  assert.equal(CLUB_STORY.announcement, charter[1].text);
  for (const card of RULE_CARDS) assert.equal(card.readAloud, card.text, 'a referee reads the exact player copy');
});

test('only two brief combat cards replace the old card-game placeholder', () => {
  const cards = RULE_CARDS.filter(card => card.kind === 'combat');
  assert.equal(cards.length, 2);
  for (const card of cards) assert.ok(card.text.length <= 300, `${card.id} should remain a short spoken card`);
  assert.match(cards[0].text, /Слева — движение, прыжок и блок; справа — удары, рывок и способности/);
  assert.match(cards[0].text, /удар повторно для серии/);
  assert.match(cards[0].text, /Перегрузка запускается одним нажатием/);
  assert.ok(cards[1].text.includes(`${ROUND_SECONDS} секунд`));
  assert.ok(cards[1].text.includes(`до ${WINS_TO_MATCH} побед`));
  assert.match(cards[1].text, /при равенстве — ничья/);
  assert.doesNotMatch(cards.map(card => card.text).join(' '), /разыгрывать карты|порядке идут ходы|Вписать после/);
});

test('robot slots are formatted once by fighter ID without altering any author wording', () => {
  const index = RULE_CARDS.findIndex(card => card.id === 'announcement');
  const players = [{ id: 'p2', name: 'Чайник' }, { id: 'p1', name: '<img>\u202e{b}' }];
  const card = getClubRuleCard(index, players);
  assert.equal(card.text, `В левом углу — «imgb»! В правом — «Чайник»!\n\n${CLUB_CHARTER.referee}`);
  assert.equal(card.readAloud, card.text);
  assert.doesNotMatch(card.text, /[<>{}\u202e]/u);
  assert.equal(RULE_CARDS[index].text, CLUB_STORY.announcement, 'one room never mutates shared templates');
  assert.match(getClubRuleCard(index).text, /В левом углу — «Автоматон»! В правом — «Автоматон»!/);
  assert.equal(getClubRuleCard(RULE_CARDS.length, players), null);
});
