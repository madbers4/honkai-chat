import { buildFaceoff } from './faceoff-script.js';
import { buildRoundIntro } from './round-intro.js';

/** Only the current sequence and the selected next exchange, never a catalogue
 * sweep. Shared selection matches players and the referee's deterministic deck. */
export function storyVoicePreload(snapshot = {}, options) {
  const story=snapshot.story||{},info=story.roundIntro||{},round=info.round||snapshot.round||1;
  const players=snapshot.players||[],room=snapshot.room||'',serial=info.matchSerial||0;
  // The referee suppresses playback, not preloading: it can disconnect just
  // before a round, and the recorded cinema always plays in either case.
  if (['workshop','rules','faceoff'].includes(story.stage)||!story.stage) {
    return [...buildFaceoff(players,room,options).filter(beat=>beat.at+beat.duration>(story.stage==='faceoff'?story.elapsed||0:0)),
      ...buildRoundIntro(players,room,1,serial,options).beats];
  }
  // A rematch starts a freshly shuffled deck at round one, not the next round
  // of the old match. Warm it during the finale before an immediate rematch.
  if (['finishing','matchOver'].includes(snapshot.phase)||snapshot.finish)
    return buildRoundIntro(players,room,1,serial+1,options).beats;
  const current=story.stage==='roundIntro'?buildRoundIntro(players,room,round,serial,options).beats:[];
  return [...current,...buildRoundIntro(players,room,round+1,serial,options).beats];
}
