import './referee-page.css';
import { createArena } from './arena.js';
import { GameAudio } from './audio.js';
import { createStoryVoice } from './story-voice.js';
import { createRefereeClient, cleanRoomCode, validRoomCode } from './referee-client.js';
import { createRefereeDirector, buildRefereeRoundLead } from '../shared/referee-director.js';
import { createRefereeFeed } from './referee-feed.js';
import { preparationDeadline } from './preparation-deadline.js';
import { REFEREE_CATEGORIES } from '../shared/referee-lines.js';
import { RULE_CARDS, getClubRuleCard } from '../shared/club-story.js';
import { buildFaceoff, activeFaceoffBeat } from '../shared/faceoff-script.js';
import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import { buildRoundIntro, activeRoundIntroBeat } from '../shared/round-intro.js';
import { REFEREE_REMINDERS, refereeCharter } from '../shared/referee-charter.js';

const markup = `
  <header class="ref-header">
    <a class="ref-brand" href="./"><span class="ref-seal" aria-hidden="true">Н</span><span><small>ФОНТЕЙНКА · БОЙЦОВСКИЙ КЛУБ</small><strong>Совершенно неподкупный</strong></span></a>
    <div class="ref-header-tools"><span class="ref-connection" role="status"><i></i><span data-ref="connection">Микрофон свободен</span></span><span class="ref-room" data-ref="room"></span><details class="ref-settings" data-ref="settings"><summary aria-label="Настройки эфира">•••</summary><div><button data-ref="sound" type="button" aria-pressed="true">Звук включён</button><button data-ref="retryAudio" type="button">Повторить загрузку звука</button><button data-ref="private" type="button">За кулисы</button><button data-ref="leave" type="button">Выйти из эфира</button></div></details></div>
  </header>
  <section class="ref-join" data-ref="join">
    <div class="ref-join-copy"><span class="ref-kicker">ВАШ МИКРОФОН. ВАША ВЕРСИЯ СОБЫТИЙ.</span><h1>Неподкупность —<br>дело вкуса.</h1><p>Выберите, за кого тайно болеть. На арене вы беспристрастны. В суфлёре — как получится.</p><span class="ref-join-footnote">Бойцы не видят ваш выбор · счёт и урон честные</span></div>
    <form class="ref-join-form" data-ref="form"><label for="ref-room-input">Код комнаты</label><input id="ref-room-input" data-ref="roomInput" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" inputmode="text" aria-describedby="ref-join-message">
      <fieldset class="ref-favorite" data-ref="favoriteChoice" hidden><legend>Мой совершенно случайный фаворит</legend><label><input type="radio" name="ref-favorite" value="p1"><span data-ref="favorite1">Первый боец · Джотаро</span></label><label><input type="radio" name="ref-favorite" value="p2"><span data-ref="favorite2">Второй боец · Дио</span></label></fieldset>
      <p class="ref-volume">Звук телефона — на полную. Здесь слышны музыка, бойцы и каждый удар.</p><p id="ref-join-message" data-ref="joinMessage" role="status">Сначала найдём бойцов по коду комнаты.</p><button class="ref-primary" data-ref="enter" type="submit">Подключиться к комнате →</button></form>
  </section>
  <main class="ref-layout" data-ref="live" hidden>
    <section class="ref-arena-panel" aria-label="Живая арена">
      <div id="arena" class="ref-arena"></div>
      <div class="ref-scoreboard">
        <div class="ref-fighter ref-fighter-one"><div class="ref-fighter-title"><strong data-ref="name1">Первый боец</strong><span data-ref="hp1">—</span></div><div class="ref-health"><i data-ref="bar1"></i></div><div class="ref-wins" data-ref="wins1"></div></div>
        <div class="ref-round"><strong data-ref="clock">—</strong><span data-ref="round">АРЕНА</span></div>
        <div class="ref-fighter ref-fighter-two"><div class="ref-fighter-title"><strong data-ref="name2">Второй боец</strong><span data-ref="hp2">—</span></div><div class="ref-health"><i data-ref="bar2"></i></div><div class="ref-wins" data-ref="wins2"></div></div>
      </div>
      <div class="ref-arena-loading" data-ref="loading" role="status">Готовим арену…</div>
      <div class="ref-arena-bottom"><span class="ref-live-label"><i></i> ПРЯМОЙ ЭФИР</span><span data-ref="arenaStatus"></span></div>
    </section>
    <section class="ref-reading" aria-label="Суфлёр рефери">
      <div class="ref-paper"><div class="ref-paper-heading"><span class="ref-kicker" data-ref="category">ВАШ МИКРОФОН</span><span class="ref-read-badge" data-ref="badge">ЧИТАТЬ ВСЛУХ</span></div>
        <div class="ref-script-scroll ref-feed" data-ref="feed" tabindex="0" aria-label="Лента реплик. Новые реплики снизу."></div>
        <div class="ref-gate" data-ref="gate" hidden><p>Зачитайте подводку. Отсчёт начнётся только по вашему сигналу.</p><button class="ref-primary" data-ref="startRound" type="button">НАЧАТЬ РАУНД</button></div>
        <p class="ref-reading-note" data-ref="note">Фразы — опора. Ваши слова здесь тоже к месту.</p>
      </div>
    </section>
  </main>
  <div class="ref-notice" data-ref="notice" role="status" hidden></div>
  <dialog class="ref-private-dialog" data-ref="dialog" aria-labelledby="ref-private-title"><div class="ref-dialog-top"><span class="ref-kicker">ЗА КУЛИСАМИ</span><button class="ref-icon-button" data-ref="closePrivate" type="button" aria-label="Закрыть приватные настройки">✕</button></div><h2 id="ref-private-title">Абсолютно объективно.</h2><p data-ref="favoriteStatus">Тайный фаворит остаётся на этом пульте.</p><p>Суфлёр сам выбирает момент для реплики. Можно говорить своими словами и оставлять паузы. После каждой подводки дайте сигнал к началу раунда.</p><div data-ref="reference"></div></dialog>
`;

