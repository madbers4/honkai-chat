import { BOOTH_STORY, MICRO_STORIES, ROBOT_TRAITS, ANNOUNCER_LINES } from './story-content.js';
import { fontainkaSignature } from './brand-mark.js';
import { cleanCharacter } from '../shared/fighter-profile.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const text = (id, value) => { if ($(id)?.textContent !== value) $(id).textContent = value; };

export function createStoryUI() {
  document.querySelector('.name-field').insertAdjacentHTML('afterend', `<button class="story-character-button" id="character-btn"><span>ХАРАКТЕР</span><strong id="character-preview">Детали есть. А личность?</strong><b aria-hidden="true">＋</b></button>`);
  document.querySelector('.lobby-footer').insertAdjacentHTML('beforeend', '<button class="text-btn story-open" id="stories-btn">ИСТОРИИ КЛУБА ↗</button>');
  document.querySelector('.waiting-note').insertAdjacentHTML('afterbegin', `<div class="story-press"><span class="story-kicker">ПРЕСС-КОНФЕРЕНЦИЯ / 30 СЕК</span><h3>${BOOTH_STORY.pressConference.title}</h3><p id="press-prompt"></p><div id="press-fighters"></div><small>Ответьте вслух от лица роботов, затем нажмите «Готов».</small><button class="text-btn story-open" data-story-tab="referee">ПАМЯТКА РЕФЕРИ ↗</button></div>`);
  $('result-stats').insertAdjacentHTML('afterend', '<div class="story-result"><p id="story-final-line"></p><span id="story-stamp"></span></div>');
  document.getElementById('app').insertAdjacentHTML('beforeend', `
    <dialog id="character-dialog" class="story-dialog">
      <button class="dialog-close icon-btn" data-close="character-dialog" aria-label="Закрыть">×</button>
      <div class="eyebrow">ПАСПОРТ БОЙЦА</div><h2>ДЕТАЛИ ЕСТЬ.<br><em>А ЛИЧНОСТЬ?</em></h2>
      <p class="story-lede">Имя и характер могут достаться от предыдущей команды. Или придумай своего героя — ведущий представит его зрителям.</p>
      <label class="name-field"><span>ХАРАКТЕР</span><input id="robot-character" maxlength="60" placeholder="Например, застенчивый рыцарь" aria-label="Характер робота" autocomplete="off"></label>
      <div class="story-traits">${ROBOT_TRAITS.map(t=>`<button type="button" data-trait="${esc(t.label)}" title="${esc(t.description)}">${esc(t.label)}</button>`).join('')}</div>
      <p class="story-footnote">Характер — для вашей истории. Боевые возможности у всех одинаковые.</p>
      <button class="button primary" id="character-save">ЭТО МОЙ БОЕЦ <span>→</span></button>
    </dialog>
    <dialog id="stories-dialog" class="story-dialog story-library">
      <button class="dialog-close icon-btn" data-close="stories-dialog" aria-label="Закрыть">×</button>
      ${fontainkaSignature({compact:true})}
      <nav class="story-tabs" aria-label="Истории клуба"><button id="story-tab-stories" aria-pressed="true">КОРОТКИЕ ИСТОРИИ</button><button id="story-tab-referee" aria-pressed="false">ПАМЯТКА РЕФЕРИ</button></nav>
      <div id="story-panel-stories"><h2>У КАЖДОЙ МАШИНЫ<br><em>СВОЯ ИСТОРИЯ.</em></h2><p class="story-lede">Четыре маленькие истории стенда. Начни с любой — проходить их по порядку не нужно.</p>
        <div class="story-cards">${MICRO_STORIES.map(s=>`<article><span class="story-kicker">${esc(s.eyebrow)}</span><h3>${esc(s.title)}</h3><p>${esc(s.prompt)}</p></article>`).join('')}</div>
        <p class="story-footnote">${BOOTH_STORY.completion.stampText} Победа в матче для этого не обязательна.</p>
      </div>
      <div id="story-panel-referee" hidden><h2>МИКРОФОН<br><em>ВАШ.</em></h2><p class="story-lede">Ведущий или гость-рефери даёт бойцам голос. Игроки сражаются с телефонов.</p>
        <ol class="story-host-steps"><li><b>Представь бойцов.</b><span id="referee-fighters">Назови имена роботов и по одной черте характера.</span></li><li><b>Задай по вопросу.</b><span>«Почему ваш робот победит?» — полминуты на обе стороны.</span></li><li><b>Зачитай устав.</b><span>Когда оба бойца готовы, на пульте появятся устав клуба и две короткие карточки боя. Прочитай каждую и нажми «Зачитано — дальше». Затем начнётся выход бойцов.</span></li><li><b>Заверши историю.</b><span>Победителю — поза для публики, проигравшему — последняя реплика. За участие печать получают оба.</span></li></ol>
        <div class="story-host-line"><span class="story-kicker">КОММЕНТАРИЙ РЕФЕРИ</span><p id="referee-line"></p><button class="text-btn" id="referee-next">ЕЩЁ РЕПЛИКА ↻</button></div>
      </div>
    </dialog>`);

  let character = cleanCharacter(localStorage.getItem('belobog-character'));
  let currentState, lineIndex = 0;
  const lines = ['intro','attack','block','parry','whiff','grab','throw','ultimate','paused','finisher'].flatMap(key=>ANNOUNCER_LINES[key]);
  const refreshCharacter = () => text('character-preview', character || 'Детали есть. А личность?');
  refreshCharacter();
  $('character-btn').addEventListener('click', () => { $('robot-character').value = character; $('character-dialog').showModal(); });
  $('character-save').addEventListener('click', () => { character = cleanCharacter($('robot-character').value); localStorage.setItem('belobog-character',character); refreshCharacter(); $('character-dialog').close(); });
  $('robot-character').addEventListener('keydown', e => { if(e.key==='Enter') $('character-save').click(); });
  document.querySelectorAll('[data-trait]').forEach(b=>b.addEventListener('click',()=>{ $('robot-character').value = b.dataset.trait; }));
  function tab(key) {
    for (const t of ['stories','referee']) { $(`story-panel-${t}`).hidden = key!==t; $(`story-tab-${t}`).setAttribute('aria-pressed',String(key===t)); }
    $('stories-dialog').scrollTop = 0;
  }
  document.querySelectorAll('.story-open').forEach(b=>b.addEventListener('click',()=>{ tab(b.dataset.storyTab || 'stories'); $('stories-dialog').showModal(); }));
  for(const t of ['stories','referee']) $(`story-tab-${t}`).addEventListener('click',()=>tab(t));
  text('referee-line',lines[0]);
  $('referee-next').addEventListener('click',()=>text('referee-line',lines[++lineIndex % lines.length]));

  return {
    profile: () => ({character}),
    setCharacter(value) { character = cleanCharacter(value); refreshCharacter(); },
    update(next, playerId) {
      const training = next.mode==='training';
      const profiles = next.players.map(p=>`${p.name}${p.character ? ` — ${p.character}` : ''}`);
      text('press-fighters',profiles.join('\n'));
      text('referee-fighters',profiles.join('. ') || 'Назови имена роботов и по одной черте характера.');
      text('press-prompt',training ? 'Репетиция выхода. Как твой робот представится публике?' : BOOTH_STORY.pressConference.prompts[0]);
      document.querySelector('.story-press').dataset.training=String(training);
      if(next.phase==='matchOver' && (currentState?.phase!=='matchOver' || currentState?.winner!==next.winner)) {
        const won = next.winner===playerId;
        text('story-final-line',training ? 'Репетиция закончена. Придумай коронную фразу — и вызывай друга.' : won ? 'Победителю — микрофон. Произнеси победную реплику от лица своей машины!' : 'Последнее слово за тобой. Что скажет твой робот победителю?');
        text('story-stamp',training ? 'На стенде эта машина может стать героем твоей истории.' : BOOTH_STORY.completion.stampText);
      }
      currentState=next;
    },
    reset() { currentState=null; text('referee-fighters','Назови имена роботов и по одной черте характера.'); },
  };
}
