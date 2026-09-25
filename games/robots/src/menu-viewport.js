/** Keep forms inside the visible browser area when the Android keyboard opens.
 * The arena still owns its render size; only menu surfaces use these variables. */
export function installMenuViewport({ window: host = window, document: doc = document } = {}) {
  const viewport = host.visualViewport;
  let frame;
  const apply = () => {
    frame = undefined;
    doc.documentElement.style.setProperty('--menu-viewport-height', `${Math.round(viewport?.height || host.innerHeight)}px`);
    doc.documentElement.style.setProperty('--menu-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
    doc.documentElement.classList.toggle('menu-viewport-short', (viewport?.height || host.innerHeight) < 280);
  };
  const update = () => { if (frame === undefined) frame = host.requestAnimationFrame(apply); };
  host.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  apply();
  return () => {
    host.removeEventListener('resize', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    doc.documentElement.style.removeProperty('--menu-viewport-height');
    doc.documentElement.style.removeProperty('--menu-viewport-top');
    doc.documentElement.classList.remove('menu-viewport-short');
  };
}
