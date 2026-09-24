// Cosmetic IDs are the entire network contract. Never accept CSS, texture URLs,
// shader snippets or arbitrary colours from a remote player.
const catalog = values => Object.freeze(values.map(value => Object.freeze(value)));
export const BODY_COLORS = catalog([
  { id: 'original', name: 'Белобог', color: '#7e83ba' },
  { id: 'ruby', name: 'Гранат', color: '#c34348' },
  { id: 'cobalt', name: 'Кобальт', color: '#326bd6' },
  { id: 'jade', name: 'Нефрит', color: '#36a384' },
  { id: 'ivory', name: 'Слоновая кость', color: '#ded3ae' },
  { id: 'graphite', name: 'Графит', color: '#444955' },
  { id: 'copper', name: 'Медный закат', color: '#c97b42' },
]);
export const CORE_COLORS = catalog([
  { id: 'original', name: 'Штатное ядро', color: '#ffb23f' },
  { id: 'amber', name: 'Янтарь', color: '#ffd063' },
  { id: 'cyan', name: 'Ледяное', color: '#50e4ff' },
  { id: 'violet', name: 'Аметист', color: '#b48aff' },
  { id: 'rose', name: 'Розовый разряд', color: '#ff689c' },
  { id: 'lime', name: 'Искра лайма', color: '#a4f86b' },
]);
export const ACCESSORIES = catalog([
  { id: 'none', name: 'Без трофея', description: 'Заводской характер. Лишних деталей нет.' },
  { id: 'crown', name: 'Корона', description: 'Чемпион ещё до первого гонга.' },
  { id: 'topHat', name: 'Цилиндр', description: 'Джентльмен с весьма тяжёлым аргументом.' },
  { id: 'colander', name: 'Дуршлаг', description: 'Шлем. Вентиляция. Ужин. Всё продумано.' },
  { id: 'propeller', name: 'Вертушка', description: 'Добавляет уверенности в аэродинамике.' },
  { id: 'mustache', name: 'Усы', description: 'Серьёзная машина. Несерьёзные усы.' },
]);
export const DEFAULT_CUSTOMIZATION = Object.freeze({ body: 'original', core: 'original', accessory: 'none' });
const ids = { body: new Set(BODY_COLORS.map(x => x.id)), core: new Set(CORE_COLORS.map(x => x.id)), accessory: new Set(ACCESSORIES.map(x => x.id)) };
export function normalizeCustomization(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_CUSTOMIZATION).map(key => [key,
    Object.hasOwn(source, key) && typeof source[key] === 'string' && ids[key].has(source[key]) ? source[key] : DEFAULT_CUSTOMIZATION[key],
  ]));
}
