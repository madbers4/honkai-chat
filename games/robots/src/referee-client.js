import { appPaths } from './app-paths.js';

export const REFEREE_SESSION_PREFIX = 'belobog-referee-session:v1:';
export const cleanRoomCode = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
export const validRoomCode = value => /^[A-Z2-9]{6}$/.test(value);

/** Spectator-only transport. No fighter input, ready or rematch API exists here. */
export function createRefereeClient({ room: requestedRoom, origin = globalThis.location?.origin,
  WebSocketImpl = globalThis.WebSocket, storage = globalThis.sessionStorage,
  socketUrl = appPaths.socket(origin), sessionScope = appPaths.base,
  onStatus = () => {}, onSnapshot = () => {}, onFavorite = () => {}, onNotice = () => {},
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const room = cleanRoomCode(requestedRoom), key = `${REFEREE_SESSION_PREFIX}${sessionScope}:${room}`;
  let socket = null, generation = 0, retryTimer = null, heartbeatTimer = null, connectTimer = null;
  let token = null, stopped = true, welcomed = false, attempts = 0, outageAt = null, pendingPing = null;
  let baseline = true, highWater = -1, seen = new Set(), currentState = null, status = 'idle';
  try { const saved = JSON.parse(storage?.getItem(key) || 'null'); if (saved?.room === room && typeof saved.token === 'string' && saved.token.length <= 128) token = saved.token; } catch {}
  const report = (next, message = '') => { status = next; onStatus({ status, message, room }); };
  const cancelTimers = () => { for (const timer of [retryTimer, heartbeatTimer, connectTimer]) if (timer != null) clearTimer(timer); retryTimer = heartbeatTimer = connectTimer = null; };
  const forget = () => { token = null; try { storage?.removeItem(key); } catch {} };
  const transmit = packet => {
    if (!socket || socket.readyState !== 1 || stopped) return false;
    try { socket.send(JSON.stringify(packet)); return true; } catch { return false; }
  };
  function retire() { cancelTimers(); const old = socket; socket = null; generation++; try { old?.close(); } catch {} }
  function halt(next, message, erase = false) {
    stopped = true; welcomed = false; retire(); if (erase) forget(); report(next, message);
  }
  function retry() {
    if (stopped) return;
    if (outageAt == null) outageAt = now();
    if (now() - outageAt >= 180000) { halt('error', 'Время восстановления пульта истекло. Войдите по приглашению заново.', true); return; }
    report('reconnecting', 'Связь потеряна. Возвращаем микрофон…');
    retryTimer = setTimer(open, Math.min(8000, 500 * 2 ** Math.min(attempts++, 4)));
  }
  function lost() { retire(); welcomed = false; retry(); }
  function heartbeat(epoch) {
    if (stopped || epoch !== generation) return;
    if (pendingPing != null && now() - pendingPing > 25000) { lost(); return; }
    if (pendingPing == null) { pendingPing = now(); transmit({ type: 'ping', t: pendingPing }); }
    heartbeatTimer = setTimer(() => heartbeat(epoch), 10000);
  }
  function open() {
    if (stopped) return;
    retire(); baseline = true; pendingPing = null; const epoch = generation;
    report(outageAt == null ? 'connecting' : 'reconnecting', outageAt == null ? 'Подключаем пульт…' : 'Восстанавливаем подключение…');
    try { socket = new WebSocketImpl(socketUrl); } catch { retry(); return; }
    const ownSocket = socket;
    const active = () => !stopped && epoch === generation && socket === ownSocket;
    connectTimer = setTimer(() => { if (active() && !welcomed) lost(); }, 12000);
    ownSocket.addEventListener('open', () => {
      if (!active()) return;
      transmit({ type: 'watch', room, ...(token ? { token } : {}) }); heartbeat(epoch);
    });
    ownSocket.addEventListener('message', event => {
      if (!active()) return;
      let message; try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'refereeWelcome') {
        if (message.room !== room || typeof message.token !== 'string') { halt('error', 'Сервер вернул другую комнату. Откройте приглашение ещё раз.'); return; }
        token = message.token; welcomed = true; attempts = 0; outageAt = null;
        if (connectTimer != null) clearTimer(connectTimer); connectTimer = null;
        try { storage?.setItem(key, JSON.stringify({ room, token })); } catch {}
        report('connected', 'Микрофон у вас');
      } else if (message.type === 'refereeState' && welcomed) {
        onFavorite(['p1', 'p2'].includes(message.favorite) ? message.favorite : 'neutral');
      } else if (message.type === 'state' && welcomed && message.state?.room === room) {
        const state = message.state;
        const events = Array.isArray(state.events) ? state.events : [];
        const freshEvents = baseline ? [] : events.filter(item => item.id != null && !seen.has(item.id) && !(typeof item.id === 'number' && item.id <= highWater));
        for (const item of events) {
          seen.add(item.id); if (typeof item.id === 'number') highWater = Math.max(highWater, item.id);
        }
        if (seen.size > 512) seen = new Set([...seen].slice(-256));
        currentState = state; const wasBaseline = baseline; baseline = false;
        onSnapshot(state, { baseline: wasBaseline, freshEvents });
      } else if (message.type === 'notice') onNotice(String(message.message || 'Уведомление клуба'));
      else if (message.type === 'error') halt('error', String(message.message || 'Не удалось открыть пульт.'), /ключ|истекло|не найдена/i.test(message.message || ''));
      else if (message.type === 'pong' && message.t === pendingPing) pendingPing = null;
    });
    ownSocket.addEventListener('close', event => {
      if (!active()) return;
      if (event.code === 4001) { halt('takenOver', 'Пульт открыт на другом устройстве. Здесь подключение остановлено.'); return; }
      if (event.code === 4000) { halt('closed', 'Комната закрыта. Получите новое приглашение у бойцов.', true); return; }
      lost();
    });
    ownSocket.addEventListener('error', () => { /* Browser close or the bounded handshake timer owns recovery. */ });
  }
  function start({ fresh = false } = {}) {
    if (!validRoomCode(room)) { report('error', 'Введите шестизначный код комнаты из приглашения.'); return false; }
    stopped = false; welcomed = false; attempts = 0; outageAt = null; if (fresh) forget(); open(); return true;
  }
  function advanceRules() {
    const story = currentState?.story;
    if (!welcomed || baseline || status !== 'connected' || story?.stage !== 'rules' || story.paused) return false;
    return transmit({ type: 'storyAdvance', sequenceId: story.sequenceId, ruleIndex: story.ruleIndex });
  }
  function setFavorite(favorite) {
    return welcomed && status === 'connected' && ['p1', 'p2', 'neutral'].includes(favorite)
      ? transmit({ type: 'refereeFavorite', favorite }) : false;
  }
  return Object.freeze({ start, restore: () => token ? start() : false, hasSession: () => Boolean(token), advanceRules, setFavorite,
    stop: () => halt('idle'), forget, getStatus: () => status });
}
