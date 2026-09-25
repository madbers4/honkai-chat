import { healthFraction } from '../shared/health.js';
import './balance-ui.css';
import { appPaths } from './app-paths.js';
import './style.css';
import './fontainka-brand.css';
import './story.css';
import './ultimate.css';
import './combat-controls.css';
import { mountGraphicsSettings } from './graphics-settings.js';
import { fontainkaSignature } from './brand-mark.js';
import { createStoryUI } from './story-ui.js';
import { createClubJourney } from './club-journey.js';
import QRCode from 'qrcode';
import { createArena } from './arena.js';
import { createControls } from './input.js';
import { ultimateAvailability } from './ultimate-hold.js';
import { createUltimateUI } from './ultimate-ui.js';
import { GameAudio } from './audio.js';
import { createCombatUI } from './combat-ui.js';
import { actionResource, finishContext } from './action-context.js';
import { robotPresentation } from '../shared/robot-presentation.js';
import { WINS_TO_MATCH, MAX_HP, ROUND_SECONDS } from '../shared/constants.js';
import { installMenuViewport } from './menu-viewport.js';
import './mobile-layout.css';
import { retryableLoad, arenaFailureMessage } from './asset-loading.js';
import './load-recovery.css';

const icons = {
  robot: '<path d="m5 7 7-4 7 4v10l-7 4-7-4Z"/><path d="M8 9h8v7H8zm2 3h.01M14 12h.01M12 3V1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  sound: '<path d="m11 5-5 4H3v6h3l5 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 5-5 4H3v6h3l5 4Zm5 4 6 6m0-6-6 6"/>',
  full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01"/>',
  bolt: '<path d="m14 2-9 12h6l-1 8 9-13h-6Z"/>',
  fist: '<path d="M5 12V7a2 2 0 0 1 4 0V5a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v6l-5 7H8L3 13a2 2 0 0 1 2-3l4 3"/>',
  heavy: '<path d="m4 4 6 2 8 8-4 4-8-8Z"/><path d="m15 3 1 4m5 3-4 1M3 15l4 1m3 5 1-4m6 0 4 4"/>',
  shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Zm0 5v9"/>',
  dash: '<path d="m13 4 8 8-8 8M3 7h7M1 12h14M3 17h7"/>',
  crown: '<path d="m3 6 5 5 4-8 4 8 5-5-3 13H6Zm3 16h12"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.robot}</svg>`;
const $ = id => document.getElementById(id);
const audio = new GameAudio();
let arena, socket, state, playerId, room, token, mode = 'pvp', currentView = 'lobby';
let quitting = false, reconnectTimer, reconnectAttempt = 0, pendingRequest, connected = false, assetsReady = false, ping = 0;
let lastPhase, lastCountdown, lastEvent = 0, lastStateAt = 0, toastTimer, inviteUrl = '', serverInfo = null;
let joinedRoom = new URL(location.href).searchParams.get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

document.getElementById('app').innerHTML = `
  <header class="topbar" id="topbar">
    <a href="${appPaths.base}" class="brand" aria-label="Фонтейнка — Новый Бойцовский клуб">${fontainkaSignature()}</a>
    <div class="top-tools"><span class="connection"><i id="connection-dot"></i><span id="connection-label">АРЕНА ЗАГРУЖАЕТСЯ</span></span>
    <button class="icon-btn" id="help-btn" aria-label="Как играть">${icon('help')}</button>
    <button class="icon-btn" id="sound-btn" aria-label="Включить или выключить звук">${icon(audio.muted ? 'mute' : 'sound')}</button>
    <button class="icon-btn" id="fullscreen-btn" aria-label="На весь экран">${icon('full')}</button></div>
  </header>
  <main id="lobby" class="lobby screen">
    <div class="lobby-copy"><div class="eyebrow"><span></span>БЕЛОБОГ / НОВЫЙ</div>
      <h1>БОЙЦОВСКИЙ<span>КЛУБ<span class="title-dot">.</span></span></h1>
      <p class="tagline">Дай машине имя. Покажи характер.<br> Зрители уже ждут твою историю.</p>
      <div class="mode-line"><span>01 — 1 НА 1</span><i></i><span>ДВА ТЕЛЕФОНА</span><i></i><span>ДО ${WINS_TO_MATCH} ПОБЕД</span></div>
      <div class="lobby-actions">
        <label class="name-field"><span>ИМЯ РОБОТА</span><input id="player-name" maxlength="20" placeholder="Как зовут твоего бойца?" autocomplete="nickname" aria-label="Имя робота" /></label>
        <button id="create-btn" class="button primary" disabled><span>${joinedRoom ? 'ПРИНЯТЬ ВЫЗОВ' : 'ВЫЗВАТЬ ДРУГА'}</span>${icon('arrow')}</button>
        <div class="secondary-actions"><button id="training-btn" class="button secondary" disabled>${icon('bolt')}ТРЕНИРОВКА</button><button id="join-btn" class="text-btn">ВВЕСТИ КОД ${icon('arrow')}</button></div>
        <button id="load-retry-btn" class="button secondary load-retry" hidden>ПОВТОРИТЬ ЗАГРУЗКУ ${icon('arrow')}</button>
      </div>
      <div id="load-progress" class="load-progress" role="status" aria-live="polite"><span id="load-text">Подготавливаем автоматонов…</span><div><i id="load-bar"></i></div></div>
    </div>
    <div class="specimen-label"><span class="specimen-line"></span><p>АВТОМАТОН «ЖУК»<small>БОЕВАЯ ЕДИНИЦА / ГОТОВ К АКТИВАЦИИ</small></p><span class="specimen-number">№ 07</span></div>
    <footer class="lobby-footer"><span><i></i>КОРОТКИЕ ИСТОРИИ БЕЛОБОГА</span><button class="text-btn" id="guide-btn">КАК ИГРАТЬ ${icon('arrow')}</button><span class="fan-label">Honkai: Star Rail · фан-проект</span></footer>
  </main>
  <section id="waiting" class="waiting screen" hidden>
    <div class="waiting-card"><div class="eyebrow">ПРИВАТНАЯ АРЕНА / <span id="room-mode">ДУЭЛЬ</span></div>
      <h2 id="waiting-title">ВЫЗОВ<br> <em>БРОШЕН.</em></h2><p id="waiting-description" class="waiting-description">Отправь ссылку другу.<br>Встретимся по ту сторону ринга.</p>
      <div class="invite-box" id="invite-box"><canvas id="invite-qr" aria-label="QR-код приглашения"></canvas><div><span class="micro">КОД КОМНАТЫ</span><strong id="room-code">— — — —</strong><button class="text-btn" id="copy-btn">${icon('copy')}СКОПИРОВАТЬ ССЫЛКУ</button></div></div>
      <input id="invite-link" class="invite-link" readonly aria-label="Ссылка для друга" />
      <div class="players-ready"><div><i id="p1-ready"></i><span id="p1-label">ТЫ</span><small id="p1-status">подключён</small></div><div><i id="p2-ready"></i><span id="p2-label">СОПЕРНИК</span><small id="p2-status">ожидаем…</small></div></div>
      <button id="ready-btn" class="button primary">${icon('fist')}<span>ГОТОВ К БОЮ</span>${icon('arrow')}</button>
      <button id="leave-btn" class="text-btn leave-link">ВЕРНУТЬСЯ В КЛУБ</button>
    </div><div class="waiting-note"><span>ОБРАТИ ВНИМАНИЕ</span><p>Открой ссылку на телефоне<br>и поверни экран горизонтально.</p><small id="network-hint">Для локального сервера оба телефона должны быть в одной Wi-Fi сети.</small></div>
  </section>
  <section id="game" class="game screen" hidden>
    <div class="fight-hud"><div class="fighter-hud amber" id="hud-p1"><div class="fighter-heading"><span class="fighter-code">01</span><strong id="name-p1">АВТОМАТОН</strong><span class="you-tag" id="you-p1">ТЫ</span><span class="wins" id="wins-p1">${Array(WINS_TO_MATCH).fill('◇').join(' ')}</span></div><div class="health-track"><i id="hp-p1"></i><span class="hp-value" id="hp-value-p1">${MAX_HP} / ${MAX_HP}</span></div><div class="meter-row"><div class="energy-track"><i id="energy-p1"></i></div><span id="energy-label-p1">0%</span><div class="guard-track"><i id="guard-p1"></i></div></div></div>
      <div class="round-clock"><span id="round-label">РАУНД 1</span><strong id="timer">${ROUND_SECONDS}</strong><small>ДО ${WINS_TO_MATCH} ПОБЕД</small></div>
      <div class="fighter-hud cyan" id="hud-p2"><div class="fighter-heading"><span class="fighter-code">02</span><strong id="name-p2">АВТОМАТОН</strong><span class="you-tag" id="you-p2">ТЫ</span><span class="wins" id="wins-p2">${Array(WINS_TO_MATCH).fill('◇').join(' ')}</span></div><div class="health-track"><i id="hp-p2"></i><span class="hp-value" id="hp-value-p2">${MAX_HP} / ${MAX_HP}</span></div><div class="meter-row"><div class="energy-track"><i id="energy-p2"></i></div><span id="energy-label-p2">0%</span><div class="guard-track"><i id="guard-p2"></i></div></div></div></div>
    <div class="game-meta"><button id="game-leave-btn" aria-label="Выйти из боя">${icon('close')}</button><span id="game-room">АРЕНА</span><span id="ping">— MS</span><button id="game-guide-btn" aria-label="Приёмы и комбинации">${icon('help')}</button></div>
    <div id="announcement" class="announcement" aria-live="polite"><small id="announcement-sub"></small><strong id="announcement-main"></strong></div>
    <div id="combat-callout" class="combat-callout" aria-live="polite"><strong id="callout-title"></strong><span id="callout-subtitle"></span></div>
    <div id="combo" class="combo"><strong id="combo-number"></strong><div><span>КОМБО</span><small id="combo-damage"></small></div></div>
    <div id="move-recipe" class="move-recipe" hidden></div>
    <div id="escape-prompt" class="escape-prompt" hidden><strong id="escape-title"></strong><span id="escape-detail"></span><div><i id="escape-fill"></i></div></div>
    <div id="controls" class="controls">
      <div class="movement-controls"><div class="stick-wrap"><span class="stick-label">ПРЫЖОК</span><div id="joystick" class="joystick" role="application" aria-label="Джойстик: движение влево и вправо, вверх — прыжок, вниз — присед"><span class="stick-axis x"></span><span class="stick-axis y"></span><span class="stick-direction left">‹</span><span class="stick-direction right">›</span><div id="stick-nub" class="stick-nub">${icon('robot')}</div></div><span class="stick-caption">ДВИЖЕНИЕ <kbd>A D</kbd></span></div><button data-action="block" class="action-btn block-btn" aria-label="Удерживать блок">${icon('shield')}<span>БЛОК</span><kbd>SPACE</kbd></button></div>
      <div class="ultimate-wrap"><button data-action="ultimate" id="ultimate-btn" class="ultimate-btn" aria-label="Перегрузка, 80 энергии: нажми один раз">${icon('crown')}<span>ПЕРЕГРУЗКА</span><kbd>U</kbd><i id="ultimate-fill"></i></button><span id="ultimate-hint">НАКОПИ ЭНЕРГИЮ УДАРАМИ</span></div>
      <div class="attack-controls"><button data-action="dash" class="action-btn dash-btn" aria-label="Рывок">${icon('dash')}<span>РЫВОК</span><kbd>⇧</kbd><small id="dash-cost"></small></button><button data-action="light" class="action-btn light-btn" aria-label="Быстрый удар">${icon('fist')}<span>УДАР</span><kbd>J</kbd></button><button data-action="heavy" class="action-btn heavy-btn" aria-label="Тяжёлый удар">${icon('heavy')}<span>ТЯЖЁЛЫЙ</span><kbd>K</kbd></button><button data-action="special" class="action-btn special-btn" aria-label="Импульс, 25 энергии">${icon('bolt')}<span>ИМПУЛЬС</span><kbd>L</kbd><small id="special-cost">25 ⚡</small></button></div>
    </div>
    <div id="result" class="result" hidden><div class="result-card"><div class="eyebrow" id="result-eyebrow">БОЙ ОКОНЧЕН</div><h2 id="result-title">ПОБЕДА</h2><p id="result-score"></p><div id="result-stats" class="result-stats"></div><button id="rematch-btn" class="button primary">РЕВАНШ ${icon('arrow')}</button><button id="result-leave-btn" class="text-btn">ВЕРНУТЬСЯ В КЛУБ</button></div></div>
  </section>
  <div id="rotate-screen" class="rotate-screen"><div class="rotate-phone">${icon('phone')}</div><div class="eyebrow">АРЕНЕ НУЖНО БОЛЬШЕ МЕСТА</div><h2>ПОВЕРНИ<br><em>ТЕЛЕФОН.</em></h2><p>Два больших пальца. Один соперник.<br>Играй в горизонтальном положении.</p><button id="rotate-fullscreen" class="button secondary">${icon('full')}НА ВЕСЬ ЭКРАН</button></div>
  <dialog id="guide-dialog"><button class="dialog-close icon-btn" data-close="guide-dialog" aria-label="Закрыть">${icon('close')}</button><div class="eyebrow">ИНСТРУКТАЖ / 30 СЕКУНД</div><h2>ОСВОЙ СВОЮ<br><em>МАШИНУ.</em></h2><div class="guide-grid"><div>${icon('dash')}<strong>Левый палец</strong><p>Джойстик — движение.<br>Вверх — прыжок. Вниз — присед.<br>Блок рядом — удерживай, чтобы защищаться.</p></div><div>${icon('fist')}<strong>Правый палец</strong><p>Удар — быстрая серия.<br>Тяжёлый — ломает защиту.<br>Рывок сверху — сблизься или отступи.</p></div><div>${icon('bolt')}<strong>Энергия решает</strong><p>Импульс — выстрел за 25 энергии.<br>80 энергии — нажми «Перегрузку» один раз.<br>Попадания и защита заряжают реактор.</p></div><div>${icon('crown')}<strong>Один победитель</strong><p>Раунд длится ${ROUND_SECONDS} секунд, здоровье — ${MAX_HP} HP.<br>Забери ${WINS_TO_MATCH} раундов, чтобы выиграть матч.<br>Начни с тренировки против бота.</p></div></div><div class="keyboard-guide">КЛАВИАТУРА <span>A / D — движение · W — прыжок · S — присед · J / K — удары · L — импульс · Space — блок · Shift — рывок · U — ульта</span></div><button class="button primary" data-close="guide-dialog">ПОНЯТНО. К БОЮ. ${icon('arrow')}</button></dialog>
  <dialog id="join-dialog"><button class="dialog-close icon-btn" data-close="join-dialog" aria-label="Закрыть">${icon('close')}</button><div class="eyebrow">ТВОЙ СОПЕРНИК УЖЕ ЖДЁТ</div><h2>ПРИНЯТЬ<br><em>ВЫЗОВ.</em></h2><label class="name-field"><span>КОД КОМНАТЫ</span><input id="join-code" maxlength="8" placeholder="КОД КОМНАТЫ" autocomplete="off" autocapitalize="characters" aria-label="Код комнаты" /></label><button id="join-confirm-btn" class="button primary">НА АРЕНУ ${icon('arrow')}</button></dialog>
  <div id="toast" class="toast" role="status"></div>
`;

installMenuViewport();
const savedName = localStorage.getItem('belobog-name');
if (savedName) $('player-name').value = savedName;
const storyUI = createStoryUI();
mountGraphicsSettings($('guide-dialog'));
const journey = createClubJourney($('app'), { send, leave, toast, muted: audio.muted,
  toggleSound: () => { audio.unlock(); audio.toggle(); journey.setMuted(audio.muted); $('sound-btn').innerHTML = icon(audio.muted ? 'mute' : 'sound'); },
  onName: (value, character) => { $('player-name').value = value; storyUI.setCharacter(character); },
});
const signalDot = (color, label) => `<span class="signal-chip"><i style="--signal:#${color.toString(16).padStart(6, '0')}"></i>${label}</span>`;
const healthSignals = [[100,'БОЛЬШЕ 60%'],[55,'26–60%'],[18,'1–25%']].map(([hp,label]) => signalDot(robotPresentation({hp}).healthColor,label)).join('');
document.querySelector('.keyboard-guide').insertAdjacentHTML('beforebegin', `
  <div class="signal-guide"><div class="eyebrow">РОБОТ ГОВОРИТ СВЕТОМ</div>
    <div><strong>Обе линзы — здоровье</strong><div class="signal-chips">${healthSignals}</div><p>Здоровый робот светит ровно. Повреждённый искрит, приводы сбиваются, красные огни предупреждают об отказе.</p></div>
    <div><strong>Реактор — твой цвет и заряд</strong><p>Реактор и кольцо под роботом сохраняют цвет бойца. После проигранного раунда машина отключается и поднимается вновь. Финальное поражение заканчивается разрушением.</p></div>
  </div>
  <div class="combo-book"><div class="eyebrow">СОБЕРИ СВОЮ СЕРИЮ</div>
    <div><span>ТЯЖЁЛЫЙ → ТЯЖЁЛЫЙ → ТЯЖЁЛЫЙ</span><strong>Пробой. Крюк. Пресс.</strong><p>Удары с прыжком: 24 → 28 → 36 урона. Продолжай по подсветке кнопки. После попадания противник может блокировать, прыгнуть или отскочить назад, но перебить продолжение ударом не сможет. Связку можно продолжить и по блоку, и после промаха; за промах тебя могут наказать.</p></div>
    <div><span>УДАР → УДАР → УДАР</span><strong>Джеб. Кросс. Рассечение.</strong><p>Когда кнопка подсветится, нажми снова — даже если первый удар не попал. Клешни меняются, корпус доворачивается, робот продвигается вперёд.</p></div>
    <div><span>УДАР → УДАР → ТЯЖЁЛЫЙ</span><strong>Дробитель.</strong><p>Заверши серию силовым ударом. Финальный удар завершает связку; промах оставит тебя открытым для ответа.</p></div>
    <div><span>УДАР → ТЯЖЁЛЫЙ → ПРЫЖОК</span><strong>Поймай в воздухе.</strong><p>Подбрось соперника, прыгни следом и продолжай ударами. Один воздушный рывок помогает догнать, тяжёлый направляет тебя вниз.</p></div>
    <div><span>ФИНАЛЬНАЯ ПОБЕДА → ДОБИТЬ</span><strong>Сорви ядро.</strong><p>После пятой победы нажми Тяжёлый или Перегрузку во время приглашения. Сильное завершающее комбо может сразу перейти в бруталити.</p></div>
  </div>
  <div class="decision-book"><div class="eyebrow">ЧИТАЙ СОПЕРНИКА</div>
    <div><span>ВНИЗ + ТЯЖЁЛЫЙ <b>→</b> ЗАХВАТ</span><p>Вплотную обходит блок. После захвата нажми Удар до двух раз для ударов в корпус, затем Тяжёлый — бросок. Удерживай движение назад, чтобы бросить за спину. Если схватили тебя — быстро нажми Удар, чтобы вырваться.</p></div>
    <div><span>ПОД УДАРАМИ + РЫВОК <b>→</b> СБРОС</span><p>За 50 энергии прерви чужую серию и отбрось соперника. Работает и в воздухе. Перезарядка — 12 секунд; от захвата спасает Удар.</p></div>
    <div><span>ЗАМАХ ТЯЖЁЛЫМ + РЫВОК <b>→</b> ОБМАН</span><p>Отмени обычный тяжёлый удар в начале замаха и отступи за 12 энергии. Отмена не даёт неуязвимости. Поймай промах соперника ответным ударом: +3 урона.</p></div>
  </div>
  <div class="move-book"><div class="eyebrow">СВЯЗКИ И СПОСОБНОСТИ</div>
    <div><span>УДАР <b>→</b> ТЯЖЁЛЫЙ</span><p>Продолжи быстрый удар тяжёлым — подбросом. Если подброс попал, веди джойстик вверх и догоняй ударами.</p></div>
    <div><span>РЫВОК <b>→</b> УДАР</span><p>Удар во время рывка превращает его в таран. Уклонение заканчивается в момент атаки.</p></div>
    <div><span>ПРЫЖОК <b>→</b> ТЯЖЁЛЫЙ</span><p>Пикирование: при приземлении 28 урона, короткий стан и небольшой отскок соперника от пола.</p></div>
    <div><span>ИМПУЛЬС</span><p>28 урона и короткий электрический стан за 25 энергии. Пригнись под выстрелом, заблокируй его или уклонись.</p></div>
    <div><span>ВНИЗ <b>+</b> ИМПУЛЬС</span><p>Электромагнитная мина за 35 энергии: 42 урона, подброс и короткий стан. Перепрыгни детонацию, отойди или держи блок.</p></div>
    <div><span>ТОЧНЫЙ БЛОК <b>→</b> ОТВЕТ</span><p>Нажми блок прямо перед попаданием: парирование откроет короткое окно для усиленной контратаки.</p></div>
    <div class="overload-recipe"><span>80 ЭНЕРГИИ <b>→</b> НАЖМИ ПЕРЕГРУЗКУ</span><p>Один тап или U запускает зарядку на 0,95 секунды. Приём защищён от обычных ударов и выстрелов, но получает урон. Сильный подброс, захват и разряд могут прервать зарядку. Отойди за отмеченную зону или держи полный блок до конца трёх разрядов.</p></div>
  </div>`);
document.getElementById('escape-prompt').insertAdjacentHTML('afterend', `
  <div id="finisher-prompt" class="finisher-prompt" hidden aria-live="polite">
    <span id="finisher-kicker">ПОСЛЕДНИЙ ХОД</span><strong id="finisher-title">СОРВИ ЯДРО</strong>
    <p id="finisher-detail">НАЖМИ ТЯЖЁЛЫЙ ИЛИ ПЕРЕГРУЗКУ</p><div><i id="finisher-time"></i></div>
  </div>`);
const combatUI = createCombatUI();
const ultimateUI = createUltimateUI();
const setText = (id, value) => { const el = $(id); if (el && el.textContent !== String(value)) el.textContent = value; };
function toast(message) { setText('toast', message); $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4500); }
function showView(view) {
  if (document.body.dataset.view === view) return;
  currentView = view;
  for (const id of ['lobby','waiting','game']) $(id).hidden = id !== view;
  document.body.dataset.view = view;
  $('topbar').hidden = view === 'game' || view === 'story';
  if (view !== 'game') controls?.neutral();
}
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
const controls = createControls({ send, ultimateState: () => ultimateAvailability(state, playerId), onUltimateHold: value => ultimateUI.hold(value), enabled: () => currentView === 'game' && (state?.phase === 'fight' || finishContext(state, playerId).canTrigger) && connected && !document.querySelector('dialog[open]'), onAction: (action, intent) => {
  audio.unlock();
  const me = state?.players?.find(p => p.id === playerId);
  if (state?.phase === 'finishing' && !['heavy', 'ultimate'].includes(action)) return false;
  const { cost, cooldown } = actionResource(action, me, intent, state);
  if (cost && me?.energy < cost - .4) {
    combatUI.callout(`НУЖНО ЕЩЁ ${Math.ceil(cost - me.energy)} ЭНЕРГИИ`, 'ПОПАДАНИЯ И ПАРИРОВАНИЯ ЗАРЯЖАЮТ РЕАКТОР', 'muted', .5, 750);
    audio.play('denied'); return false;
  }
  if (cooldown > .3) {
    combatUI.callout('ПЕРЕЗАРЯДКА', `${cooldown.toFixed(1)} СЕК.`, 'muted', .5, 550);
    return false;
  }
  return true;
} });
function name() { const value = $('player-name').value.trim() || 'Автоматон'; localStorage.setItem('belobog-name', value); return value; }
function setConnection(label, good) { setText('connection-label', label); $('connection-dot').classList.toggle('live', good); }
function connect(request) {
  quitting = false; pendingRequest = request; clearTimeout(reconnectTimer);
  if (socket?.readyState === WebSocket.OPEN) { send(request); pendingRequest = null; return; }
  if (socket?.readyState === WebSocket.CONNECTING) return;
  socket = new WebSocket(appPaths.socket(location.origin));
  const currentSocket = socket;
  setConnection('ПОДКЛЮЧЕНИЕ…', false);
  socket.addEventListener('open', () => {
    if (socket !== currentSocket) return;
    connected = true; reconnectAttempt = 0; controls.resetSequence(); setConnection('СЕРВЕР НА СВЯЗИ', true);
    journey.setConnected(true);
    if (pendingRequest) { send(pendingRequest); pendingRequest = null; }
    else if (room && token) send({ type:'join', room, token, name:name() });
  });
  socket.addEventListener('message', e => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (data.type === 'welcome') {
      lastStateAt = 0;
      room = data.room; playerId = data.playerId; token = data.token;
      sessionStorage.setItem('belobog-session', JSON.stringify({room,playerId,token,mode}));
      if (currentView === 'lobby') showView('waiting');
      updateInvite();
    }
    if (data.type === 'state') receiveState(data.state);
    if (data.type === 'pong') { ping = Math.max(0, Math.round(Date.now() - data.t)); setText('ping', `${ping} MS`); }
    if (data.type === 'notice') toast(data.message);
    if (data.type === 'error') {
      leave();
      toast(data.message || 'Не удалось подключиться к комнате.');
    }
  });
  socket.addEventListener('close', event => {
    if (socket !== currentSocket) return;
    audio.stop();
    audio.updateMusic(state, { connected: false });
    connected = false; controls.neutral(); setConnection('СВЯЗЬ ПРЕРВАНА', false);
    journey.setConnected(false);
    if (event.code === 4001 || event.code === 4000) { leave(); toast(event.reason || 'Комната закрыта.'); return; }
    if (!quitting && room && token) {
      announce('ПЕРЕПОДКЛЮЧЕНИЕ', 'ВОССТАНАВЛИВАЕМ СВЯЗЬ С АРЕНОЙ');
      const delay = Math.min(5000, 500 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(() => connect({type:'join', room, token, name:name()}), delay);
    } else if (!quitting) { toast('Сервер недоступен. Попробуй подключиться ещё раз.'); $('create-btn').disabled = !assetsReady; $('training-btn').disabled = !assetsReady; }
  });
  socket.addEventListener('error', () => {});
}
async function enterRoom(training = false, code = null) {
  if (!assetsReady) { toast('Автоматоны ещё загружаются.'); return; }
  audio.unlock(); journey.unlock(); audio.play('ui');
  // Request while the create/join/training tap still owns browser activation.
  // Rejection is harmless: the responsive menu and rotate prompt remain usable.
  if (matchMedia('(pointer: coarse)').matches) void requestFullscreen();
  mode = training ? 'training' : 'pvp'; lastEvent = 0; lastPhase = null; state = null;
  combatUI.reset();
  $('create-btn').disabled = true; $('training-btn').disabled = true;
  connect(code ? {type:'join',room:code,name:name(),...storyUI.profile(),...journey.profile()} : {type:'create',name:name(),mode,storyMode:true,...storyUI.profile(),...journey.profile()});
}
function leave() {
  audio.stop();
  audio.resetMusic();
  quitting = true; clearTimeout(reconnectTimer); controls.neutral(); socket?.close(); socket = null; connected = false;
  room = null; token = null; playerId = null; state = null; lastPhase = null; lastEvent = 0;
  combatUI.reset();
  storyUI.reset();
  journey.reset();
  delete document.body.dataset.phase; delete document.body.dataset.finish;
  joinedRoom = null;
  const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('room'); history.replaceState(null, '', cleanUrl);
  $('create-btn').querySelector('span').textContent = 'ВЫЗВАТЬ ДРУГА';
  sessionStorage.removeItem('belobog-session'); arena?.update(null, null, 0); showView('lobby'); $('result').hidden = true;
  $('create-btn').disabled = !assetsReady; $('training-btn').disabled = !assetsReady; setConnection('АРЕНА ГОТОВА', true);
}
async function requestFullscreen() {
  audio.unlock();
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch {}
  try { if (screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch {}
  try { await navigator.wakeLock?.request('screen'); } catch {}
}
function announce(main = '', sub = '') {
  setText('announcement-main', main); setText('announcement-sub', sub);
  $('announcement').classList.toggle('visible', !!main);
  $('announcement').classList.toggle('large', /^\d$|БОЙ!|НОКАУТ/.test(main));
}
function updateInvite() {
  let origin = serverInfo?.publicUrl || location.origin;
  if (!serverInfo?.publicUrl && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && serverInfo?.urls?.length) origin = serverInfo.urls.find(url => /\/\/192\.168\./.test(url)) || serverInfo.urls.find(url => !/localhost|127\.0\.0\.1/.test(url)) || origin;
  inviteUrl = appPaths.invite(room, origin, serverInfo?.publicUrl);
  journey.setInvite(inviteUrl);
  setText('room-code', room); $('invite-link').value = inviteUrl;
  QRCode.toCanvas($('invite-qr'), inviteUrl, { width: 120, margin: 1, color: { dark:'#172025', light:'#eee4d2' } }).catch(() => {});
  if (!/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(new URL(origin).hostname)) setText('network-hint', 'Ссылка работает с любого телефона, у которого есть доступ к этому серверу.');
}
function receiveState(next) {
  const now = performance.now();
  const historicalEvents = !lastStateAt || now - lastStateAt > 350 || state?.phase === 'paused';
  lastStateAt = now;
  state = next; mode = next.mode || mode;
  audio.updateMusic(next, { connected });
  // Story snapshots consume the round event below; stop the previous fight's
  // explosion tail before the journey can start the new spoken introduction.
  if (state.phase === 'story' && lastPhase !== 'story') audio.stop();
  storyUI.update(next, playerId);
  if (state.phase === 'paused' && lastPhase !== 'paused') audio.stop();
  document.body.dataset.phase = state.phase;
  document.body.dataset.finish = state.finish?.stage || '';
  arena?.update(state, playerId, 0);
  const inStory = journey.update(next, playerId);
  arena?.setSuspended?.(journey.previewActive());
  if (inStory) {
    for (const event of next.events || []) lastEvent = Math.max(lastEvent, event.id || 0);
    showView('story'); $('result').hidden = true; announce();
    lastPhase = state.phase;
    return;
  }
  const players = state.players || [], me = players.find(p => p.id === playerId);
  if (state.phase === 'waiting') {
    showView('waiting'); $('result').hidden = true;
    const training = mode === 'training';
    $('invite-box').hidden = training; $('invite-link').hidden = training;
    if ($('waiting-title').dataset.mode !== mode) {
      $('waiting-title').innerHTML = training ? 'ПРОВЕРКА<br> <em>СИСТЕМ.</em>' : 'ВЫЗОВ<br> <em>БРОШЕН.</em>';
      $('waiting-title').dataset.mode = mode;
    }
    setText('waiting-description', training ? 'Учебный автоматон уже на арене. Отрепетируй выход и отработай приёмы.' : 'Отправь ссылку сопернику. Пока он подключается — представь своего бойца.');
    setText('room-mode', mode === 'training' ? 'ТРЕНИРОВКА' : 'ДУЭЛЬ');
    for (let i=0;i<2;i++) {
      const p = players[i], prefix = `p${i+1}`;
      setText(`${prefix}-label`, p ? `${p.name}${p.id === playerId ? ' / ТЫ' : ''}` : 'СОПЕРНИК');
      setText(`${prefix}-status`, !p ? 'ожидаем…' : p.ready ? 'готов к бою' : p.connected ? 'подключён' : 'нет связи');
      $(`${prefix}-ready`).classList.toggle('live', !!p?.ready);
    }
    $('ready-btn').disabled = !!me?.ready;
    $('ready-btn').querySelector('span').textContent = me?.ready ? 'ОЖИДАЕМ СОПЕРНИКА…' : 'ГОТОВ К БОЮ';
  } else {
    if (currentView !== 'game') showView('game');
    $('result').hidden = state.phase !== 'matchOver';
    setText('game-room', mode === 'training' ? 'ТРЕНИРОВКА / БОТ' : `АРЕНА ${room}`);
    setText('timer', Math.max(0, Math.ceil(state.time ?? ROUND_SECONDS)).toString().padStart(2,'0'));
    $('timer').classList.toggle('danger', state.time <= 10);
    setText('round-label', `РАУНД ${state.round || 1}`);
    for (const p of players) {
      const id = p.id; if (!$(`hp-${id}`)) continue;
      setText(`name-${id}`, p.name); $(`you-${id}`).hidden = id !== playerId;
      $(`hp-${id}`).style.transform = `scaleX(${healthFraction(p)})`;
      $(`energy-${id}`).style.transform = `scaleX(${Math.min(100,p.energy || 0)/100})`;
      $(`guard-${id}`).style.transform = `scaleX(${Math.min(100,p.guard ?? 100)/100})`;
      setText(`energy-label-${id}`, `${Math.floor(p.energy || 0)}%`);
      setText(`hp-value-${id}`, `${Math.ceil(p.hp || 0)} / ${p.maxHp || MAX_HP}`);
      setText(`wins-${id}`, Array.from({ length: WINS_TO_MATCH }, (_, index) => p.wins > index ? '◆' : '◇').join(' '));
      $(`hud-${id}`).classList.toggle('critical', healthFraction(p) <= .25);
    }
    const specialResource = actionResource('special', me, controls.intent(), state);
    document.querySelector('[data-action="special"]').classList.toggle('unavailable', (me?.energy || 0) < specialResource.cost || specialResource.cooldown > 0);
    setText('special-cost', specialResource.cooldown > 0 ? `${specialResource.cooldown.toFixed(1)}с` : `${specialResource.cost} ⚡`);
    const finish = finishContext(state, playerId);
    $('controls').classList.toggle('inactive', state.phase !== 'fight' && !finish.canTrigger);
    $('controls').classList.toggle('finisher-offer', finish.canTrigger);
    combatUI.update(state, playerId, controls.intent());
    ultimateUI.update(state, playerId);
    if (state.phase === 'countdown') {
      if (lastPhase !== 'countdown' && me?.action === 'recover') audio.play('recover');
      const n = Math.ceil(state.countdown || 0);
      announce(n > 0 ? String(n) : 'БОЙ!', `РАУНД ${state.round || 1} / ПРИГОТОВЬСЯ`);
      if (n !== lastCountdown) { audio.play('countdown'); lastCountdown = n; }
    } else if (state.phase === 'paused') {
      announce('ПАУЗА', connected ? 'ЖДЁМ ВОЗВРАЩЕНИЯ СОПЕРНИКА' : 'ВОССТАНАВЛИВАЕМ СВЯЗЬ');
    } else if (state.phase === 'roundOver') {
      const winner = state.roundWinner || state.winner;
      announce(players.some(p => p.hp <= 0) ? 'НОКАУТ' : 'ВРЕМЯ!', winner ? (winner === playerId ? 'РАУНД ЗА ТОБОЙ' : 'РАУНД ЗА СОПЕРНИКОМ') : 'РАУНД ЗАВЕРШЁН');
    } else if (state.phase === 'finishing') {
      announce();
    } else if (state.phase === 'matchOver') {
      announce();
      const won = state.winner === playerId;
      setText('result-eyebrow', mode === 'training' ? 'РЕПЕТИЦИЯ ЗАВЕРШЕНА' : 'НОВЫЙ БОЙЦОВСКИЙ КЛУБ / ФИНАЛ');
      setText('result-title', state.winner ? (won ? 'ПОБЕДА.' : 'РЕВАНШ?') : 'НИЧЬЯ.');
      $('result-title').classList.toggle('lost', !won);
      setText('result-score', `${players[0]?.wins || 0} : ${players[1]?.wins || 0} — ${won ? 'Твоя машина оказалась сильнее.' : 'Каждый бой делает тебя опаснее.'}`);
      if (lastPhase !== 'matchOver') { if (won) audio.play('win'); $('rematch-btn').disabled = false; $('rematch-btn').innerHTML = `РЕВАНШ ${icon('arrow')}`; }
    } else if (state.phase === 'fight') {
      if (lastPhase === 'countdown') { announce('БОЙ!', ''); audio.play('fight'); setTimeout(() => { if (state?.phase === 'fight') announce(); }, 700); }
      else if (lastPhase !== 'fight') announce();
    }
  }
  for (const event of next.events || []) {
    if (event.id <= lastEvent) continue;
    lastEvent = event.id;
    if (historicalEvents || state.phase === 'paused' || document.hidden) continue;
    const target = ['hit', 'grabStrike'].includes(event.type) ? next.players?.find(player => player.id === event.target) : undefined;
    audio.play(event.type, target ? { ...event, targetHp: target.hp, targetMaxHp: target.maxHp } : event);
    combatUI.event(event, playerId, state);
    if (['hit', 'grabStrike'].includes(event.type) && event.target === playerId && navigator.vibrate && localStorage.getItem('belobog-haptics') !== 'false') navigator.vibrate(event.type === 'grabStrike' ? 30 : 20);
    if (event.type === 'parry' && event.player === playerId && navigator.vibrate && localStorage.getItem('belobog-haptics') !== 'false') navigator.vibrate([10, 25, 10]);
    if (event.type === 'grab' && event.target === playerId && navigator.vibrate && localStorage.getItem('belobog-haptics') !== 'false') navigator.vibrate([15, 20, 15]);
  }
  if (state.phase === 'matchOver') {
    const stats = combatUI.stats();
    setText('result-stats', `СЕРИЯ ${stats.bestCombo}×  /  ПАРИРОВАНИЙ ${stats.parries}  /  ВЫХОДОВ ИЗ СЕРИИ ${stats.escapes}  /  БРОСКОВ ${stats.throws}`);
  }
  lastPhase = state.phase;
}

$('create-btn').addEventListener('click', () => enterRoom(false, joinedRoom));
$('training-btn').addEventListener('click', () => enterRoom(true));
$('ready-btn').addEventListener('click', () => { audio.unlock(); audio.play('ui'); send({type:'ready'}); if (matchMedia('(pointer: coarse)').matches) requestFullscreen(); });
$('join-btn').addEventListener('click', () => $('join-dialog').showModal());
$('join-confirm-btn').addEventListener('click', () => {
  const code = $('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (code.length < 4) { toast('Введи код комнаты, который прислал друг.'); return; }
  $('join-dialog').close(); enterRoom(false, code);
});
$('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-confirm-btn').click(); });
for (const id of ['leave-btn','game-leave-btn','result-leave-btn']) $(id).addEventListener('click', leave);
$('rematch-btn').addEventListener('click', () => { send({type:'rematch'}); combatUI.reset(); $('rematch-btn').disabled = true; $('rematch-btn').textContent = 'ЖДЁМ СОПЕРНИКА…'; });
for (const id of ['help-btn','guide-btn','game-guide-btn']) $(id).addEventListener('click', () => {
  audio.unlock(); audio.play('ui'); controls.neutral(); $('guide-dialog').showModal();
  if (currentView === 'game') { document.querySelector('.signal-guide').scrollIntoView({ block: 'start' }); toast('Бой продолжается, пока открыты приёмы.'); }
  else $('guide-dialog').scrollTop = 0;
});
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r=dialog.getBoundingClientRect(); if (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) dialog.close(); } }));
$('sound-btn').addEventListener('click', () => { audio.unlock(); journey.unlock(); audio.toggle(); journey.setMuted(audio.muted); $('sound-btn').innerHTML = icon(audio.muted ? 'mute' : 'sound'); audio.play('ui'); });
for (const id of ['fullscreen-btn','rotate-fullscreen']) $(id).addEventListener('click', requestFullscreen);
$('copy-btn').addEventListener('click', async () => {
  try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(inviteUrl); else { $('invite-link').focus(); $('invite-link').select(); if (!document.execCommand('copy')) throw Error(); } toast('Ссылка скопирована. Отправь её другу.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('Ссылка выделена — скопируй её вручную.'); }
});
document.addEventListener('pointerdown', () => audio.unlock());
document.addEventListener('pointerdown', () => journey.unlock(), { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.stop(); audio.updateMusic(state, { connected }); });
setInterval(() => { if (connected) send({type:'ping',t:Date.now()}); }, 2500);
showView('lobby');
fetch(appPaths.path('api/info')).then(r => r.ok ? r.json() : null).then(info => { serverInfo = info; if (room) updateInvite(); }).catch(() => {});

const boot = retryableLoad(async () => {
  $('load-retry-btn').disabled = true;
  $('load-retry-btn').hidden = true;
  $('load-progress').classList.remove('complete');
  delete $('load-progress').dataset.failed;
  setText('load-text', 'Подготавливаем автоматонов…');
  setConnection('АРЕНА ЗАГРУЖАЕТСЯ', false);
  $('load-bar').style.width = '5%';
  try {
    arena = await createArena($('arena'), { onLoadProgress: progress => {
      const value = typeof progress === 'number' ? progress : (progress?.loaded / progress?.total || .3);
      $('load-bar').style.width = `${Math.min(95, value <= 1 ? value * 100 : value)}%`;
    } });
    assetsReady = true; $('load-bar').style.width = '100%'; setText('load-text','АВТОМАТОНЫ ГОТОВЫ'); setConnection('АРЕНА ГОТОВА', true);
    $('create-btn').disabled = false; $('training-btn').disabled = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) arena.setReducedMotion?.(true);
  } catch (error) {
    arena?.dispose(); arena = undefined; assetsReady = false;
    $('create-btn').disabled = $('training-btn').disabled = true;
    console.error('Arena initialization failed:', error);
    setText('load-text', arenaFailureMessage(error)); setConnection('ОШИБКА ЗАГРУЗКИ', false);
    $('load-progress').dataset.failed = 'true';
    $('load-retry-btn').hidden = false;
    $('load-retry-btn').disabled = false;
    throw error;
  }
  setTimeout(() => $('load-progress').classList.add('complete'), 1200);
  // A saved-room/network error is independent from successful asset boot. It
  // must not discard a live renderer or start another initialization attempt.
  try {
    const saved = JSON.parse(sessionStorage.getItem('belobog-session') || 'null');
    if (saved?.room && saved?.token && (!joinedRoom || joinedRoom === saved.room)) {
      ({room,token,playerId,mode} = saved); connect({type:'join',room,token,name:name()});
    }
  } catch (error) {
    console.warn('Saved club session could not be restored:', error);
    toast('Арена загружена. Не удалось восстановить комнату — войди по коду или создай новую.');
  }
  return arena;
});
const retryBoot = () => { boot().catch(() => {}); };
$('load-retry-btn').addEventListener('click', retryBoot);
retryBoot();
