import './graphics-settings.css';
import { GRAPHICS_PRESETS, readGraphicsPreference, saveGraphicsPreference, observeGraphicsPreference } from './graphics-quality.js';

export function mountGraphicsSettings(dialog) {
  const root = document.createElement('fieldset'); root.className = 'graphics-settings';
  const descriptions = { sharp: 'Чёткие детали, тени и свечение', balanced: 'Все эффекты, умеренное разрешение', economy: 'Меньше эффектов и нагрузка на батарею' };
  root.innerHTML = `<legend>КАЧЕСТВО ГРАФИКИ</legend><div class="graphics-options">${Object.entries(GRAPHICS_PRESETS).map(([value, preset]) =>
    `<label><input type="radio" name="club-graphics" value="${value}"><span><strong>${preset.label}</strong><small>${descriptions[value]}</small></span></label>`).join('')}</div><p>Применяется сразу и сохраняется на этом устройстве. Если телефон нагревается, выбери сбалансированный режим.</p>`;
  const radios = [...root.querySelectorAll('input')];
  const sync = value => { for (const input of radios) input.checked = input.value === value; };
  root.addEventListener('change', event => { if (radios.includes(event.target)) sync(saveGraphicsPreference(event.target.value)); });
  sync(readGraphicsPreference());
  const stop = observeGraphicsPreference(sync);
  dialog.querySelector('.guide-grid')?.before(root);
  return { dispose() { stop(); root.remove(); } };
}
