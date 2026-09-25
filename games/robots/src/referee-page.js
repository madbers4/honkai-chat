import './referee-page.css';
import { createArena } from './arena.js';
import { GameAudio } from './audio.js';
import { createRefereeClient, cleanRoomCode, validRoomCode } from './referee-client.js';
import { createRefereeDirector } from '../shared/referee-director.js';
import { REFEREE_CATEGORIES } from '../shared/referee-lines.js';
import { CLUB_STORY, RULE_CARDS, formatClubText, getClubRuleCard } from '../shared/club-story.js';
import { MAX_HP, WINS_TO_MATCH } from '../shared/constants.js';
import { buildRoundIntro, activeRoundIntroBeat } from '../shared/round-intro.js';

const markup = `
  <header class="ref-header">
    <a class="ref-brand" href="./"><span class="ref-seal" aria-hidden="true">Н</span><span><small>ФОНТЕЙНКА · БОЙЦОВСКИЙ КЛУБ</small><strong>Совершенно неподкупный</strong></span></a>
    <div class="ref-header-tools"><span class="ref-connection" role="status"><i></i><span data-ref="connection">Микрофон свободен</span></span><span class="ref-room" data-ref="room"></span><button class="ref-icon-button" data-ref="sound" type="button" aria-pressed="false">Звук выкл.</button><button class="ref-icon-button" data-ref="private" type="button" aria-haspopup="dialog">За кулисы</button></div>
  </header>
  <section class="ref-join" data-ref="join">
    <div class="ref-join-copy"><span class="ref-kicker">СВОБОДНЫЙ МИКРОФОН</span><h1>У боя есть голос.<br>Сегодня — ваш.</h1><p>Представьте машины, объявите правила и комментируйте происходящее. Счёт ведёт арена. Всю торжественность доверяем вам.</p><span class="ref-join-footnote">Отдельный пульт ведущего · без управления бойцами</span></div>
    <form class="ref-join-form" data-ref="form"><label for="ref-room-input">Код комнаты</label><input id="ref-room-input" data-ref="roomInput" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" inputmode="text" aria-describedby="ref-join-message"><p id="ref-join-message" data-ref="joinMessage" role="status">Код есть в приглашении от бойцов.</p><button class="ref-primary" data-ref="enter" type="submit">Войти за микрофон <span aria-hidden="true">→</span></button></form>
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
      <div class="ref-arena-bottom"><span class="ref-live-label"><i></i> ЖИВАЯ АРЕНА</span><span data-ref="arenaStatus">Смотрим бой вместе</span></div>
    </section>
    <section class="ref-reading" aria-label="Суфлёр рефери">
      <div class="ref-paper">
        <div class="ref-paper-heading"><span class="ref-kicker" data-ref="category">ВАША РЕПЛИКА</span><span class="ref-read-badge" data-ref="badge">ЧИТАТЬ ВСЛУХ</span></div>
        <div class="ref-script-scroll" data-ref="scriptScroll"><h1 data-ref="title">Арена на связи</h1><p class="ref-script" data-ref="script">Сейчас появится первая реплика.</p><div class="ref-profiles" data-ref="profiles" hidden></div><p class="ref-question" data-ref="question" hidden></p><div class="ref-stage-progress" data-ref="progress" hidden><i></i></div></div>
        <div class="ref-read-actions"><button class="ref-primary" data-ref="ack" type="button">Произнесено <span aria-hidden="true">✓</span></button><button class="ref-secondary" data-ref="variation" type="button">Другой вариант</button></div>
        <p class="ref-reading-note" data-ref="note">Можно читать дословно или от себя.</p>
      </div>
      <div class="ref-next"><span data-ref="nextLabel">ДАЛЕЕ ПО ХОДУ БОЯ</span><p data-ref="next">Следим за ареной. Каждому удару не нужен отдельный комментарий.</p></div>
      <div class="ref-stamp" data-ref="stamp" hidden><span aria-hidden="true">✓</span><p>История состоялась.<strong>За печатью к ведущему идут оба участника.</strong></p></div>
    </section>
  </main>
  <div class="ref-notice" data-ref="notice" role="status" hidden></div>
  <dialog class="ref-private-dialog" data-ref="dialog" aria-labelledby="ref-private-title"><div class="ref-dialog-top"><span class="ref-kicker">ЗА КУЛИСАМИ</span><button class="ref-icon-button" data-ref="closePrivate" type="button" aria-label="Закрыть приватные настройки">✕</button></div><h2 id="ref-private-title">Почти без пристрастия.</h2><p>Тайное поручение ведущего. Выбор меняет только оттенок ваших реплик. Бойцы его не видят; счёт и урон остаются прежними.</p><fieldset class="ref-favorite"><legend>За кого держим кулачки</legend><label><input type="radio" name="ref-favorite" value="neutral" checked><span>Полный нейтралитет</span></label><label><input type="radio" name="ref-favorite" value="p1"><span data-ref="favorite1">Первый боец</span></label><label><input type="radio" name="ref-favorite" value="p2"><span data-ref="favorite2">Второй боец</span></label></fieldset><p class="ref-private-state" data-ref="favoriteStatus">Поручение остаётся на этом пульте.</p><hr><p class="ref-small">Закончили смену? Передайте чтение ведущему. После объявления и нескольких комментариев вашу печать поможет получить он.</p><button class="ref-secondary ref-wide" data-ref="leave" type="button">Закрыть пульт на этом устройстве</button></dialog>
`;

