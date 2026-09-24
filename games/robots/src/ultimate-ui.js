import { ATTACKS } from '../shared/constants.js';
import { ultimateAvailability } from './ultimate-hold.js';

export function createUltimateUI() {
  const button = document.getElementById('ultimate-btn'), hint = document.getElementById('ultimate-hint');
  const fill = document.getElementById('ultimate-fill'), title = button.querySelector('span');
  let state, id, hold = { active: false, amount: 0 };
  function paint() {
    const player = state?.players?.find(p => p.id === id), available = ultimateAvailability(state, id);
    const cooldown = Math.max(0, player?.cooldowns?.ultimate || 0), energy = player?.energy || 0;
    const committed = player?.action === 'ultimate';
    const charged = energy >= ATTACKS.ultimate.energy && !cooldown;
    button.classList.toggle('charged', charged || available.immediate || committed);
    button.classList.toggle('unavailable', !charged && !available.immediate && !committed);
    button.classList.toggle('arming', hold.active); button.classList.toggle('discharging', committed);
    button.style.setProperty('--hold', String(hold.active ? hold.amount : committed ? 1 : 0));
    fill.style.transform = `scaleX(${Math.min(1, energy / ATTACKS.ultimate.energy)})`;
    title.textContent = available.immediate ? 'ДОБИВАНИЕ' : committed ? 'РАЗРЯД' : hold.active ? 'ЗАРЯДКА' : charged ? 'ЗАЖМИ' : 'ПЕРЕГРУЗКА';
    hint.textContent = available.immediate ? 'НАЖМИ · СОРВИ ЯДРО' : committed ? 'РЕАКТОР РАСКРЫТ · ПОЛНЫЙ РАЗРЯД' : hold.active ? 'ДЕРЖИ ДО ЗАПОЛНЕНИЯ · ОТПУСТИ ДЛЯ ОТМЕНЫ' : cooldown > 0 ? `ОХЛАЖДЕНИЕ ${Math.ceil(cooldown)} С` : charged ? available.ready ? 'ГОТОВА · ЗАЖМИ 0,65 С · 80 ⚡' : 'ГОТОВА · ВЕРНИСЬ В СТОЙКУ' : `80 ⚡ · НУЖНО ЕЩЁ ${Math.ceil(ATTACKS.ultimate.energy - energy)}`;
    button.setAttribute('aria-label', available.immediate ? 'Добивание: нажми, чтобы сорвать ядро' : hold.active ? 'Зарядка перегрузки, продолжай удерживать' : `Перегрузка, ${charged ? 'готова: удерживай 0,65 секунды' : 'нужно 80 энергии'}`);
    button.setAttribute('aria-pressed', String(hold.active));
  }
  return { update(next, playerId) { state = next; id = playerId; paint(); }, hold(next) { hold = next; paint(); } };
}
