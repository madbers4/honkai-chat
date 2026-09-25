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
  { id: 'warranty', setup: 'Обмен гарантийными обязательствами', first: '{a}: «Подойди. Проверим твою сборку.»', reply: '{b}: «Я отменяю твою гарантию!»', clips: Object.freeze({ a: 'jotaro-round-1', b: 'dio-round-2' }) },
  { id: 'quiet', setup: 'Проверка режима тишины', first: '{a}: «Я работаю бесшумно».', reply: '{b}: «Тогда треск будет мой. Очень удобно».' },
  { id: 'manual', setup: 'Разногласия по инструкции', first: '{a}: «Я изучил все твои слабости».', reply: '{b}: «Это инструкция от чайника. Но две страницы совпадают».' },
  { id: 'spares', setup: 'Обмен искрами', first: '{a}: «Меньше пафоса. Лови искру!»', reply: '{b}: «Твоя зарядка закончилась!»', clips: Object.freeze({ a: 'jotaro-round-2', b: 'dio-round-1' }) },
  { id: 'rust', setup: 'Спор об отделке', first: '{a}: «На тебе ржавчина».', reply: '{b}: «Это выдержка. Я коллекционная модель».' },
  { id: 'floor', setup: 'Знакомство с ареной', first: '{a}: «Пол уже знает моё имя».', reply: '{b}: «Я постараюсь познакомить вас поближе».' },
  { id: 'calculate', setup: 'Точность прогноза', first: '{a}: «Я рассчитал исход этого боя».', reply: '{b}: «Оставь место для исправлений карандашом».' },
  { id: 'music', setup: 'Настройка выхода', first: '{a}: «Где моя победная музыка?»', reply: '{b}: «Пока включили вентиляцию. Начни с неё».' },
  { id: 'polite', setup: 'Обмен любезностями', first: '{a}: «Я дам тебе фору».', reply: '{b}: «Лучше дай розетку. Фора у меня своя».' },
  { id: 'fear', setup: 'Последняя проверка систем', first: '{a}: «Мой процессор не знает страха».', reply: '{b}: «Обновление придёт без предупреждения».' },
  { id: 'champion', setup: 'Заявка на титул', first: '{a}: «Перед тобой будущий чемпион».', reply: '{b}: «А перед тобой проверка настоящего времени».' },
  { id: 'bolts', setup: 'Техническое напутствие', first: '{a}: «Держись крепче».', reply: '{b}: «Это я своим болтам уже сказал».' },
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