/** Explicit spectator entry: audio is prepared by a gesture before joining.
 * No device speech, silent autoplay, or fighter commands live on this page. */
export function mountRefereePage({ container = document.body, room = new URL(location.href).searchParams.get('room') || '',
  createArenaImpl = createArena, createClientImpl = createRefereeClient,
  createAudioImpl = () => new GameAudio(), createVoiceImpl = createStoryVoice,
  waitForLayout,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  const root = document.createElement('div'); root.className = 'referee-shell'; root.innerHTML = markup;
  container.replaceChildren(root); document.body.classList.add('referee-page'); document.title = 'Неподкупный рефери · Фонтейнка';
  const $ = key => root.querySelector(`[data-ref="${key}"]`);
  const setText = (key, value) => { const element = $(key); if (element.textContent !== value) element.textContent = value; };
  const reference = document.createElement('details'); reference.className = 'ref-lore-reference';
  const summary = document.createElement('summary'); summary.textContent = 'Устав и памятка рефери'; reference.append(summary);
  const charter = document.createElement('p'); charter.className = 'ref-charter'; reference.append(charter);
  for (const reminder of REFEREE_REMINDERS) {
    const section = document.createElement('section'), title = document.createElement('h3'), copy = document.createElement('p');
    title.textContent = reminder.title; copy.textContent = reminder.text; section.append(title, copy); reference.append(section);
  }
  $('reference').append(reference);
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const feed = createRefereeFeed($('feed'), { reducedMotion: reduced });
  const audio = createAudioImpl(); audio.muted = false;
  const voice = createVoiceImpl({ onStatus(value) { if (value.retryAvailable && state) notice('Не все записи доступны. Повторите загрузку звука в меню •••.'); } });
  let client, arena, arenaPromise, state = null, director, reading = {}, selectedRoom = cleanRoomCode(room);
  let connection = 'idle', favorite = null, desiredFavorite = null, pendingStart = null, pendingTimer, noticeTimer;
  let disposed = false, preparing = false, prepared = false, onAir = false, joiningAir = false, readySent = false, entryGeneration = 0, frame, lastFrame = null;
  let sceneKey = '', sceneBeats = [], renderedStage = '', profileKey = '', muted = false, voiceEpoch = 0;
  $('roomInput').value = selectedRoom;
  for (const key of ['wins1', 'wins2']) for (let i = 0; i < WINS_TO_MATCH; i++) { const dot = document.createElement('i'); $(key).appendChild(dot); }
  function notice(message) {
    if (disposed) return; setText('notice', message); $('notice').hidden = false; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (!disposed) $('notice').hidden = true; }, 6000);
  }
  const suspended = () => disposed || document.hidden || connection !== 'connected' || state?.phase === 'paused' || state?.story?.paused;
  function clearPending() { pendingStart = null; clearTimeout(pendingTimer); }
  function stopSound() { voice.cancel(); audio.stop(); audio.updateMusic(state, { connected: false }); }
  function updateConnection(info) {
    if (disposed) return; connection = info.status; root.dataset.connection = connection;
    setText('connection', info.message || 'Микрофон свободен');
    if (connection === 'connected' && !onAir) { setText('enter', 'Включить звук и выйти в эфир →'); setText('joinMessage', 'Выберите настоящего фаворита. Это останется между вами и суфлёром.'); }
    if (connection !== 'connected') { stopSound(); clearPending(); if (state) arena?.update({ ...state, phase: 'paused', pausedFrom: state.phase, events: [] }, null); }
    if (['error', 'closed', 'takenOver', 'idle'].includes(connection)) {
      $('join').hidden = false; $('live').hidden = true;
      if (info.message) setText('joinMessage', info.message);
      onAir = false; joiningAir = false;
      setText('enter', connection === 'takenOver' ? 'Вернуть микрофон сюда' : 'Подключиться к комнате →');
    }
    $('enter').disabled = preparing || ['connecting', 'reconnecting'].includes(connection);
    $('settings').hidden = !onAir; setText('room', selectedRoom ? `№ ${selectedRoom}` : ''); render();
  }
  async function prepareArena() {
    if (arena) return arena;
    if (!arenaPromise) arenaPromise = Promise.resolve().then(() => createArenaImpl(root.querySelector('#arena'), {
      onLoadProgress: progress => { if (!disposed) setText('loading', `Готовим арену · ${Math.round(progress * 100)}%`); },
    })).then(result => {
      if (disposed) { result.dispose(); return; }
      arena = result; if (reduced) arena.setReducedMotion?.(true);
      if (state) arena.update({ ...state, events: [] }, null); $('loading').hidden = true; return arena;
    }).catch(error => { arenaPromise = null; if (!disposed) setText('loading', 'Арена не загрузилась. Повторите вход.'); throw error; });
    return arenaPromise;
  }
  function updateVoice() {
    if (!state) return;
    const story = state.story || {}, stage = story.stage;
    if (!['faceoff', 'roundIntro'].includes(stage)) { voice.cancel(); return; }
    const timing = stage === 'roundIntro' ? story.roundIntro || {} : story;
    const key = `${stage}:${timing.sequenceId || story.sequenceId}`;
    if (sceneKey !== key) {
      sceneKey = key; sceneBeats = stage === 'faceoff' ? buildFaceoff(state.players, state.room)
        : buildRoundIntro(state.players, state.room, timing.round || state.round, timing.matchSerial || 0).beats;
    }
    voice.update({ sequenceId: `${key}:broadcast:${voiceEpoch}`, beats: sceneBeats, elapsed: timing.elapsed || 0, paused: suspended(), enabled: onAir && prepared && !muted });
  }
  function receive(snapshot, meta = {}) {
    if (disposed) return;
    const previous = state;
    if (snapshot.phase === 'story' && state?.phase !== 'story') audio.stop();
    state = snapshot;
    if (pendingStart && state.story?.refereeIntro?.sequenceId !== pendingStart || state.story?.stage !== 'refereeIntro') clearPending();
    $('join').hidden = onAir; $('live').hidden = !onAir;
    $('favoriteChoice').hidden = false;
    const freshEvents = suspended() ? [] : meta.freshEvents || [], liveState = { ...snapshot, events: freshEvents };
    reading = director.update(liveState); arena?.update(liveState, null);
    audio.updateMusic(snapshot, { connected: onAir && connection === 'connected' }); updateVoice();
    if (onAir && !meta.baseline && !suspended() && snapshot.phase !== 'story') {
      for (const event of freshEvents) {
        const target = snapshot.players.find(p => p.id === event.target);
        audio.play(event.type, { ...event, targetHp: target?.hp, targetMaxHp: target?.maxHp });
      }
      if (snapshot.phase === 'countdown') {
        if (previous?.phase !== 'countdown' && snapshot.players.some(player => player.action === 'recover')) audio.play('recover');
        if (previous?.phase !== 'countdown' || Math.ceil(previous.countdown) !== Math.ceil(snapshot.countdown)) audio.play('countdown');
      } else if (snapshot.phase === 'fight' && previous?.phase === 'countdown') audio.play('fight');
      else if (snapshot.phase === 'matchOver' && previous?.phase !== 'matchOver') audio.play('win');
    }
    render();
  }
  function makeClient() {
    client?.stop(); audio.resetMusic(); voice.cancel(); state = null; profileKey = ''; sceneKey = ''; renderedStage = ''; onAir = false; joiningAir = false; clearPending(); feed.clear();
    director = createRefereeDirector({ seed: selectedRoom, favorite: desiredFavorite, realtime: true }); reading = {};
    favorite = null;
    client = createClientImpl({ room: selectedRoom, onStatus: updateConnection, onSnapshot: receive, onNotice: notice,
      onFavorite(value, meta = {}) {
        if (disposed) return;
        favorite = ['p1', 'p2'].includes(value) ? value : null;
        if (!favorite && desiredFavorite && joiningAir) { client?.setFavorite(desiredFavorite); return; }
        if (favorite) {
          desiredFavorite = favorite;
          const radio = root.querySelector(`[name="ref-favorite"][value="${favorite}"]`); if (radio) radio.checked = true;
        }
        director.setFavorite(favorite);
        if (joiningAir && favorite && prepared && !meta.prepared && !readySent) { readySent = Boolean(client?.markReady()); }
        if (joiningAir && favorite && prepared && meta.prepared) {
          onAir = true; joiningAir = false; voiceEpoch++; feed.clear(); renderedStage = '';
          director.reset(); director.setFavorite(favorite); if (state) reading = director.update({ ...state, events: [] });
          $('join').hidden = true; $('live').hidden = false; $('settings').hidden = false;
          updateVoice(); audio.updateMusic(state, { connected: true });
        }
        render();
      } });
    return client;
  }
  function scoreboard() {
    for (let i = 0; i < 2; i++) {
      const id = `p${i + 1}`, p = state?.players.find(player => player.id === id), n = i + 1, maxHp = p?.maxHp || MAX_HP, hp = Math.max(0, p?.hp ?? maxHp);
      setText(`name${n}`, p?.name || 'Ждём бойца'); setText(`hp${n}`, p ? `${Math.ceil(hp)} / ${maxHp}` : '—');
      $(`bar${n}`).style.transform = `scaleX(${Math.min(1, hp / maxHp)})`;
      $(`wins${n}`).setAttribute('aria-label', `Побед: ${p?.wins || 0} из ${WINS_TO_MATCH}`);
      [...$(`wins${n}`).children].forEach((dot, j) => dot.classList.toggle('won', j < (p?.wins || 0)));
      setText(`favorite${n}`, p?.name || (i ? 'Второй боец · Дио' : 'Первый боец · Джотаро'));
    }
    const stage = state?.story?.stage;
    setText('round', `РАУНД ${state.round}`);
    setText('clock', stage === 'refereeIntro' ? '—' : state.phase === 'countdown' ? String(Math.ceil(state.countdown)) : String(Math.ceil(Math.max(0, state.time || 0))));
    setText('arenaStatus', suspended() ? 'Пауза · сохраняем ваше место' : stage === 'refereeIntro' ? 'Арена ждёт ваш сигнал' : state.phase === 'matchOver' ? 'Матч завершён' : 'До пяти побед');
    const nextProfile = JSON.stringify(state.players.map(p => [p.id, p.name, p.character]));
    if (nextProfile !== profileKey) { profileKey = nextProfile; charter.textContent = refereeCharter(state.players); }
    setText('favoriteStatus', favorite ? `Мой тайный фаворит: ${state.players.find(p => p.id === favorite)?.name || favorite}. Никому ни слова. Даже если всё очевидно.` : 'Секретное поручение ещё подтверждается.');
  }
  function render() {
    if (disposed || !state) return;
    scoreboard(); const story = state.story || {}, stage = story.stage || state.phase, frozen = suspended();
    root.dataset.stage = stage;
    if (renderedStage !== stage) {
      // Keep combat commentary together, but never force the referee to hunt
      // for an actor's caption or the next round's ceremonial start.
      if (['rules', 'faceoff', 'roundIntro', 'refereeIntro'].includes(stage)) feed.clear();
      renderedStage = stage;
    }
    let category = 'ВАШ МИКРОФОН', badge = 'ЧИТАТЬ ВСЛУХ', note = 'Фразы — опора. Ваши слова здесь тоже к месту.';
    $('gate').hidden = stage !== 'refereeIntro';
    if (stage === 'rules') {
      const card = getClubRuleCard(story.ruleIndex, state.players);
      category = `УСТАВ · ${story.ruleIndex + 1} / ${RULE_CARDS.length}`;
      if (card) feed.append({ id: `${story.sequenceId}:rule:${story.ruleIndex}`, text: card.readAloud, label: card.title,
        kind: 'charter', readSeconds: story.duration || 35 });
      note = 'Читайте вслух в своём темпе. Карточки сменяются сами.';
    } else if (stage === 'faceoff' || stage === 'roundIntro') {
      const timing = stage === 'roundIntro' ? story.roundIntro || {} : story;
      const beat = stage === 'faceoff' ? activeFaceoffBeat(sceneBeats, timing.elapsed || 0)
        : activeRoundIntroBeat({ beats: sceneBeats, duration: sceneBeats.reduce((end, item) => Math.max(end, item.at + item.duration), 0) }, timing.elapsed || 0);
      category = stage === 'faceoff' ? 'ВЫХОД БОЙЦОВ' : `ПЕРЕПАЛКА · РАУНД ${state.round}`; badge = 'ГОВОРЯТ БОЙЦЫ';
      if (beat) feed.append({ id: `${sceneKey}:${beat.id}`, text: beat.text, kind: 'recording', readSeconds: beat.duration,
        label: state.players.find(p => p.id === beat.speaker)?.name || 'ФОНТЕЙНКА' });
      note = 'Запись звучит на арене. Сейчас можно дать бойцам договорить.';
    } else if (stage === 'refereeIntro') {
      category = `ВАШЕ СЛОВО · РАУНД ${story.refereeIntro?.round || state.round}`; badge = 'РЕФЕРИ ДАЁТ СТАРТ';
      if (favorite) feed.append({ id: `${story.refereeIntro?.sequenceId}:${favorite}`, text: buildRefereeRoundLead(state, favorite), label: 'ОБЪЯВИТЕ РАУНД', readSeconds: 9, kind: 'lead' });
      note = 'Можно добавить своё. Время боя пока не идёт.';
    } else if (state.phase === 'countdown') {
      category = 'ПОЕХАЛИ'; badge = 'ГОНГ'; note = 'Микрофон ваш.';
    } else if (reading.current) {
      category = REFEREE_CATEGORIES[reading.current.category]?.label?.toUpperCase() || 'ВАШ МИКРОФОН';
      feed.append({ ...reading.current, label: category, kind: 'commentary' });
    }
    if (frozen) { badge = 'ПАУЗА'; note = connection !== 'connected' ? 'Связь восстанавливается. Лента подождёт.' : 'Пауза. Продолжим с этого места.'; }
    setText('category', category); setText('badge', badge); setText('note', note);
    $('startRound').disabled = frozen || !favorite || Boolean(pendingStart);
    setText('startRound', pendingStart ? 'ПЕРЕДАЁМ СИГНАЛ…' : `НАЧАТЬ РАУНД ${state.round}`);
  }
  async function prepareSound(onProgress) {
    // Both contexts are resumed synchronously inside the click gesture.
    audio.unlock(); const voiceUnlock = voice.unlock(); voice.setMuted(false);
    if (audio.muted) audio.toggle(); muted = false;
    setText('sound', 'Звук включён'); $('sound').setAttribute('aria-pressed', 'true');
    await Promise.all([voiceUnlock, audio.prepareCombat(onProgress), voice.prepareAll({ onProgress })]);
    if (disposed || document.hidden) throw new Error('Вернитесь на страницу и включите звук ещё раз.');
    prepared = true;
  }
  async function enter(event) {
    event?.preventDefault(); if (preparing) return;
    const code = cleanRoomCode($('roomInput').value);
    if (!validRoomCode(code)) { setText('joinMessage', 'Нужны шесть букв или цифр из приглашения.'); $('roomInput').focus(); return; }
    if (connection !== 'connected' || code !== selectedRoom) {
      selectedRoom = code; desiredFavorite = null;
      root.querySelectorAll('[name="ref-favorite"]').forEach(input => { input.checked = false; });
      const url = new URL(location.href); url.searchParams.set('role', 'referee'); url.searchParams.set('room', code); url.searchParams.delete('token'); url.searchParams.delete('refereeToken'); history.replaceState(null, '', url);
      makeClient().start(); return;
    }
    if (!state?.players?.some(p => p.id === 'p1') || !state.players.some(p => p.id === 'p2')) { setText('joinMessage', 'Ждём обоих бойцов. Вы сможете выбрать их по именам.'); return; }
    const selected = root.querySelector('[name="ref-favorite"]:checked')?.value;
    if (!['p1', 'p2'].includes(selected)) { setText('joinMessage', 'Выберите тайного фаворита. Полную беспристрастность сегодня не завезли.'); return; }
    selectedRoom = code; desiredFavorite = selected; preparing = true; $('enter').disabled = true;
    $('favoriteChoice').disabled = true; $('roomInput').disabled = true;
    const generation = ++entryGeneration;
    const progress = item => { if (!disposed && preparing && generation === entryGeneration) setText('joinMessage', `Готовим эфир · ${item.kind === 'voices' ? 'реплики' : 'звук и эффекты'} ${item.loaded || 0}/${item.total || '…'}`); };
    try {
      const sounds = prepareSound(progress);
      const graphics = prepareArena().then(async result => {
        // ResizeObserver delivers its initial size after createArena resolves.
        // Let it settle before warming, otherwise it cancels the first compile.
        await preparationDeadline(waitForLayout || (() => new Promise(resolve => requestFrame ? requestFrame(() => requestFrame(resolve)) : resolve())), { timeoutMs: 2500 });
        return result?.prepareCombat?.();
      });
      await Promise.all([sounds, graphics]);
      if (disposed || generation !== entryGeneration) return;
      joiningAir = true; readySent = false;
      if (!client?.setFavorite(desiredFavorite)) throw new Error('Связь с комнатой потеряна. Повторите вход.');
      setText('joinMessage', 'Ваш тайный выбор подтверждается…');
    } catch (error) {
      if (!disposed && generation === entryGeneration) { preparing = false; joiningAir = false; setText('joinMessage', error?.message || 'Эфир не подготовился. Повторите вход.'); setText('enter', 'Повторить подготовку и войти'); stopSound(); }
    } finally { if (!disposed && generation === entryGeneration) { preparing = false; $('favoriteChoice').disabled = false; $('roomInput').disabled = false; $('enter').disabled = ['connecting', 'reconnecting'].includes(connection); } }
  }
  $('form').addEventListener('submit', enter);
  $('startRound').addEventListener('click', () => {
    if (suspended() || !favorite || pendingStart || !client?.startRound()) return;
    pendingStart = state.story.refereeIntro.sequenceId; render();
    pendingTimer = setTimeout(() => { clearPending(); render(); }, 1800);
  });
  $('private').addEventListener('click', () => { $('settings').open = false; $('dialog').showModal(); });
  $('closePrivate').addEventListener('click', () => $('dialog').close());
  $('leave').addEventListener('click', () => { entryGeneration++; preparing = false; $('settings').open = false; stopSound(); audio.resetMusic(); client?.stop(); state = null; feed.clear(); $('join').hidden = false; $('live').hidden = true; setText('joinMessage', 'Микрофон свободен. Можно вернуться в эфир.'); });
  $('sound').addEventListener('click', () => { audio.unlock(); void voice.unlock(); muted = audio.toggle(); voice.setMuted(muted); setText('sound', muted ? 'Звук выключен' : 'Звук включён'); $('sound').setAttribute('aria-pressed', String(!muted)); audio.updateMusic(state, { connected: connection === 'connected' }); updateVoice(); });
  $('retryAudio').addEventListener('click', async () => {
    $('retryAudio').disabled = true;
    try { await prepareSound(); notice('Все реплики и звуки готовы.'); updateVoice(); }
    catch (error) { notice(error.message || 'Загрузка не удалась. Попробуйте ещё раз.'); }
    finally { if (!disposed) $('retryAudio').disabled = false; }
  });
  const onVisibility = () => { lastFrame = null; if (document.hidden) { voice.cancel(); audio.stop(); $('dialog').close(); feed.tick(0, { paused: true }); } audio.updateMusic(state, { connected: connection === 'connected' }); updateVoice(); };
  document.addEventListener('visibilitychange', onVisibility);
  function animate(now) {
    if (disposed) return;
    const dt = lastFrame == null ? 0 : Math.max(0, Math.min(.1, (now - lastFrame) / 1000)); lastFrame = now;
    const frozen = !onAir || suspended() || $('dialog').open;
    if (director && !frozen) { reading = director.tick?.(dt) || reading; render(); }
    feed.tick(dt, { paused: frozen, activity: reading.activity || 0 });
    frame = requestFrame?.(animate);
  }
  frame = requestFrame?.(animate); $('settings').hidden = true;
  return Object.freeze({ dispose() {
    if (disposed) return; disposed = true; entryGeneration++; cancelFrame?.(frame); client?.stop(); arena?.dispose(); voice.dispose(); feed.dispose(); audio.stop(); audio.disposeMusic(); audio.ctx?.close();
    clearPending(); clearTimeout(noticeTimer); document.removeEventListener('visibilitychange', onVisibility);
    root.remove(); document.body.classList.remove('referee-page');
  } });
}
