import { getClubRuleCard } from './club-story.js';

export const REFEREE_RECONNECT_GRACE = 15;

// A comfortable spoken pace, including breathing room between paragraphs.
// The announcement itself remains the verbatim charter in club-story.js.
export function refereeRuleDuration(index, players = []) {
  const text = getClubRuleCard(index, players)?.readAloud || '';
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(12, Math.min(55, Math.ceil(words / 2) + 5));
}