/** Explicit entry point for ?role=referee; no automatic side effects on import. */
export function mountRefereePage({ container = document.body, room = new URL(location.href).searchParams.get('room') || '',
  createArenaImpl = createArena, createClientImpl = createRefereeClient } = {}) {
  const root = document.createElement('div'); root.className = 'referee-shell'; root.innerHTML = markup;
  container.replaceChildren(root); document.body.classList.add('referee-page'); document.title = 'Неподкупный рефери · Фонтейнка';
  const $ = key => root.querySelector(`[data-ref="${key}"]`);
  const audio = new GameAudio(); audio.muted = true;
  let client, arena, arenaPromise, state = null, director, reading = { current: null, next: null }, selectedRoom = cleanRoomCode(room);
  let connection = 'idle', favorite = 'neutral', pendingAdvance = null, pendingTimer, noticeTimer, questionIndex = 0, disposed = false;
  let renderedScript = '', profileKey = '', finalStep = 0;
  $('roomInput').value = selectedRoom;
  for (const key of ['wins1', 'wins2']) for (let i = 0; i < WINS_TO_MATCH; i++) { const dot = document.createElement('i'); $(key).appendChild(dot); }
  function notice(message) {
    $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (!disposed) $('notice').hidden = true; }, 5000);
  }
  function clearPending() { pendingAdvance = null; clearTimeout(pendingTimer); }
  function updateConnection(info) {
    if (disposed) return;
    connection = info.status; root.dataset.connection = connection;
    if (connection !== 'connected') audio.updateMusic(state, { connected: false });
    $('connection').textContent = info.message || 'Микрофон свободен';
    const stopped = ['error', 'closed', 'takenOver', 'idle'].includes(connection);
    if (stopped) { audio.stop(); clearPending(); }
    if (connection !== 'connected' && state) {
      audio.stop(); arena?.update({ ...state, phase: 'paused', pausedFrom: state.phase, events: [] }, null);
    }
    if (['connecting', 'reconnecting'].includes(connection)) $('joinMessage').textContent = info.message;
    if (stopped && info.message) {
      $('join').hidden = false; $('live').hidden = true; $('joinMessage').textContent = info.message;
      $('enter').textContent = connection === 'takenOver' ? 'Вернуть пульт сюда' : 'Подключиться';
    }
    $('enter').disabled = ['connecting', 'reconnecting'].includes(connection);
    $('private').disabled = connection !== 'connected';
    $('room').textContent = selectedRoom ? `№ ${selectedRoom}` : '';
    render();
  }
  async function prepareArena() {
    if (arenaPromise || disposed) return arenaPromise;
    arenaPromise = createArenaImpl(root.querySelector('#arena'), { onLoadProgress: progress => { if (!disposed) $('loading').textContent = `Готовим арену · ${Math.round(progress * 100)}%`; } })
      .then(result => {
        if (disposed) { result.dispose(); return; }
        arena = result;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) arena.setReducedMotion?.(true);
        if (state) arena.update({ ...state, events: [] }, null);
        $('loading').hidden = true;
      }).catch(() => { if (!disposed) { $('loading').textContent = 'Арена не загрузилась. Счёт и реплики работают; обновите страницу, чтобы вернуть изображение.'; $('loading').classList.add('ref-load-error'); } });
    return arenaPromise;
  }
  function receive(snapshot, meta) {
    if (disposed) return;
    // Story suppresses combat events, including round. Clear the last fight's
    // audio before presenting the new reading cue, even after a fast rematch.
    if (snapshot.phase === 'story' && state?.phase !== 'story') audio.stop();
    if (snapshot.phase !== state?.phase && snapshot.phase === 'matchOver') finalStep = 0;
    state = snapshot;
    audio.updateMusic(snapshot, { connected: connection === 'connected' });
    const key = `${snapshot.story?.sequenceId}:${snapshot.story?.ruleIndex}`;
    if (pendingAdvance && (key !== pendingAdvance || snapshot.story?.paused || snapshot.story?.stage !== 'rules')) clearPending();
    $('join').hidden = true; $('live').hidden = false;
    const liveState = { ...snapshot, events: meta.freshEvents };
    reading = director.update(liveState);
    arena?.update(liveState, null);
    if (!meta.baseline && !document.hidden && snapshot.phase !== 'paused' && !snapshot.story?.paused && snapshot.phase !== 'story') {
      for (const event of meta.freshEvents) {
        const target = snapshot.players.find(p => p.id === event.target);
        audio.play(event.type, { ...event, targetHp: target?.hp, targetMaxHp: target?.maxHp });
      }
    }
    prepareArena(); render();
  }
  function makeClient() {
    audio.resetMusic();
    client?.stop(); state = null; profileKey = ''; clearPending(); questionIndex = 0; finalStep = 0;
    director = createRefereeDirector({ seed: selectedRoom }); reading = { current: null, next: null };
    favorite = 'neutral'; root.querySelector('[name="ref-favorite"][value="neutral"]').checked = true;
    client = createClientImpl({ room: selectedRoom, onStatus: updateConnection, onSnapshot: receive,
      onFavorite: value => {
        favorite = value; director.setFavorite(value);
        root.querySelector(`[name="ref-favorite"][value="${value}"]`).checked = true;
        $('favoriteStatus').textContent = value === 'neutral' ? 'Полный нейтралитет подтверждён.' : 'Тайное поручение принято. На табло оно не попадёт.';
      }, onNotice: notice });
    return client;
  }
  function setText(key, value) { const element = $(key); if (element.textContent !== value) element.textContent = value; }
  function scoreboard() {
    for (let i = 0; i < 2; i++) {
      const p = state?.players[i], n = i + 1, maxHp = p?.maxHp || MAX_HP, hp = Math.max(0, p?.hp ?? maxHp);
      setText(`name${n}`, p?.name || 'Ждём бойца'); setText(`hp${n}`, p ? `${Math.ceil(hp)} / ${maxHp}` : '—');
      $(`bar${n}`).style.transform = `scaleX(${Math.min(1, hp / maxHp)})`;
      $(`wins${n}`).setAttribute('aria-label', `Побед: ${p?.wins || 0} из ${WINS_TO_MATCH}`);
      [...$(`wins${n}`).children].forEach((dot, j) => dot.classList.toggle('won', j < (p?.wins || 0)));
      setText(`favorite${n}`, p?.name || (i ? 'Второй боец' : 'Первый боец'));
    }
    setText('round', state ? `РАУНД ${state.round}` : 'АРЕНА');
    setText('clock', state?.phase === 'countdown' ? String(Math.ceil(state.countdown)) : state ? String(Math.ceil(Math.max(0, state.time))) : '—');
    const status = state?.story?.paused || state?.phase === 'paused' ? 'Пауза · ждём подключение бойца' : connection === 'reconnecting' ? 'Восстанавливаем сигнал' : state?.phase === 'matchOver' ? 'Матч завершён' : 'До пяти побед · прочность на табло';
    setText('arenaStatus', status);
  }
  function updateProfiles() {
    const key = JSON.stringify((state?.players || []).map(p => [p.name, p.character, state.story?.ready?.[p.id]]));
    if (key === profileKey) return; profileKey = key; $('profiles').replaceChildren();
    for (const p of state?.players || []) {
      const card = document.createElement('div'), name = document.createElement('strong'), character = document.createElement('span');
      name.textContent = p.name; character.textContent = p.character || 'Характер ещё можно придумать вслух.';
      card.append(name, character); $('profiles').append(card);
    }
  }
  function render() {
    if (disposed || !state) return;
    scoreboard();
    const stage = state.story?.stage, suspended = connection !== 'connected' || state.story?.paused || state.phase === 'paused';
    root.dataset.stage = stage || state.phase;
    let category = reading.current ? REFEREE_CATEGORIES[reading.current.category]?.label?.toUpperCase() : 'СМОТРИМ БОЙ';
    let title = 'Ваше слово', script = reading.current?.text || 'Следите за ареной. Здесь появится реплика, когда случится что-нибудь достойное микрофона.';
    let next = reading.next?.text || 'Дайте моменту прозвучать. Следующую реплику подскажет сам бой.', nextLabel = 'НА ОЧЕРЕДИ';
    let ack = 'Произнесено', variation = 'Другой вариант', note = 'Можно читать дословно или от себя.', badge = 'ЧИТАТЬ ВСЛУХ';
    let canAck = Boolean(reading.current), canVary = Boolean(reading.current);
    $('profiles').hidden = true; $('question').hidden = true; $('progress').hidden = true; $('stamp').hidden = state.phase !== 'matchOver';
    if (stage === 'workshop' || state.phase === 'waiting') {
      category = 'ПРЕСС-КОНФЕРЕНЦИЯ'; title = 'Познакомьте нас с машинами.';
      script = state.players.length >= 2 ? formatClubText(CLUB_STORY.announcement, { a: state.players[0], b: state.players[1] }) : 'Первый участник уже здесь. Ждём второго бойца — и представим обе машины публике.';
      $('profiles').hidden = false; updateProfiles(); $('question').hidden = false; setText('question', CLUB_STORY.pressQuestions[questionIndex % CLUB_STORY.pressQuestions.length]);
      ack = 'Бойцы готовятся'; variation = 'Другой вопрос'; canAck = false; canVary = true;
      next = 'Игроки назовут машины, выберут характер и отметят готовность на своих телефонах.'; note = 'Задайте каждой стороне один короткий вопрос. Готовность отмечают бойцы.';
    } else if (stage === 'rules') {
      const index = state.story.ruleIndex, card = getClubRuleCard(index, state.players);
      category = `${card?.kind === 'charter' ? 'УСТАВ КЛУБА' : 'КОРОТКО О БОЕ'} · ${index + 1} / ${RULE_CARDS.length}`; title = card?.title || 'Правила прочитаны'; script = card?.readAloud || 'Ждём выхода бойцов.';
      ack = pendingAdvance ? 'Передаём слово…' : 'Зачитано — дальше'; canAck = Boolean(card) && !pendingAdvance; canVary = false;
      nextLabel = 'СЛЕДУЮЩАЯ КАРТОЧКА'; next = RULE_CARDS[index + 1]?.title || 'Выход бойцов. Дайте записи прозвучать.';
      note = 'Бойцы ждут вас. Нажмите после того, как прочитаете карточку.';
    } else if (stage === 'faceoff') {
      category = 'ВЫХОД НА АРЕНУ'; title = 'Идёт выход бойцов';
      script = 'Микрофон на паузе. Дайте репликам бойцов прозвучать — ваш комментарий вернётся с началом раунда.';
      badge = 'СЛУШАЕМ'; canAck = canVary = false; ack = 'Ждём начала'; nextLabel = 'ПОСЛЕ ВЫХОДА'; next = 'Сначала сигнал к бою. Затем говорите о том, что действительно произошло.'; note = 'Не нужно говорить поверх записи.';
      const timing = state.story.roundIntro || state.story; $('progress').hidden = false;
      $('progress').firstElementChild.style.transform = `scaleX(${Math.min(1, (timing.elapsed || 0) / (timing.duration || 1))})`;
    } else if (stage === 'roundIntro') {
      const timing = state.story.roundIntro || { elapsed: 0 }, intro = buildRoundIntro(state.players, state.room, timing.round || state.round, timing.matchSerial || 0);
      const beat = activeRoundIntroBeat(intro, timing.elapsed), index = beat ? intro.beats.indexOf(beat) : intro.beats.length;
      const speaker = state.players.find(player => player.id === beat?.speaker), following = intro.beats[index + 1];
      category = `ПЕРЕД РАУНДОМ ${timing.round || state.round} · ${Math.min(2, index + 1)} / 2`;
      title = speaker?.name || 'Готовимся к бою'; script = beat?.text || 'Перепалка завершена. Сейчас начнётся отсчёт.';
      badge = 'ЧИТАТЬ ЗА БОЙЦА'; ack = 'Идёт перепалка'; canAck = canVary = false;
      nextLabel = following ? 'ОТВЕТ СОПЕРНИКА' : 'ПОСЛЕ ПЕРЕПАЛКИ';
      next = following ? `${state.players.find(player => player.id === following.speaker)?.name || 'Автоматон'}: ${following.text}` : 'Сигнал к бою. После него возвращаемся к комментариям.';
      note = 'Произнесите реплику от лица этой машины. Следующая появится сама.';
      $('progress').hidden = false; $('progress').firstElementChild.style.transform = `scaleX(${Math.min(1, (timing.elapsed || 0) / intro.duration)})`;
    } else if (state.phase === 'countdown') {
      title = 'Роботы, в бой!'; script = CLUB_STORY.start; category = 'ОБЪЯВЛЯЕМ НАЧАЛО'; canAck = canVary = false; ack = 'Идёт отсчёт'; next = 'Сигнал прозвучит на арене. После него — живой комментарий.';
    } else if (state.phase === 'matchOver') {
      const winner = state.players.find(p => p.id === state.winner), loser = state.players.find(p => p.id !== state.winner);
      category = reading.current ? category : 'ФИНАЛЬНОЕ СЛОВО';
      if (reading.current?.category === 'loss') finalStep = Math.max(1, finalStep);
      title = reading.current?.category === 'loss' || !reading.current && finalStep === 1 ? 'Последнее слово' : finalStep >= 2 ? 'Спасибо за историю' : 'Матч состоялся';
      script = reading.current?.text || formatClubText(finalStep === 0 ? CLUB_STORY.final.winner : finalStep === 1 ? CLUB_STORY.final.loser : CLUB_STORY.final.both, { winner, loser });
      next = reading.next?.text || (finalStep === 0 ? formatClubText(CLUB_STORY.final.loser, { winner, loser }) : CLUB_STORY.final.both);
      canAck = Boolean(reading.current) || finalStep < 2;
      if (finalStep >= 2 && !reading.current) { ack = 'История завершена'; badge = 'ПЕЧАТЬ ДЛЯ ОБОИХ'; }
      note = 'Результат не влияет на печать. Пригласите обоих к ведущему.';
    }
    if (suspended) {
      canAck = canVary = false;
      note = connection === 'reconnecting' ? 'Связь с пультом восстанавливается. Пока ничего отправлять не нужно.' : 'Пауза: ждём связь с бойцом. Карточка и счёт сохраняются.';
      badge = 'ПАУЗА';
    }
    setText('category', category || 'ВАША РЕПЛИКА'); setText('title', title); setText('script', script); setText('next', next); setText('nextLabel', nextLabel);
    setText('badge', badge); setText('note', note); setText('ack', ack); setText('variation', variation);
    $('ack').disabled = !canAck; $('variation').disabled = !canVary; $('variation').hidden = stage === 'rules' || stage === 'faceoff' || stage === 'roundIntro';
    if (renderedScript !== script) { $('scriptScroll').scrollTop = 0; renderedScript = script; }
  }
  function enter(event) {
    event?.preventDefault(); const code = cleanRoomCode($('roomInput').value);
    if (!validRoomCode(code)) { $('joinMessage').textContent = 'Нужны шесть букв или цифр из приглашения.'; $('roomInput').focus(); return; }
    selectedRoom = code;
    const url = new URL(location.href); url.searchParams.set('role', 'referee'); url.searchParams.set('room', code); url.searchParams.delete('token'); url.searchParams.delete('refereeToken'); history.replaceState(null, '', url);
    makeClient().start();
  }
  $('form').addEventListener('submit', enter);
  $('ack').addEventListener('click', () => {
    if (state?.story?.stage === 'rules') {
      if (client.advanceRules()) {
        pendingAdvance = `${state.story.sequenceId}:${state.story.ruleIndex}`; render();
        pendingTimer = setTimeout(() => { clearPending(); render(); }, 1600);
      }
    } else {
      if (state?.phase === 'matchOver') finalStep = reading.current?.category === 'loss' ? 2 : reading.current?.category === 'win' ? 1 : Math.min(2, finalStep + 1);
      reading = director.acknowledge(); render();
    }
  });
  $('variation').addEventListener('click', () => {
    if (state?.story?.stage === 'workshop' || state?.phase === 'waiting') questionIndex++;
    else reading = director.nextVariation(); render();
  });
  $('private').addEventListener('click', () => $('dialog').showModal());
  $('closePrivate').addEventListener('click', () => $('dialog').close());
  $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) { const box = $('dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('dialog').close(); } });
  root.querySelectorAll('[name="ref-favorite"]').forEach(input => input.addEventListener('change', () => {
    if (!client?.setFavorite(input.value)) root.querySelector(`[name="ref-favorite"][value="${favorite}"]`).checked = true;
    else $('favoriteStatus').textContent = 'Передаём тайное поручение…';
  }));
  $('leave').addEventListener('click', () => { $('dialog').close(); audio.resetMusic(); client?.stop(); $('join').hidden = false; $('live').hidden = true; $('joinMessage').textContent = 'Пульт закрыт. Бойцы могут продолжать без вашего микрофона.'; });
  $('sound').addEventListener('click', () => { audio.unlock(); const muted = audio.toggle(); $('sound').textContent = muted ? 'Звук выкл.' : 'Звук вкл.'; $('sound').setAttribute('aria-pressed', String(!muted)); });
  root.addEventListener('pointerdown', () => audio.music?.unlock());
  const onVisibility = () => { if (document.hidden) { audio.stop(); $('dialog').close(); } audio.updateMusic(state, { connected: connection === 'connected' }); };
  document.addEventListener('visibilitychange', onVisibility);
  $('private').disabled = true;
  if (validRoomCode(selectedRoom)) makeClient().restore();
  return Object.freeze({ dispose() {
    if (disposed) return; disposed = true; client?.stop(); arena?.dispose(); audio.stop(); audio.disposeMusic(); audio.ctx?.close();
    clearPending(); clearTimeout(noticeTimer); document.removeEventListener('visibilitychange', onVisibility);
    root.remove(); document.body.classList.remove('referee-page');
  } });
}
