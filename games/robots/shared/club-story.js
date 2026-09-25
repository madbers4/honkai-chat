import { WINS_TO_MATCH, ROUND_SECONDS } from './constants.js';
import { cleanCharacter } from './fighter-profile.js';

/** Verbatim announcement from «Белобог — короткие истории», lines 67–79.
 * Only the two handwritten robot-name slots become presentation tokens.
 * The source's gameplay placeholder is filled by the two combat cards below. */
export const CLUB_CHARTER = Object.freeze({
  first: 'Первое правило Бойцовского клуба: не упоминать о Бойцовском клубе.',
  second: 'Второе правило Бойцовского клуба: НЕ УПОМИНАТЬ О БОЙЦОВСКОМ КЛУБЕ!',
  warranty: 'Если это первый бой вашего робота — поздравляем: гарантия заканчивается прямо сейчас.',
  fighters: 'В левом углу — {a}! В правом — {b}!',
  referee: 'Я — ваш совершенно беспристрастный рефери. Вопросы к моей объективности не принимаются.',
  start: 'Ставки сделаны, инструкции потеряны. Роботы, в бой!',
});

/** These are stage texts for the short-story adaptation, not new HSR canon. */
export const CLUB_STORY = Object.freeze({
  id: 'belobog-short-v2', brand: 'Фонтейнка', title: 'Новый Бойцовский клуб',
  prologue: [
    'В подземной галерее Белобога открылся Новый Бойцовский клуб. Вывеску уже повесили; разрешение на вывеску пока ищут.',
    'Сегодня на арене встретятся две машины с характером. Назовите своего робота и решите, чем он гордится. Исправностью гордиться необязательно.',
    'Фонтейнка представляет короткую историю о большой славе и мелком крепеже. Её конец вы сейчас сыграете сами.',
  ],
  announcement: `${CLUB_CHARTER.fighters}\n\n${CLUB_CHARTER.referee}`,
  start: CLUB_CHARTER.start,
  refereeBrief: 'Читайте то, что действительно произошло. Можно тайно болеть за одну машину и торжественно оправдывать её неудачи; счёт, попадания и победителя не переиначиваем. Тайное поручение остаётся между вами и ведущим.',
  refereeCompletion: 'Объявление прочитано, несколько моментов прокомментированы — ваша короткая история состоялась. За печатью обратитесь к ведущему. Можно остаться у микрофона или передать ему смену.',
  pressQuestions: [
    'Какое качество вашей машины соперник совершенно напрасно недооценивает?',
    'Что ваш робот скажет перед первым ударом? А если микрофон включён?',
    'Как называется ваш фирменный приём и почему механик запретил его в помещении?',
    'Как ваш робот отмечает победу, если праздничный режим потребляет всю батарею?',
    'О чём ваш робот попросил не рассказывать перед боем?',
    'Представьте свою машину одним предложением. Технический паспорт может возражать.',
  ],
  final: {
    winner: 'Победитель матча — {winner}! Вам слово: сейчас можно хвастаться, и даже рефери обязан потерпеть.',
    loser: '{loser}, последнее слово за вашей машиной. Можно достойное. Можно такое, чтобы ремонтная бригада переспросила.',
    both: 'Две машины, одна законченная история. Оба участника получают печать у ведущего — результат матча этого не меняет.',
    training: 'Репетиция окончена. Теперь вы знакомы с ареной; живую историю и печать поможет завершить ведущий.',
  },
});

