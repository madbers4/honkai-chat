import { activeFaceoffBeat, FACE_OFF_DURATION, FACE_OFF_REVEAL_AT } from '../shared/faceoff-script.js';

const text = (element, value) => { const string = String(value ?? ''); if (element.textContent !== string) element.textContent = string; };
export function createFaceoffUI(container) {
  const doc = container.ownerDocument || document;
  const make = (tag, className, value = '') => { const element = doc.createElement(tag); element.className = className; element.textContent = value; return element; };
  const root = make('section', 'faceoff-scene'); root.hidden = true; root.setAttribute('aria-label', 'Противостояние автоматонов');
  const eyebrow = make('div', 'faceoff-eyebrow', 'НОВЫЙ БОЙЦОВСКИЙ КЛУБ · ВЫХОД НА АРЕНУ');
  const heading = make('div', 'faceoff-heading', 'ЗНАКОМОЕ ПРОТИВОСТОЯНИЕ');
  const names = make('div', 'faceoff-names');
  const cards = [0, 1].map(index => {
    const card = make('div', `faceoff-card faceoff-card-${index}`), role = make('span', 'faceoff-role', index ? 'ВЫЗОВ ПРИНЯТ' : 'ВЫЗОВ БРОШЕН');
    const old = make('s', 'faceoff-wrong-name', index ? 'ДИО' : 'ДЖОТАРО');
    const name = make('strong', 'faceoff-real-name'), status = make('span', 'faceoff-identity-state', 'НЕИЗВЕСТНАЯ ПРОШИВКА');
    card.append(role, old, name, status); names.append(card); return { card, old, name, status };
  });
  const separator = make('span', 'faceoff-vs', 'VS'); names.insertBefore(separator, cards[1].card);
  const caption = make('div', 'faceoff-caption'), speaker = make('span', 'faceoff-speaker'), line = make('p', 'faceoff-line');
  caption.setAttribute('role', 'status'); caption.setAttribute('aria-live', 'polite'); caption.append(speaker, line);
  const bottom = make('div', 'faceoff-bottom'), progress = make('div', 'faceoff-progress'), fill = make('i', 'faceoff-progress-fill');
  progress.append(fill); const countdown = make('span', 'faceoff-countdown'), voice = make('span', 'faceoff-voice-note');
  bottom.append(progress, countdown, voice); root.append(eyebrow, heading, names, caption, bottom); container.append(root);
  let disposed = false, lastBeat = null;
  function update({ active = false, sequenceId, elapsed = 0, paused = false, players = [], beats = [], voiceStatus = {}, reducedMotion = false } = {}) {
    if (disposed) return;
    root.hidden = !active; if (!active) { lastBeat = null; return; }
    const t = Math.max(0, Number(elapsed) || 0), beat = activeFaceoffBeat(beats, t);
    const reveal = t >= FACE_OFF_REVEAL_AT, glitch = t >= 11.5 && t < 13;
    root.dataset.revealed = String(reveal); root.dataset.glitch = String(glitch); root.dataset.paused = String(paused); root.dataset.reduced = String(reducedMotion);
    for (const [index, card] of cards.entries()) {
      const player = players[index]; text(card.name, player?.name || `Автоматон ${index + 1}`);
      card.card.classList.toggle('speaking', beat?.speaker === player?.id);
      text(card.status, reveal ? 'ЛИЧНОСТЬ ВОССТАНОВЛЕНА' : 'НЕИЗВЕСТНАЯ ПРОШИВКА');
    }
    text(heading, paused ? 'СЦЕНА НА ПАУЗЕ' : glitch ? 'ОШИБКА ПРОШИВКИ' : reveal ? 'ТЕПЕРЬ — ВАША ИСТОРИЯ' : 'ЗНАКОМОЕ ПРОТИВОСТОЯНИЕ');
    const identity = players.find(player => player.id === beat?.speaker);
    text(speaker, beat?.speaker === 'narrator' ? glitch ? 'ДИАГНОСТИКА ИМЁН' : 'ФОНТЕЙНКА · НА КОНУ ПАФОС' : identity?.name || 'АВТОМАТОН');
    const key = `${sequenceId}:${beat?.id ?? ''}`;
    if (key !== lastBeat) { text(line, beat?.text || ''); lastBeat = key; }
    caption.dataset.speaker = beat?.speaker || 'narrator';
    fill.style.transform = `scaleX(${Math.min(1, t / FACE_OFF_DURATION)})`;
    text(countdown, paused ? 'ЖДЁМ ВОЗВРАЩЕНИЯ СОПЕРНИКА' : `${Math.ceil(Math.max(0, FACE_OFF_DURATION - t))} С ДО БОЯ`);
    text(voice, voiceStatus.message || 'Оригинальные реплики · имена в субтитрах');
  }
  return { element: root, update, dispose() { if (disposed) return; disposed = true; root.remove(); } };
}
export const mountFaceoffUI = createFaceoffUI;
