/** Bounded, append-only broadcast transcript. All user names enter textContent.
 * The director owns reading time; this view only moves the paper underneath it. */
export function createRefereeFeed(viewport, { reducedMotion = false, limit = 8 } = {}) {
  const doc = viewport.ownerDocument || document;
  const track = doc.createElement('div'); track.className = 'ref-feed-track'; viewport.replaceChildren(track);
  let entries = [], seen = new Set(), active = null, age = 0, activity = 0, paused = false, moving = false, motion;
  const bottom = () => Math.max(0, (viewport.scrollHeight || 0) - (viewport.clientHeight || 0));
  function append(cue) {
    if (!cue?.id || !cue.text || seen.has(cue.id)) return false;
    seen.add(cue.id); if (seen.size > 256) seen = new Set([...seen].slice(-128));
    const oldTop = active?.node.getBoundingClientRect?.().top;
    const previousNode = active?.node;
    const node = doc.createElement('article'), label = doc.createElement('span'), copy = doc.createElement('p');
    node.className = 'ref-feed-entry'; node.dataset.kind = cue.kind || 'commentary';
    label.className = 'ref-feed-label'; label.textContent = cue.label || 'ВАШ МИКРОФОН';
    copy.className = 'ref-feed-copy'; copy.textContent = cue.text;
    node.append(label, copy); track.append(node);
    active?.node.classList.remove('is-current'); node.classList.add('is-current');
    active = { node, cue }; entries.push(active); age = 0; moving = true;
    while (entries.length > limit) {
      const first = entries.shift(), height = first.node.offsetHeight || 0;
      first.node.remove(); viewport.scrollTop = Math.max(0, viewport.scrollTop - height);
    }
    // A short live comment becomes readable in one arrival, rather than
    // building a scrolling backlog faster than the announcer can catch it.
    // A long charter starts at its first line and then scrolls at reading pace.
    if ((node.offsetHeight || 0) <= (viewport.clientHeight || 0) * .85) {
      viewport.scrollTop = bottom(); moving = false;
    } else if (Number.isFinite(node.offsetTop)) {
      viewport.scrollTop = Math.max(viewport.scrollTop, node.offsetTop - (viewport.clientHeight || 0) * .12);
    }
    const shift = Number.isFinite(oldTop) ? oldTop - (previousNode?.getBoundingClientRect?.().top ?? oldTop) : 0;
    motion?.cancel();
    if (!reducedMotion && cue.kind !== 'recording' && shift > 0) {
      motion = track.animate?.([{ transform: `translateY(${Math.min(160, shift)}px)` }, { transform: 'translateY(0)' }],
        { duration: 1150 - activity * 350, easing: 'cubic-bezier(.2,.65,.3,1)' });
      if (paused) motion?.pause();
    }
    // Captions are tied to recordings and must be fully readable immediately.
    // Motion reduction retains the full scrollable archive without animation.
    if (reducedMotion || cue.kind === 'recording') { viewport.scrollTop = bottom(); moving = false; }
    return true;
  }
  function tick(dt, options = {}) {
    paused = Boolean(options.paused); activity = Math.max(0, Math.min(1, Number(options.activity) || 0));
    viewport.dataset.paused = String(paused);
    viewport.style.setProperty('--ref-activity', String(activity));
    if (paused) motion?.pause(); else if (motion?.playState === 'paused') motion.play();
    if (paused || !active || reducedMotion || !moving) return;
    const delta = Math.max(0, Math.min(.1, Number(dt) || 0)); age += delta;
    const target = bottom(), remaining = target - viewport.scrollTop;
    if (remaining <= .5) { moving = false; return; }
    // Short cues rise faster in a busy fight, never faster than a person can
    // read. Long charter cards have their full server-provided reading period.
    const duration = Math.max(4, active.cue.readSeconds || 8);
    const need = remaining / Math.max(1, duration - age - .8);
    const speed = Math.min(48, Math.max(16 + activity * 12, need));
    viewport.scrollTop = Math.min(target, viewport.scrollTop + speed * delta);
  }
  const onManualScroll = () => { moving = false; };
  viewport.addEventListener('wheel', onManualScroll, { passive: true });
  viewport.addEventListener('touchstart', onManualScroll, { passive: true });
  return { append, tick, clear() { motion?.cancel(); entries = []; seen.clear(); active = null; track.replaceChildren(); viewport.scrollTop = 0; },
    dispose() { motion?.cancel(); viewport.removeEventListener('wheel', onManualScroll); viewport.removeEventListener('touchstart', onManualScroll); track.remove(); } };
}
