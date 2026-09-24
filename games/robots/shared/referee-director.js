import { MAX_HP } from './constants.js';
import { formatClubText } from './club-story.js';
import { REFEREE_LINES, REFEREE_CATEGORIES } from './referee-lines.js';

const HISTORY = 24, EVENT_HISTORY = 256, QUEUE_LIMIT = 4;
const paused = s => s?.phase === 'paused' || Boolean(s?.story?.paused);
const leader = players => players?.length === 2 && players[0].wins !== players[1].wins
  ? (players[0].wins > players[1].wins ? players[0].id : players[1].id) : null;
const seedNumber = value => [...String(value)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) || 1;
const copyState = s => ({ room: s.room, round: s.round, phase: s.phase, time: s.time, winner: s.winner,
  paused: paused(s), sequenceId: s.story?.sequenceId, stage: s.story?.stage,
  players: (s.players || []).map(p => ({ id: p.id, hp: p.hp, wins: p.wins, maxHp: p.maxHp })) });

/** Pure local presentation state. Never modifies a snapshot or the combat engine. */
export function createRefereeDirector({ seed = 1, favorite = 'neutral' } = {}) {
  let randomState, favoriteId, previous, rawTime, clock, highWater, seen, history, queue, current, currentContext;
  let serial, categoryAt, deficits, quietAt, collecting, pendingCritical;
  const random = () => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    return (randomState >>> 0) / 4294967296;
  };
  function reset() {
    randomState = seedNumber(seed); previous = null; rawTime = null; clock = 0; highWater = -1;
    seen = new Set(); history = []; queue = []; current = null; currentContext = null; serial = 0;
    categoryAt = new Map(); deficits = new Set(); quietAt = 0;
    collecting = false; pendingCritical = null;
    return output();
  }
  function setFavorite(id) { favoriteId = id === 'p1' || id === 'p2' ? id : 'neutral'; return output(); }
  function context(snapshot, actorId, targetId) {
    const players = snapshot.players || [], actor = players.find(p => p.id === actorId), target = players.find(p => p.id === targetId);
    return { actorId, targetId, values: { actor: actor?.name, target: target?.name, a: players[0]?.name, b: players[1]?.name,
      winner: players.find(p => p.id === snapshot.winner)?.name, loser: players.find(p => p.id !== snapshot.winner)?.name,
      round: snapshot.round, score: players.map(p => p.wins || 0).join(' : ') } };
  }
  function choose(candidate, variation = false) {
    const bias = favoriteId !== 'neutral' && candidate.actorId === favoriteId ? 'favored'
      : favoriteId !== 'neutral' && candidate.targetId === favoriteId ? 'opposed' : 'any';
    const options = REFEREE_LINES.filter(line => line.category === candidate.category && !history.includes(line.id)
      && (line.bias === 'any' || line.bias === bias));
    if (!options.length) return null; // Silence is better than repeating an exhausted context.
    const partisan = options.filter(line => line.bias !== 'any');
    const available = partisan.length && random() < .60 ? partisan : options;
    const line = available[Math.floor(random() * available.length)];
    return { ...candidate, lineId: line.id, text: formatClubText(line.text, candidate.values), variation };
  }
  const duration = text => Math.max(5, Math.min(8, 1.2 + [...text].length / 18));
  const cue = (candidate, id, expiry) => Object.freeze({ id, text: candidate.text, category: candidate.category,
    priority: candidate.priority, expiresAt: expiry, sourceEventId: candidate.sourceEventId ?? null });
  function output() {
    const next = queue.find(item => item.freshUntil >= clock);
    return Object.freeze({ current, next: next ? cue(next, `pending:${next.key}`, clock + duration(next.text)) : null });
  }
  function publish(candidate) {
    if (history.includes(candidate.lineId)) candidate = choose(candidate);
    if (!candidate) return;
    history.push(candidate.lineId); if (history.length > HISTORY) history.shift();
    categoryAt.set(candidate.category, clock);
    currentContext = candidate;
    current = cue(candidate, `referee:${++serial}:${candidate.lineId}`, clock + duration(candidate.text));
    quietAt = clock;
  }
  function drain() {
    queue = queue.filter(item => item.freshUntil >= clock);
    if (current && clock < current.expiresAt) return;
    current = null; currentContext = null;
    while (!current && queue.length) publish(queue.shift());
  }
  function enqueue(category, ctx, sourceEventId, key = `${category}:${sourceEventId ?? serial}`, critical = false) {
    const definition = REFEREE_CATEGORIES[category];
    if (!definition || queue.some(item => item.key === key) || currentContext?.key === key) return;
    const cooldown = category === 'hit' || category === 'block' ? 14 : category === 'ultimatePulse' ? 4 : 6;
    if (!critical && clock - (categoryAt.get(category) ?? -Infinity) < cooldown) return;
    const candidate = choose({ ...ctx, category, key, priority: definition.priority, sourceEventId,
      freshUntil: clock + (critical || ['win', 'loss', 'introduction', 'roundStart', 'leadChange'].includes(category) ? 16 : 7) });
    if (!candidate) return;
    if (critical) {
      queue = [];
      if (collecting) {
        if (!pendingCritical || candidate.priority >= pendingCritical.priority) pendingCritical = candidate;
      } else publish(candidate);
      return;
    }
    // Keep one current fact for a category; three fast pulses are not three speeches.
    queue = queue.filter(item => item.category !== category);
    queue.push(candidate); queue.sort((a, b) => b.priority - a.priority);
    queue = queue.slice(0, QUEUE_LIMIT);
  }
  function noteEvent(id) {
    if (typeof id === 'number' && Number.isFinite(id)) highWater = Math.max(highWater, id);
    seen.add(id); if (seen.size > EVENT_HISTORY) seen.delete(seen.values().next().value);
  }
  function baseline(snapshot) {
    for (const event of snapshot.events || []) noteEvent(event.id);
    previous = copyState(snapshot); rawTime = Number.isFinite(snapshot.elapsed) ? snapshot.elapsed : null;
  }
  function eventCandidate(event, snapshot) {
    let actor = event.player, target = event.target ?? snapshot.players.find(p => p.id !== event.player)?.id, category;
    if (event.type === 'round') { if (event.fight) category = 'roundStart'; }
    else if (event.type === 'parry') category = 'parry';
    else if (event.type === 'block') {
      category = event.guardBreak ? 'guardBreak' : 'block';
      if (!event.guardBreak) [actor, target] = [target, actor];
    } else if (event.type === 'grab') category = 'grab';
    else if (event.type === 'grabStrike') category = 'pummel';
    else if (event.type === 'throw') category = 'throw';
    else if (event.type === 'grabBreak' && event.reason === 'tech') category = 'grabBreak';
    else if (event.type === 'burst') category = 'burst';
    else if (event.type === 'feint') category = 'feint';
    else if (event.type === 'ultimate') category = 'ultimateCharge';
    else if (event.type === 'ultimatePulse') category = 'ultimatePulse';
    else if (event.type === 'launch' && event.variant !== 'shockwave') category = 'airLaunch';
    else if (event.type === 'ko' && snapshot.time > 0) { category = 'ko'; actor = event.winner; target = event.target; }
    else if (event.type === 'finisherStart') category = 'finale';
    else if (event.type === 'destruction') category = 'destruction';
    else if (event.type === 'hit') {
      if (event.punish) category = 'whiffPunish';
      else if (event.variant === 'slam') category = 'slam';
      else if (event.variant === 'shockwave') category = 'mine';
      else if (event.variant === 'bolt' || event.action === 'special') category = 'impulse';
      else if (['heavyHook', 'heavyPress'].includes(event.variant)) category = 'heavySeries';
      else if (event.variant === 'heavyDrive') { category = 'defense'; [actor, target] = [target, actor]; }
      else if (['grab', 'overload', 'launcher'].includes(event.variant)) return; // Separate authored event is more accurate.
      else category = event.airborne ? 'airCombo' : 'hit';
    }
    if (!category) return;
    enqueue(category, context(snapshot, actor, target), event.id, `${category}:${event.id}`, ['ko', 'finale', 'destruction'].includes(category));
  }
  function clockDelta(snapshot) {
    if (Number.isFinite(snapshot.elapsed)) return rawTime == null ? 0 : snapshot.elapsed - rawTime;
    // Compatibility with old recordings. New live snapshots should provide elapsed.
    if (snapshot.round === previous.round && snapshot.phase === 'fight' && previous.phase === 'fight') return Math.max(0, previous.time - snapshot.time);
    return 0;
  }
  function update(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return output();
    if (!previous || snapshot.room !== previous.room || (snapshot.story?.sequenceId != null && previous.sequenceId != null && snapshot.story.sequenceId !== previous.sequenceId)) {
      reset(); clock = Number.isFinite(snapshot.elapsed) ? snapshot.elapsed : 0; quietAt = clock; baseline(snapshot);
      if (paused(snapshot)) enqueue('disconnect', context(snapshot), null, 'initial:paused', true);
      else if (snapshot.players.length >= 2 && (snapshot.phase === 'waiting' || snapshot.story?.stage === 'workshop')) { enqueue('introduction', context(snapshot), null, 'initial:introduction'); drain(); }
      return output();
    }
    const delta = clockDelta(snapshot);
    if (delta < -0.001 || snapshot.round < previous.round) {
      // A seek/replay reset never replays the historical event tail. Preserve the
      // event high-water mark and spoken history until an explicit reset/new room.
      queue = []; current = null; currentContext = null; deficits.clear(); baseline(snapshot); return output();
    }
    if (!paused(snapshot) && !previous.paused) clock += Math.max(0, delta);
    const justPaused = paused(snapshot) && !previous.paused, justResumed = !paused(snapshot) && previous.paused;
    if (justPaused) enqueue('disconnect', context(snapshot), null, `pause:${serial}`, true);
    if (justResumed) { current = null; currentContext = null; queue = []; enqueue('reconnect', context(snapshot), null, `resume:${serial}`); }
    if (snapshot.round !== previous.round) { deficits.clear(); queue = []; }
    const newEvents = (snapshot.events || []).filter(event => event.id != null && !seen.has(event.id) && !(typeof event.id === 'number' && event.id <= highWater));
    for (const event of newEvents) noteEvent(event.id);
    if (!paused(snapshot)) {
      collecting = true;
      if (previous.players.length < 2 && snapshot.players.length >= 2 && (snapshot.phase === 'waiting' || snapshot.story?.stage === 'workshop')) enqueue('introduction', context(snapshot), null, 'pair:introduction');
      for (const event of newEvents) eventCandidate(event, snapshot);
      for (const player of snapshot.players) {
        const before = previous.players.find(p => p.id === player.id), other = snapshot.players.find(p => p.id !== player.id);
        if (!before || !other || snapshot.phase !== 'fight') continue;
        const max = player.maxHp || MAX_HP, threshold = max * .25;
        if (before.hp > threshold && player.hp > 0 && player.hp <= threshold) enqueue('lowHp', context(snapshot, player.id, other.id), null, `low:${snapshot.round}:${player.id}`);
        if (player.hp < other.hp - max * .2) deficits.add(player.id);
        const previousOther = previous.players.find(p => p.id === other.id);
        if (previousOther && before.hp < previousOther.hp - max * .2) deficits.add(player.id);
        if (deficits.has(player.id) && previousOther && before.hp <= previousOther.hp && player.hp > other.hp && other.hp > 0) {
          enqueue('comeback', context(snapshot, player.id, other.id), null, `comeback:${snapshot.round}:${player.id}`); deficits.delete(player.id);
        }
      }
      const endedRound = previous.phase === 'fight' && ['roundOver', 'finishing', 'matchOver'].includes(snapshot.phase);
      if (endedRound && !snapshot.roundWinner) enqueue('tie', context(snapshot), null, `tie:${snapshot.round}`, true);
      else if (endedRound && snapshot.time <= 0) enqueue('timeout', context(snapshot, snapshot.roundWinner, snapshot.players.find(p => p.id !== snapshot.roundWinner)?.id), null, `timeout:${snapshot.round}`, true);
      const currentLeader = leader(snapshot.players), priorLeader = leader(previous.players);
      if (currentLeader && currentLeader !== priorLeader && !snapshot.winner) enqueue('leadChange', context(snapshot, currentLeader, snapshot.players.find(p => p.id !== currentLeader)?.id), null, `lead:${snapshot.round}`);
      if (snapshot.phase === 'matchOver' && previous.phase !== 'matchOver' && snapshot.winner) {
        const loser = snapshot.players.find(p => p.id !== snapshot.winner)?.id;
        enqueue('win', context(snapshot, snapshot.winner, loser), null, `winner:${snapshot.round}`, true);
        enqueue('loss', context(snapshot, loser, snapshot.winner), null, `lastword:${snapshot.round}`);
      }
      if (snapshot.phase === 'fight' && clock - quietAt > 18 && !queue.length && (!current || clock >= current.expiresAt)) {
        enqueue('quiet', context(snapshot), null, `quiet:${Math.floor(clock)}`); quietAt = clock;
      }
      collecting = false;
      if (pendingCritical) { publish(pendingCritical); pendingCritical = null; }
      drain();
    }
    baseline(snapshot);
    return output();
  }
  function nextVariation() {
    if (!currentContext) return output();
    const candidate = choose(currentContext, true); if (candidate) publish(candidate);
    return output();
  }
  function acknowledge() { current = null; currentContext = null; drain(); return output(); }
  reset(); setFavorite(favorite);
  return Object.freeze({ update, setFavorite, nextVariation, acknowledge, reset });
}
