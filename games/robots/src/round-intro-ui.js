import { activeRoundIntroBeat, ROUND_INTRO_DURATION } from '../shared/round-intro.js';

const setText = (element, value) => { const next = String(value ?? ''); if (element.textContent !== next) element.textContent = next; };
const playerName = (player, index) => String(player?.name ?? '').trim() || `Автоматон ${index + 1}`;
const progress = value => Math.max(0, Math.min(1, value));

export function createRoundIntroUI(container) {
  const doc = container.ownerDocument || document;
  const make = (tag, className, value = '') => { const node = doc.createElement(tag); node.className = className; node.textContent = value; return node; };
  const root = make('section', 'round-intro'); root.hidden = true; root.setAttribute('aria-label', 'Перепалка перед раундом');
  const top = make('div', 'round-intro-top');
  const cards = [0, 1].map(index => {
    const card = make('div', `round-intro-card round-intro-card-${index}`);
    const role = make('span', 'round-intro-role', 'НА АРЕНЕ');
    const name = make('strong', 'round-intro-name');
    card.append(role, name); return { card, role, name };
  });
  const badge = make('div', 'round-intro-badge'), number = make('strong', 'round-intro-number'), title = make('span', 'round-intro-title');
  badge.append(number, title); top.append(cards[0].card, badge, cards[1].card);
  const caption = make('div', 'round-intro-caption'), who = make('span', 'round-intro-speaker'), line = make('p', 'round-intro-line');
  const timeline = make('div', 'round-intro-timeline'); timeline.setAttribute('aria-hidden', 'true');
  const fills = [0, 1].map(() => { const track = make('span', 'round-intro-track'), fill = make('i', 'round-intro-fill'); track.append(fill); timeline.append(track); return fill; });
  const note = make('span', 'round-intro-note');
  caption.setAttribute('role', 'status'); caption.setAttribute('aria-live', 'polite');
  caption.append(who, line); const bottom = make('div', 'round-intro-bottom'); bottom.append(caption, timeline, note);
  root.append(top, bottom); container.append(root);
  let disposed = false, lastBeat = null;
  function update({ active = false, players = [], intro, elapsed = 0, paused = false } = {}) {
    if (disposed) return;
    root.hidden = !active;
    if (!active) { lastBeat = null; return; }
    const roster = Array.isArray(players) ? players : [];
    const time = Number.isFinite(Number(elapsed)) ? Math.max(0, Number(elapsed)) : 0;
    const beat = activeRoundIntroBeat(intro, time);
    const foundSeat = roster.findIndex(player => player?.id === beat?.speaker);
    const speakingSeat = foundSeat >= 0 ? foundSeat : beat?.speaker === 'p1' ? 0 : beat?.speaker === 'p2' ? 1 : -1;
    root.dataset.paused = String(paused); root.dataset.speaker = String(speakingSeat);
    setText(number, `РАУНД ${intro?.round || 1}`); setText(title, intro?.title || 'Кабачковое противостояние');
    cards.forEach((card, index) => {
      const speaking = speakingSeat === index;
      setText(card.name, playerName(roster[index], index));
      setText(card.role, speaking ? 'ГОВОРИТ' : beat ? 'СЛУШАЕТ' : 'К БОЮ ГОТОВ');
      card.card.classList.toggle('speaking', speaking);
    });
    const key = `${intro?.id || ''}:${beat?.id || ''}`;
    if (key !== lastBeat) {
      setText(who, beat ? playerName(roster[speakingSeat], Math.max(0, speakingSeat)) : 'АРГУМЕНТЫ ЗАКОНЧИЛИСЬ');
      setText(line, beat?.text || 'Теперь говорят приёмы.'); lastBeat = key;
    }
    fills.forEach((fill, index) => { const window=intro?.beats?.[index]; fill.style.transform = `scaleX(${window?progress((time-window.at)/window.duration):0})`; });
    setText(note, paused ? 'ПАУЗА · ЖДЁМ СОПЕРНИКА' : time >= (intro?.duration??ROUND_INTRO_DURATION) ? 'ПРИГОТОВЬТЕСЬ' : 'СНАЧАЛА СЛОВО. ПОТОМ — БОЙ.');
  }
  return { element: root, update, dispose() { if (disposed) return; disposed = true; root.remove(); } };
}
