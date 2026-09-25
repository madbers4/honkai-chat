import { BOOTH_STORY } from './story-content.js';
import { cleanCharacter } from '../shared/fighter-profile.js';

// Identity belongs to the mandatory workshop. The landing page only chooses
// a room; extra lore panels used to obscure those buttons on small phones.
export function createStoryUI() {
  const stats = document.getElementById('result-stats');
  stats.insertAdjacentHTML('afterend', '<div class="story-result"><p id="story-final-line"></p><span id="story-stamp"></span></div>');
  let character = cleanCharacter(localStorage.getItem('belobog-character')), previous;
  return {
    profile: () => ({ character }),
    setCharacter(value) { character = cleanCharacter(value); },
    update(next, playerId) {
      if (next.phase === 'matchOver' && (previous?.phase !== 'matchOver' || previous?.winner !== next.winner)) {
        const training = next.mode === 'training', won = next.winner === playerId;
        document.getElementById('story-final-line').textContent = training
          ? 'Репетиция закончена. Придумай коронную фразу — и вызывай друга.'
          : won ? 'Победителю — микрофон. Произнеси победную реплику от лица своей машины!'
            : 'Последнее слово за тобой. Что скажет твой робот победителю?';
        document.getElementById('story-stamp').textContent = training
          ? 'На стенде эта машина может стать героем твоей истории.' : BOOTH_STORY.completion.stampText;
      }
      previous = next;
    },
    reset() { previous = undefined; },
  };
}
