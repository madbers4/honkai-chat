import { ATTACKS, ULTIMATE_ARMOR } from '../shared/constants.js';
import { ultimateAvailability } from './ultimate-hold.js';

export function createUltimateUI() {
  const button = document.getElementById('ultimate-btn'), hint = document.getElementById('ultimate-hint');
  const fill = document.getElementById('ultimate-fill'), title = button.querySelector('span');
  let state, id;
  function paint() {
    const player = state?.players?.find(p => p.id === id), available = ultimateAvailability(state, id);
    const cooldown = Math.max(0, player?.cooldowns?.ultimate || 0), energy = player?.energy || 0;
    const committed = player?.action === 'ultimate';
    const charging = committed && player.actionTime < ATTACKS.ultimate.startup;
    const charged = energy >= ATTACKS.ultimate.energy && !cooldown;
    button.classList.toggle('charged', charged || available.immediate || committed);
    button.classList.toggle('unavailable', !charged && !available.immediate && !committed);
    button.classList.toggle('arming', charging); button.classList.toggle('discharging', committed && !charging);
    button.style.setProperty('--charge', String(charging ? Math.min(1, player.actionTime / ATTACKS.ultimate.startup) : committed ? 1 : 0));
    fill.style.transform = `scaleX(${Math.min(1, energy / ATTACKS.ultimate.energy)})`;
    title.textContent = available.immediate ? 'ДОБИВАНИЕ' : charging ? 'ЗАРЯДКА' : committed ? 'РАЗРЯД' : available.ready ? 'НАЖМИ' : charged ? 'ГОТОВА' : 'ПЕРЕГРУЗКА';
    hint.textContent = available.immediate ? 'НАЖМИ · СОРВИ ЯДРО' : charging ? `ЩИТ ${Math.ceil(player.ultimateShield || 0)}/${ULTIMATE_ARMOR.capacity} · ИМПУЛЬС ЕГО СБИВАЕТ` : committed ? 'РАЗРЯД НА ВСЮ АРЕНУ' : cooldown > 0 ? `ОХЛАЖДЕНИЕ ${Math.ceil(cooldown)} С` : charged ? available.ready ? 'ВСЯ АРЕНА · НАЖМИ · 80 ⚡' : 'ГОТОВА · ВЕРНИСЬ В СТОЙКУ' : `80 ⚡ · НУЖНО ЕЩЁ ${Math.ceil(ATTACKS.ultimate.energy - energy)}`;
    button.setAttribute('aria-label', available.immediate ? 'Добивание: нажми, чтобы сорвать ядро' : charging ? 'Перегрузка запущена: реактор заряжается' : committed ? 'Перегрузка: полный разряд' : `Перегрузка, ${available.ready ? 'готова: нажми один раз' : charged ? 'готова: вернись в стойку' : 'нужно 80 энергии'}`);
  }
  return { update(next, playerId) { state = next; id = playerId; paint(); }, hold() { paint(); } };
}
