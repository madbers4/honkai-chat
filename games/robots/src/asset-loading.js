export class ArenaLoadError extends Error {
  constructor(kind, message, cause) { super(message, { cause }); this.name = 'ArenaLoadError'; this.kind = kind; }
}

// TextureLoader cannot abort an image request. A late texture still belongs to
// this attempt and must be released instead of leaking into a replacement arena.
export function assetDeadline(load, { timeoutMs = 12000, disposeLate = () => {}, onTimeout = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      onTimeout();
      reject(new ArenaLoadError('network', 'Arena asset request timed out'));
    }, timeoutMs);
    Promise.resolve().then(load).then(value => {
      if (settled) { disposeLate(value); return; }
      settled = true; clearTimeout(timer); resolve(value);
    }, cause => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(cause instanceof ArenaLoadError ? cause : new ArenaLoadError('network', 'Arena asset request failed', cause));
    });
  });
}

let retrySerial = 0;
export function freshAssetUrl(url) {
  const [path, fragment] = url.split('#', 2);
  return `${path}${path.includes('?') ? '&' : '?'}_arenaRetry=${Date.now().toString(36)}-${++retrySerial}${fragment === undefined ? '' : `#${fragment}`}`;
}

/** The automaton GLB is self-contained: one deadline covers fetch + body read.
 * Exactly one fresh retry bypasses an intermittently stalled cached response. */
export async function fetchRobotBuffer(url, { fetchImpl = globalThis.fetch, timeoutMs = 12000, fresh = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    try {
      return await assetDeadline(async () => {
        const refresh = fresh || attempt > 0;
        const response = await fetchImpl(refresh ? freshAssetUrl(url) : url, {
          signal: controller.signal, cache: refresh ? 'reload' : 'default',
        });
        if (!response.ok) throw new ArenaLoadError('network', `Robot request returned HTTP ${response.status}`);
        return response.arrayBuffer();
      }, { timeoutMs, onTimeout: () => controller.abort() });
    } catch (error) { if (attempt === 1) throw error; }
  }
}

/** Share a current attempt and retain only a successful result. Both the model
 * cache and the one page-level arena boot use this so repeated taps cannot race. */
export function retryableLoad(load) {
  let pending, value, loaded = false;
  return () => {
    if (loaded) return Promise.resolve(value);
    if (!pending) pending = Promise.resolve().then(load).then(result => {
      value = result; loaded = true; return result;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export async function loadArenaAssets({ robot, wallpaper, fallbackWallpaper, posters, timeoutMs = 12000, posterTimeoutMs = 3000 }) {
  let failed = false;
  const owned = new Set();
  const dispose = texture => texture?.dispose();
  const retain = texture => {
    if (failed) dispose(texture);
    else if (texture) owned.add(texture);
    return texture;
  };
  const wall = assetDeadline(wallpaper, { timeoutMs, disposeLate: dispose })
    .catch(() => assetDeadline(fallbackWallpaper, { timeoutMs, disposeLate: dispose })).then(retain);
  const poster = assetDeadline(posters, { timeoutMs: posterTimeoutMs, disposeLate: dispose }).catch(() => null).then(retain);
  try {
    const [wallpaperTexture, posterTexture] = await Promise.all([wall, poster, Promise.resolve().then(robot)]);
    return { wallpaper: wallpaperTexture, posterTexture };
  } catch (error) {
    failed = true;
    for (const texture of owned) dispose(texture);
    owned.clear();
    throw error;
  }
}

export function arenaFailureMessage(error) {
  if (error?.kind === 'network') return 'Не удалось скачать файлы арены. Проверь соединение и нажми «Повторить загрузку».';
  if (error?.kind === 'graphics') return 'Браузер не смог включить WebGL. Закрой лишние вкладки и повтори загрузку или открой игру в другом браузере.';
  if (error?.kind === 'model') return 'Не удалось прочитать модель робота. Нажми «Повторить загрузку», чтобы скачать её заново.';
  return 'Не удалось запустить арену. Нажми «Повторить загрузку».';
}
