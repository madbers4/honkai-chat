import { assetUrl } from './app-paths.js';
// The otter is the supplied artwork. The adjacent name uses the existing UI font;
// the supplied PNG variants contain no wordmark. Import fontainka-brand.css once.
const assetRoot = assetUrl('/assets/fontainka');

export const FONTAINKA_BRAND = Object.freeze({
  name: 'Фонтейнка',
  context: 'CONstanta',
  club: 'Новый Бойцовский клуб',
  colors: Object.freeze({ blue: '#2c9fd9', deepBlue: '#406dab', light: '#f8f8f8', ink: '#2b2a29' }),
  marks: Object.freeze({
    badge: Object.freeze({ width: 256, height: 256, src: `${assetRoot}/otter-badge-256.webp`, srcset: [64, 128, 256].map(width => `${assetRoot}/otter-badge-${width}.webp ${width}w`).join(', ') }),
    portrait: Object.freeze({ width: 512, height: 570, src: `${assetRoot}/otter-portrait-512.webp`, srcset: [128, 256, 512].map(width => `${assetRoot}/otter-portrait-${width}.webp ${width}w`).join(', ') }),
  }),
});

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Pure HTML helper. Empty alt is appropriate when the visible signature names it. */
export function fontainkaMark({ variant = 'badge', size = 36, alt = '' } = {}) {
  const key = variant === 'portrait' ? 'portrait' : 'badge';
  const mark = FONTAINKA_BRAND.marks[key];
  const width = Math.round(Math.max(16, Math.min(160, Number(size) || 36)));
  const height = Math.round(width * mark.height / mark.width);
  return `<img class="fontainka-mark fontainka-mark--${key}" src="${mark.src}" srcset="${mark.srcset}" sizes="${width}px" width="${width}" height="${height}" alt="${escapeHtml(alt)}" decoding="async" draggable="false">`;
}

/** A compact stand credit, not an in-world owner or sponsor claim. */
export function fontainkaSignature({ clubLabel = FONTAINKA_BRAND.club, contextLabel = FONTAINKA_BRAND.context, compact = false } = {}) {
  return `<div class="fontainka-signature${compact ? ' fontainka-signature--compact' : ''}">
    ${fontainkaMark({ size: compact ? 28 : 36 })}
    <div class="fontainka-signature__copy">
      <div class="fontainka-signature__identity"><span class="fontainka-signature__name">${FONTAINKA_BRAND.name}</span>${contextLabel ? `<span class="fontainka-signature__separator" aria-hidden="true">·</span><span class="fontainka-signature__context">${escapeHtml(contextLabel)}</span>` : ''}</div>
      ${clubLabel ? `<span class="fontainka-signature__club">${escapeHtml(clubLabel)}</span>` : ''}
    </div>
  </div>`;
}
