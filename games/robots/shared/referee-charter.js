import { CLUB_CHARTER, formatClubText } from './club-story.js';

// «Белобог — короткие истории», §3–4. The public announcement is verbatim;
// the short backstage reminders adapt stage directions to the phone battle.
export const REFEREE_REMINDERS = Object.freeze([
  {title:'Перед выходом',text:'Узнай имена и характеры роботов. Задай по одному вопросу каждой стороне: «Почему ваш робот победит?» На пресс-конференцию — около полуминуты.'},
  {title:'Объявление',text:'Представь обоих бойцов, прочитай устав и короткие правила боя. Карточки на пульте переворачивай после чтения. Во время диалога Джотаро и Дио дай прозвучать записям.'},
  {title:'Совершенно беспристрастно',text:'Тайно выбери фаворита за кулисами. Можно оправдывать его неудачи и переделывать комментарии под своего персонажа. Счёт и попадания объявляй по тому, что произошло на арене.'},
  {title:'Дай бойцам сыграть роль',text:'Поощряй боевые кличи, пафосные позы и обращения к сопернику от лица робота. После боя дай победителю покрасоваться, а проигравшему — произнести последнюю реплику.'},
  {title:'Завершение истории',text:'Печать получают оба бойца. Для истории рефери достаточно объявления и нескольких комментариев: победа фаворита не обязательна. Смену можно передать ведущему или остаться до конца.'},
]);

export function refereeCharter(players=[]) {
  const values={a:players.find(p=>p.id==='p1'),b:players.find(p=>p.id==='p2')};
  return [CLUB_CHARTER.first,CLUB_CHARTER.second,CLUB_CHARTER.warranty,
    formatClubText(CLUB_CHARTER.fighters,values),CLUB_CHARTER.referee,CLUB_CHARTER.start].join('\n\n');
}
