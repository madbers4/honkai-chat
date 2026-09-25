import { planActionCue } from './action-cues.js';
import { actionContext, actionResource } from './action-context.js';
import { V3_RULES, V5_RULES, FINISH_RULES, ROUND_SECONDS } from '../shared/constants.js';

const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };

// Existing buttons acquire contextual moves; the player never needs a third thumb.
export function createCombatUI() {
  const actionButtons = Object.fromEntries([...document.querySelectorAll('[data-action]')].map(button => [button.dataset.action, button]));
  const joystick = document.getElementById('joystick');
  const cueTargets = { ...actionButtons, jump: joystick };
  function showCue(cue) {
    for (const [target, element] of Object.entries(cueTargets)) {
      if (!element) continue;
      const active = cue?.target === target;
      element.classList.toggle('action-cued', active);
      element.dataset.cue = active ? cue.text : '';
      element.dataset.cueTone = active ? cue.tone : '';
      element.setAttribute('aria-description', active ? cue.text : '');
    }
  }
  const banner = document.getElementById('combat-callout');
  const title = document.getElementById('callout-title');
  const subtitle = document.getElementById('callout-subtitle');
  const recipe = document.getElementById('move-recipe');
  const combo = document.getElementById('combo');
  const comboNumber = document.getElementById('combo-number');
  const comboDamage = document.getElementById('combo-damage');
  const escape = document.getElementById('escape-prompt');
  const escapeTitle = document.getElementById('escape-title');
  const escapeDetail = document.getElementById('escape-detail');
  const escapeFill = document.getElementById('escape-fill');
  const dashCost = document.getElementById('dash-cost');
  const finisher = document.getElementById('finisher-prompt');
  const finisherTitle = document.getElementById('finisher-title');
  const finisherDetail = document.getElementById('finisher-detail');
  const finisherKicker = document.getElementById('finisher-kicker');
  const finisherTime = document.getElementById('finisher-time');
  let calloutTimer, comboTimer, priority = 0, context = '', comboTotal = 0, lastHitTime = 0, lastCombo = 0;
  let stats = { bestCombo: 0, parries: 0, damage: 0, escapes: 0, throws: 0, punishes: 0 };
  const recipes = [
    'ТЯЖЁЛЫЙ → ТЯЖЁЛЫЙ → ТЯЖЁЛЫЙ — ПРОБОЙ / КРЮК / ПРЕСС',
    'УДАР → УДАР → ТЯЖЁЛЫЙ — ДРОБИТЕЛЬ',
    'ПОДСВЕТИЛАСЬ КНОПКА? ПРОДОЛЖАЙ СЕРИЮ',
    'ВНИЗ + ТЯЖЁЛЫЙ — ЗАХВАТ ПРОТИВ БЛОКА',
    'ПОПАЛ В СЕРИЮ? РЫВОК — СБРОС ЗА 50 ⚡',
    'ТЯЖЁЛЫЙ → РЫВОК В ЗАМАХЕ — ОБМАН',
    'УДАР → ТЯЖЁЛЫЙ — ПОДБРОС',
    'ВНИЗ + ИМПУЛЬС — ЭМ-МИНА · ПОДБРОС ЗА 35 ⚡',
    'БЛОК ПЕРЕД ПОПАДАНИЕМ — ПАРИРОВАНИЕ',
    'ПРЫЖОК → ТЯЖЁЛЫЙ — УДАР СВЕРХУ',
    'РЫВОК → УДАР — ТАРАН',
  ];
  function callout(text, detail = '', kind = 'amber', importance = 1, duration = 1100) {
    if (importance < priority) return;
    priority = importance;
    setText(title, text); setText(subtitle, detail);
    banner.dataset.kind = kind;
    banner.classList.add('visible');
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => { banner.classList.remove('visible'); priority = 0; }, duration);
  }
  function update(state, playerId, intent = {}) {
    const key = `${state.room}:${state.round}`;
    if (context !== key) {
      context = key; comboTotal = 0; lastCombo = 0; lastHitTime = 0;
      combo.classList.remove('visible'); banner.classList.remove('visible'); priority = 0;
      clearTimeout(calloutTimer); clearTimeout(comboTimer);
    }
    const player = state.players.find(p => p.id === playerId);
    if (!player) { showCue(null); return; }
    const fighting = state.phase === 'fight';
    const moves = actionContext(player, intent, state);
    const actionCue = planActionCue(state, playerId, intent);
    const { defenseOnly, airborne, launcher, crusher, counter, ram, wave, tech, holding, pummelReady, strikeCount, burst, feint, grab, dash, airDash, finish, combo: cue } = moves;
    setText(actionButtons.heavy.querySelector('span'), moves.heavy);
    setText(actionButtons.light.querySelector('span'), moves.light);
    setText(actionButtons.special.querySelector('span'), moves.special);
    actionButtons.special.setAttribute('aria-label', `${wave ? 'Электромагнитная мина' : 'Импульс'}, ${actionResource('special', player, intent, state).cost} энергии`);
    setText(actionButtons.dash.querySelector('span'), dash.label);
    setText(dashCost, dash.cooldown > 0 ? `${dash.cooldown.toFixed(1)}с` : dash.cost ? `${dash.cost} ⚡` : '');
    actionButtons.dash.setAttribute('aria-label', burst ? 'Аварийный сброс, 50 энергии' : feint ? 'Отменить замах, 12 энергии' : airDash ? 'Воздушный рывок' : 'Рывок');
    actionButtons.light.setAttribute('aria-label', tech ? 'Разорвать захват' : holding ? 'Ударить в захвате' : 'Быстрый удар');
    actionButtons.heavy.setAttribute('aria-label', finish.canTrigger ? 'Добивание: сорвать ядро' : holding ? 'Бросить соперника' : grab ? 'Захват' : 'Тяжёлый удар');
    actionButtons.dash.classList.toggle('unavailable', !dash.ready);
    actionButtons.light.classList.toggle('unavailable', holding && !pummelReady);
    actionButtons.special.classList.toggle('wave-mode', wave);
    actionButtons.block.classList.toggle('parry-ready', !defenseOnly && !(player.parryCooldown > 0) && fighting);
    recipe.classList.toggle('active', fighting && (defenseOnly || counter || launcher || airborne || grab || feint || holding || cue.open));
    recipe.dataset.stage = cue.open ? String(cue.stage) : '';
    recipe.hidden = !fighting || player.hp <= 0;
    const tip = actionCue?.key === 'pursue' ? 'СОПЕРНИК ПОДБРОШЕН · МОЖНО ДОГНАТЬ' : tech ? 'ТЕБЯ СХВАТИЛИ — НАЖМИ УДАР!' : holding ? `ДОЖИМ ${strikeCount}/${V5_RULES.grabStrikeLimit} · ТЯЖЁЛЫЙ — БРОСОК · НАЗАД — ЗА СПИНУ` : burst ? (dash.ready ? 'СБРОС РАЗОРВЁТ СЕРИЮ. ЦЕНА — 50 ⚡' : dash.cooldown > 0 ? 'СБРОС ПЕРЕЗАРЯЖАЕТСЯ' : 'ДЛЯ СБРОСА НУЖНО 50 ⚡') : cue.open ? cue.text : feint ? 'РЫВОК СЕЙЧАС — ОТМЕНА ЗАМАХА ЗА 12 ⚡' : grab ? 'ЗАХВАТ ОБХОДИТ БЛОК. ДЕРЖИСЬ БЛИЗКО.' : counter ? 'ОКНО КОНТРАТАКИ — НАНЕСИ УДАР!' : launcher ? 'ТЯЖЁЛЫЙ УДАР ПОДБРОСИТ СОПЕРНИКА' : airborne ? (player.airDashUsed ? 'ВОЗДУШНЫЙ РЫВОК ИСПОЛЬЗОВАН · ТЯЖЁЛЫЙ — ВНИЗ' : 'УДАР — СЕРИЯ · РЫВОК — ДОГНАТЬ · ТЯЖЁЛЫЙ — ВНИЗ') : recipes[Math.max(0, Math.floor((ROUND_SECONDS - state.time) / 8) + (state.round - 1)) % recipes.length];
    setText(recipe, defenseOnly ? 'БЛОК / ПРЫЖОК / НАЗАД · АТАКА ВОССТАНАВЛИВАЕТСЯ' : tip);
    escape.hidden = !fighting || !(tech || holding || burst && dash.ready);
    escape.dataset.kind = tech ? 'tech' : holding ? 'hold' : 'burst';
    setText(escapeTitle, tech ? 'ВЫРВИСЬ!' : holding ? `ДОЖИМ ${strikeCount} / ${V5_RULES.grabStrikeLimit}` : 'РАЗОРВИ СЕРИЮ');
    setText(escapeDetail, tech ? 'НАЖМИ УДАР' : holding ? 'УДАР → ТЯЖЁЛЫЙ' : 'РЫВОК · 50 ⚡');
    escapeFill.style.transform = `scaleX(${tech ? Math.min(1, player.grabTechWindow / V3_RULES.grabTech) : holding ? Math.max(0, 1 - (player.grabHoldTime || 0) / V5_RULES.grabHold) : 1})`;
    finisher.hidden = !finish.active;
    finisher.dataset.stage = state.finish?.stage || '';
    setText(finisherKicker, finish.executing ? 'БЕЛОБОГ ЗАПОМНИТ' : finish.mine ? 'ПОБЕДА В МАТЧЕ · ПОСЛЕДНИЙ ХОД' : 'БОЕВОЙ КОНТУР РАЗРУШЕН');
    setText(finisherTitle, finish.executing ? finish.type === 'brutality' ? 'БРУТАЛИТИ' : finish.type === 'coreRip' ? 'СОРВАННОЕ ЯДРО' : 'КРИТИЧЕСКИЙ ОТКАЗ' : finish.mine ? 'СОРВИ ЯДРО' : 'ЯДРО НЕСТАБИЛЬНО');
    setText(finisherDetail, finish.executing ? '' : finish.canTrigger ? 'НАЖМИ ПОДСВЕЧЕННУЮ КНОПКУ «ДОБИТЬ»' : 'АВТОМАТОН БОЛЬШЕ НЕ МОЖЕТ СРАЖАТЬСЯ');
    finisherTime.style.transform = `scaleX(${Math.min(1, finish.remaining / FINISH_RULES.offerDuration)})`;
    for (const [action, button] of Object.entries(actionButtons)) button.disabled = !fighting && !(finish.canTrigger && ['heavy', 'ultimate'].includes(action))
      || fighting && defenseOnly && ['light', 'heavy', 'special', 'ultimate'].includes(action);
    setText(actionButtons.ultimate.querySelector('span'), finish.canTrigger ? 'ДОБИВАНИЕ' : 'ПЕРЕГРУЗКА');
    actionButtons.ultimate.setAttribute('aria-label', finish.canTrigger ? 'Добивание: сорвать ядро' : 'Перегрузка: нажми один раз, нужно 80 энергии');
    if (finish.canTrigger) {
      actionButtons.ultimate.classList.add('charged'); actionButtons.ultimate.classList.remove('unavailable');
    }
    actionButtons.heavy.classList.toggle('finish-ready', finish.canTrigger);
    showCue(actionCue);
    if (!fighting) banner.classList.remove('visible');
  }
  function event(event, playerId, state) {
    const mine = event.player === playerId;
    if (event.type === 'parry' && mine) stats.parries++;
    if ((event.type === 'grabBreak' && event.reason === 'tech' || event.type === 'burst') && mine) stats.escapes++;
    if (event.type === 'throw' && mine) stats.throws++;
    if (event.type === 'hit' && event.punish && mine) stats.punishes++;
    if (['hit', 'grabStrike'].includes(event.type) && mine) {
      const now = performance.now();
      const count = event.combo || (event.type === 'grabStrike' ? event.chain : 0) || 1;
      if (count <= 1 || count <= lastCombo || now - lastHitTime > 1500) comboTotal = 0;
      comboTotal += event.damage || 0;
      stats.damage += event.damage || 0;
      stats.bestCombo = Math.max(stats.bestCombo, count);
      lastHitTime = now; lastCombo = count;
      if (count > 1) {
        setText(comboNumber, `${count}×`);
        setText(comboDamage, `${Math.round(comboTotal)} УРОНА`);
        combo.classList.add('visible');
        clearTimeout(comboTimer); comboTimer = setTimeout(() => combo.classList.remove('visible'), 1350);
      }
    }
    if (state.phase !== 'fight') return;
    if (event.type === 'grab') callout('ЗАХВАТ', mine ? 'ЗАЩИТА НЕ ПОМОЖЕТ' : 'БЫСТРО НАЖМИ УДАР!', mine ? 'amber' : 'danger', 6, 420);
    else if (event.type === 'grabStrike') callout('УДАР В КОРПУС', mine ? 'ТЯЖЁЛЫЙ — ЗАВЕРШИТЬ БРОСКОМ' : 'КОРПУС НЕ ВЫДЕРЖИВАЕТ', mine ? 'amber' : 'danger', 6, 360);
    else if (event.type === 'grabBreak') callout(event.reason === 'interrupted' ? 'ЗАХВАТ СОРВАН' : 'ВЫРВАЛСЯ!', mine ? 'ДИСТАНЦИЯ ВОССТАНОВЛЕНА' : 'ЗАХВАТ ПРЕРВАН', 'cyan', 6, 850);
    else if (event.type === 'throw') callout('БРОСОК', mine ? 'СХВАТИЛ. ОТБРОСИЛ.' : 'ПРЫЖОК И РЫВОК СПАСАЮТ ОТ ЗАХВАТА', mine ? 'amber' : 'danger', 6, 850);
    else if (event.type === 'burst') callout('АВАРИЙНЫЙ СБРОС', mine ? 'СЕРИЯ ПРЕРВАНА · −50 ЭНЕРГИИ' : 'СОПЕРНИК ПОТРАТИЛ ЗАРЯД НА ЗАЩИТУ', 'cyan', 6, 950);
    else if (event.type === 'feint' && mine) callout('ЛОЖНЫЙ ЗАМАХ', 'ЛОВИ ОТВЕТНЫЙ ПРОМАХ', 'muted', 1, 650);
    else if (event.type === 'hit' && event.punish) callout('НАКАЗАНИЕ ЗА ПРОМАХ', mine ? '+3 УРОНА ЗА ТОЧНЫЙ ОТВЕТ' : 'СОПЕРНИК ПОЙМАЛ ВОССТАНОВЛЕНИЕ', mine ? 'amber' : 'danger', 4, 950);
    else if (event.type === 'parry') callout('ПАРИРОВАНИЕ', mine ? 'ТВОЙ ХОД. КОНТРАТАКУЙ!' : 'СОПЕРНИК ПРОЧИТАЛ АТАКУ', 'cyan', 4);
    else if (event.type === 'hit' && event.counter) callout('КОНТРАТАКА', mine ? 'ПОЙМАН НА ОШИБКЕ' : 'ТЕБЯ ПОДЛОВИЛИ', mine ? 'amber' : 'danger', 4);
    else if (event.type === 'block' && event.guardBreak) callout('ЗАЩИТА СЛОМАНА', mine ? 'ОКНО ДЛЯ АТАКИ' : 'ОТОЙДИ ОТ СОПЕРНИКА', 'danger', 3);
    else if (event.type === 'launch') callout('ПОДБРОС', mine ? 'ПРОДОЛЖИ СЕРИЮ В ВОЗДУХЕ' : 'СОПЕРНИК ПРОДОЛЖАЕТ СЕРИЮ', 'amber', 2, 900);
    else if (event.type === 'slam') callout('УДАР СВЕРХУ', '', 'amber', 2, 800);
    else if (event.type === 'special' && event.variant === 'shockwave') callout('ЭЛЕКТРОМАГНИТНАЯ МИНА', mine ? 'РАЗРЯД · ПОДБРОС · ОГЛУШЕНИЕ' : 'ПРЫГАЙ, ОТОЙДИ ИЛИ БЛОКИРУЙ', 'cyan', 1, 900);
    else if (event.type === 'ultimate') callout('ПЕРЕГРУЗКА', mine ? 'ТРИ ЗАЛПА. ПОЛНЫЙ РАЗРЯД.' : 'ОТОЙДИ ИЛИ ДЕРЖИ БЛОК', mine ? 'amber' : 'danger', 5, 1400);
  }
  function reset() {
    clearTimeout(calloutTimer); clearTimeout(comboTimer); context = ''; priority = 0; showCue(null);
    stats = { bestCombo: 0, parries: 0, damage: 0, escapes: 0, throws: 0, punishes: 0 };
    banner.classList.remove('visible'); combo.classList.remove('visible'); recipe.hidden = true; escape.hidden = true; finisher.hidden = true;
  }
  return { update, event, callout, reset, stats: () => ({ ...stats }) };
}