const ruleCard = (id, kind, title, text) => Object.freeze({ id, kind, title, text, readAloud: text });
export const RULE_CARDS = Object.freeze([
  ruleCard('charter', 'charter', 'Первое и второе правило',
    [CLUB_CHARTER.first, CLUB_CHARTER.second, CLUB_CHARTER.warranty].join('\n\n')),
  ruleCard('announcement', 'charter', 'Бойцы, на выход', CLUB_STORY.announcement),
  ruleCard('thumbs', 'combat', 'Как драться',
    'Телефон горизонтально. Слева — движение, прыжок и блок; справа — удары, рывок и способности. Нажимайте удар повторно для серии. Перегрузка запускается одним нажатием.'),
  ruleCard('score', 'combat', 'Как победить',
    `Сбейте прочность соперника до нуля. Раунд — ${ROUND_SECONDS} секунд; по таймеру выигрывает тот, у кого больше прочности, при равенстве — ничья. Матч — до ${WINS_TO_MATCH} побед.\n\n${CLUB_CHARTER.start}`),
]);

/** Shared by the player card and referee cue. Names are always plain text;
 * player IDs fix the announced corners even if a client reorders its roster. */
export function getClubRuleCard(index, players = []) {
  const card = RULE_CARDS[index];
  if (!card) return null;
  const text = formatClubText(card.text, {
    a: players.find(player => player.id === 'p1'),
    b: players.find(player => player.id === 'p2'),
  });
  return { ...card, text, readAloud: text };
}

export const PREMATCH_EXCHANGES = Object.freeze([
  { id: "warranty", setup: "Ещё один шаг", first: "{a}: «Ты всё ещё идёшь ко мне?»", reply: "{b}: «Твою броню издалека не помнёшь!»" },
  { id: "quiet", setup: "Зловещий гул", first: "{a}: «Слышишь зловещий гул?»", reply: "{b}: «Это твои колени. Я бы проверил.»" },
  { id: "manual", setup: "Безупречный план", first: "{a}: «У меня есть идеальный план!»", reply: "{b}: «Главное — не забудь удивиться.»" },
  { id: "spares", setup: "Громкость убеждений", first: "{a}: «Что громче: ора или муда?»", reply: "{b}: «Проверим на твоём корпусе!»" },
  { id: "rust", setup: "Застывшая поза", first: "{a}: «Зацени мою устрашающую позу!»", reply: "{b}: «Замри. Хочу запомнить, куда бить!»" },
  { id: "floor", setup: "Величие под потолком", first: "{a}: «Моему величию здесь тесно!»", reply: "{b}: «Пригнись. Тут низкий потолок.»" },
  { id: "calculate", setup: "Секунда вечности", first: "{a}: «Я бы остановил само время!»", reply: "{b}: «Ради паузы между оправданиями?»" },
  { id: "music", setup: "Звёздный выход", first: "{a}: «Это мой звёздный выход!»", reply: "{b}: «Постарайся обойтись без вылета.»" },
  { id: "polite", setup: "Последний поклон", first: "{a}: «Склонись перед моим величием!»", reply: "{b}: «Нагнусь, когда буду тебя собирать.»" },
  { id: "fear", setup: "Нервы из стали", first: "{a}: «Ну что, мурашки по металлу?»", reply: "{b}: «Нет. Прикидываю, где оставить вмятину.»" },
  { id: "champion", setup: "Непобедимый силуэт", first: "{a}: «Запомни мой непобедимый силуэт!»", reply: "{b}: «После боя придётся учить новый.»" },
  { id: "bolts", setup: "Удар для истории", first: "{a}: «Весь подвал запомнит этот удар!»", reply: "{b}: «Главное — сам не забудь встать.»" },
]);

/** A single replacement pass: user names never become markup or template syntax. */
export function formatClubText(template, values = {}) {
  return String(template).replace(/\{(a|b|actor|target|winner|loser|round|score)\}/g, (_, key) => {
    if (key === 'round') return String(Math.max(1, Math.floor(Number(values[key]) || 1)));
    if (key === 'score') return cleanCharacter(values[key] || '0 : 0');
    const supplied = typeof values[key] === 'object' ? values[key]?.name : values[key];
    const name = [...cleanCharacter(supplied).replace(/[«»{}]/g, '')].slice(0, 20).join('') || 'Автоматон';
    return `«${name}»`;
  });
}
