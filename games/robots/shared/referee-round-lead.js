import { WINS_TO_MATCH } from './constants.js';
import { formatClubText } from './club-story.js';

const readings = {
  opening: [
    'Первый раунд! {a} против {b}. {actor}, красивый выход уже был — теперь красивый бой. Другому участнику желаю ровно того же. Я успел добавить.',
    'Раунд {round}. Знакомьтесь: {a} и {b}. Один из них мне совершенно случайно нравится. Кто именно — слушайте интонацию. Бойцы, готовы?',
    'Кабачковое противостояние начинается! {a}, {b}, телефоны крепко, самооценку повыше. Моя задача — честный счёт и подозрительно эмоциональный комментарий.',
  ],
  level: [
    'Раунд {round}, счёт {score}. Всё поровну. {actor}, можно уже нарушить эту прекрасную симметрию. В спортивном смысле.',
    'Счёт {score}. Равенство сохраняется, моё спокойствие — хуже. {a}, {b}, новый раунд. Покажите, что придумали в перерыве.',
    'Раунд {round}. На табло {score}. Оба знают, как побеждать. {actor}, я уверен, что можно вспомнить ещё раз. Это не подсказка.',
  ],
  leading: [
    'Раунд {round}, счёт {score}. {actor} впереди. Очень разумное положение дел, но матч продолжается. {target}, ваш ответ? Только сначала дождёмся гонга.',
    'Счёт {score}, лидирует {actor}. Объявляю это совершенно спокойно. Сейчас. Уже почти. Бойцы, следующий раунд!',
    'Перед раундом {round}: впереди {actor}. {target}, у вас есть шанс испортить мой совершенно независимый прогноз. Прошу к бою.',
  ],
  trailing: [
    'Раунд {round}. {actor} пока догоняет, счёт {score}. Подчёркиваю слово «пока». {target}, не мешайте мне верить в красивый поворот. Хотя по правилам можете.',
    'Счёт {score}. {actor}, самое время поменять план. Я уже поменял три объяснения и готов к хорошим новостям. Новый раунд!',
    'Раунд {round}. {target} впереди. Произнёс без запинки — профессиональный рост. {actor}, теперь ваша очередь меня приятно удивить.',
  ],
  favoritePoint: [
    'У {actor} матчпойнт! Ещё один выигранный раунд — и матч его. Счёт {score}. Публика, я жду красивой развязки. Совершенно любой. Почти.',
    'Раунд {round}. {actor} в шаге от победы. Мой торжественный голос уже разминается, но {target} ещё может вмешаться. Готовы?',
  ],
  opponentPoint: [
    'Матчпойнт у {target}. Счёт {score}. {actor}, дальше отступать некуда — зато сколько места для камбэка. Я произношу это уверенно, берите пример.',
    'Раунд {round}. {target} нужна одна победа. {actor} нужно срочно сделать эту задачу сложнее. Я ни на что не намекаю. Я практически объявляю.',
  ],
  deciding: [
    'Решающий раунд: по четыре победы! {a} и {b}, один выигранный раунд до титула. {actor}, я спокоен. По голосу не судите. Публика, это финал!',
    'Четыре — четыре. Дальше победа в раунде решает всё. {a}, {b}, покажите лучший бой. {actor}, особенно лучший. Да что же я сегодня такое говорю.',
  ],
  neutral: [
    'Раунд {round}, счёт {score}. {a} и {b}, новая попытка. Публике — хороший бой, бойцам — удачный план, рефери — немного самообладания.',
  ],
};
const hash = value => [...String(value)].reduce((n,c) => Math.imul(n ^ c.charCodeAt(0),16777619)>>>0,2166136261);

/** Local-only: the favorite must never be attached to a shared snapshot or sent
 * with the round-start message. A gate ID pins the chosen reading across renders. */
export function buildRefereeRoundLead(snapshot, favorite = 'neutral') {
  const players = snapshot?.players || [], a = players.find(p=>p.id==='p1'), b = players.find(p=>p.id==='p2');
  const actor = players.find(p=>p.id===favorite), target = players.find(p=>p.id!==favorite);
  const aw = Number(actor?.wins)||0, bw = Number(target?.wins)||0;
  const matchPoint = WINS_TO_MATCH-1;
  const kind = !actor ? 'neutral' : aw===matchPoint&&bw===matchPoint ? 'deciding'
    : aw===matchPoint ? 'favoritePoint' : bw===matchPoint ? 'opponentPoint'
      : !aw&&!bw ? 'opening' : aw>bw ? 'leading' : aw<bw ? 'trailing' : 'level';
  const key = snapshot?.story?.refereeIntro?.sequenceId || `${snapshot?.room}:${snapshot?.round}:${snapshot?.story?.roundIntro?.matchSerial||0}`;
  const options = readings[kind], template = options[hash(key)%options.length];
  return formatClubText(template,{ a, b, actor, target, round:snapshot?.round, score:`${Number(a?.wins)||0} : ${Number(b?.wins)||0}` });
}
