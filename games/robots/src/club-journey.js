import QRCode from 'qrcode';
import { CLUB_STORY, RULE_CARDS, getClubRuleCard } from '../shared/club-story.js';
import { buildFaceoff } from '../shared/faceoff-script.js';
import { buildRoundIntro } from '../shared/round-intro.js';
import { storyVoicePreload } from '../shared/story-voice-preload.js';
import { cleanRobotName, cleanCharacter } from '../shared/fighter-profile.js';
import { normalizeCustomization } from '../shared/robot-customization.js';
import { createCustomizationUI } from './customization-ui.js';
import { createFaceoffUI } from './faceoff-ui.js';
import { createStoryVoice } from './story-voice.js';
import { createRoundIntroUI } from './round-intro-ui.js';
import { createPlayerPreflight } from './player-preflight.js';
import './customization-ui.css';
import './faceoff.css';
import './round-intro.css';
import './club-journey.css';

const text = (node, value) => { if (node.textContent !== String(value)) node.textContent = value; };
const savedLook = () => { try { return normalizeCustomization(JSON.parse(localStorage.getItem('belobog-look') || 'null')); } catch { return normalizeCustomization(); } };

/** Player-only presentation. Every stage transition is acknowledged by the
 * server; closing a menu or losing focus never makes the other player advance. */
export function createClubJourney(container, { send, leave, toggleSound, toast, ensureReady, checkSound, onGesture = () => {}, muted = false, onName = () => {} }) {
  const root = document.createElement('section'); root.id = 'club-journey'; root.hidden = true;
  root.className = 'club-journey'; root.setAttribute('aria-label', 'Кабачковое противостояние');
  root.innerHTML = `
    <header class="journey-header"><div><span class="journey-brand">ФОНТЕЙНКА ПРЕДСТАВЛЯЕТ</span><strong>КАБАЧКОВОЕ ПРОТИВОСТОЯНИЕ <i>№ <span data-room></span></i></strong></div>
      <nav aria-label="Подготовка бойца"><button data-tab="passport" aria-pressed="true">01 <span>ПАСПОРТ</span></button><button data-tab="appearance" aria-pressed="false" disabled>02 <span>ВНЕШНОСТЬ</span></button><button data-tab="sound" aria-pressed="false" disabled>03 <span>ЗВУК</span></button></nav>
      <div class="journey-tools"><button data-voice-retry hidden aria-label="Повторить загрузку озвучки">↻ ОЗВУЧКА</button><button data-sound aria-label="Переключить звук">ЗВУК</button><button data-leave aria-label="Выйти из комнаты">×</button></div></header>
    <div class="journey-workshop">
      <div class="journey-passport">
        <article class="journey-introduction"><span class="journey-kicker">БЕЛОБОГ · ПОДЗЕМНАЯ ГАЛЕРЕЯ</span><h2>Гарантии нет.<br><em>Характер есть.</em></h2><p data-prologue></p><p class="journey-intro-small">Сегодня клуб запомнит две машины.<br>Начнём с твоей.</p></article>
        <div class="journey-profile"><span class="journey-kicker">ПАСПОРТ БОЙЦА</span><label>КАК ТЕБЯ ОБЪЯВЯТ?<input data-name maxlength="20" placeholder="Например, Барон Кабачок" aria-label="Имя твоего робота" autocomplete="nickname" required></label><label>ХАРАКТЕР <small>по желанию</small><input data-character maxlength="60" placeholder="Скромный. Пока не включён." aria-label="Характер твоего робота" autocomplete="off"></label>
          <p data-profile-error role="alert"></p><small data-voice-status></small></div>
        <aside class="journey-invite"><div class="journey-invite-tabs"><button data-invite-role="fighter" aria-pressed="true">СОПЕРНИК</button><button data-invite-role="referee" aria-pressed="false">РЕФЕРИ · ПО ЖЕЛАНИЮ</button></div><div class="journey-qr"><canvas aria-label="QR-код приглашения"></canvas><div><span data-invite-caption></span><strong data-invite-code></strong><button data-copy>КОПИРОВАТЬ ↗</button></div></div><input data-invite-link readonly aria-label="Приглашение в комнату"><p data-invite-detail></p><div class="journey-roster" aria-live="polite"></div></aside>
      </div>
      <div class="journey-appearance" hidden></div>
      <div class="journey-sound" hidden>
        <article class="journey-sound-card"><span class="journey-kicker">ПОСЛЕДНИЙ ШАГ ПЕРЕД ВЫХОДОМ</span><div class="journey-speaker" aria-hidden="true">♪</div><h2>ЗВУК ТЕЛЕФОНА<br><em>НА ПОЛНУЮ!</em></h2><p>Кнопками на телефоне подними <b>громкость мультимедиа до максимума</b>. Отключи беззвучный режим и проверь, куда идёт звук.</p><button class="button secondary" data-sound-check>▶ ПРОСЛУШАТЬ ПРОВЕРКУ</button><p class="journey-sound-result" data-sound-result role="status" aria-live="polite">Сначала нажми «Прослушать проверку».</p><small>Громкость телефона меняешь ты — браузер не может сделать это за тебя.</small></article>
        <aside class="journey-load-card"><span class="journey-kicker">ГОТОВИМ БОЙ ЦЕЛИКОМ</span><h3>Записи и эффекты —<br>до первого гонга.</h3><p>Перед стартом проверим записи, роботов и эффекты. Если соединение подведёт, подготовку можно повторить.</p><p data-prepare-progress role="status" aria-live="polite"></p><div class="journey-load-pulse" aria-hidden="true"></div></aside>
      </div>
    </div>
    <article class="journey-rules" hidden><div class="journey-rule-stamp" aria-hidden="true"><span data-rule-section>УСТАВ</span><b data-rule-number></b><small>НОВОГО<br>БОЙЦОВСКОГО КЛУБА</small></div><div class="journey-rule-copy"><span class="journey-kicker" data-rule-kicker></span><h2 data-rule-title></h2><p data-rule-text></p><div class="journey-rule-dots" aria-hidden="true"></div></div></article>
    <div class="journey-faceoff" hidden></div>
    <div class="journey-round-intro" hidden></div>
    <article class="journey-referee-intro" hidden aria-live="polite"><span class="journey-kicker" data-referee-round></span><h2>Слово рефери.</h2><p>Сейчас он объявит раунд и даст сигнал к бою.</p><small data-referee-connection>Таймер ждёт его сигнала.</small></article>
    <footer class="journey-footer"><div><span data-stage-caption></span><strong data-stage-status aria-live="polite"></strong></div><button class="button primary" data-next></button></footer>
    <div class="journey-paused" hidden role="status"><strong>ДЕРЖИМ ПАУЗУ</strong><span>Ждём возвращения бойца. История продолжится с этого места.</span></div>`;
  container.append(root);
  const q = selector => root.querySelector(selector);
  let latest, playerId, workshop, profileRoom, tab = 'passport', inviteRole = 'fighter', invite = '', lastQr = '', profileTimer;
  let look = savedLook(), voiceStatus, faceoffKey, beats = [], lastStage, isMuted = muted, transportConnected = true;
  const faceoff = createFaceoffUI(q('.journey-faceoff'));
  const roundUI = createRoundIntroUI(q('.journey-round-intro'));
  let roundKey, roundIntro, preloadKey, soundError = '';
  const voice = createStoryVoice({ onStatus(value) { voiceStatus = value; text(q('[data-voice-status]'), value.message); q('[data-voice-retry]').hidden=!value.retryAvailable; } });
  voice.setMuted(muted);
  text(q('[data-sound]'), muted ? 'БЕЗ ЗВУКА' : 'ЗВУК ВКЛ.');
  // Retire the old opt-in rather than restoring a phone's default voice.
  try { localStorage.removeItem('belobog-local-tts'); } catch {}
  text(q('[data-prologue]'), CLUB_STORY.prologue[0]);

  const preflight = createPlayerPreflight({
    prepare(onProgress) {
      const progress = new Map(), labels = { voices: 'Реплики', combat: 'Звуки боя', graphics: 'Эффекты' };
      const report = value => {
        if (!value?.kind) { onProgress(value?.message || value); return; }
        progress.set(value.kind, `${labels[value.kind] || 'Ресурсы'}: ${value.loaded} / ${value.total}`);
        onProgress([...progress.values()].join(' · '));
      };
      return Promise.all([ensureReady(report), voice.prepareAll({ onProgress: report })]);
    },
    commit() {
      if (!transportConnected || latest?.story?.stage !== 'workshop' || latest.story.ready[playerId] || isMuted) return false;
      flushProfile(); send({ type: 'ready', ready: true }); return true;
    },
    changed: () => { if (latest?.story?.stage === 'workshop') renderPreflight(); },
  });
  function renderPreflight() {
    const state = preflight.snapshot(), locked = Boolean(latest?.story?.ready[playerId]);
    selectTab(state.step);
    for (const button of root.querySelectorAll('[data-tab]')) {
      button.disabled = locked || state.busy || state.committed || button.dataset.tab === 'appearance' && !state.passport || button.dataset.tab === 'sound' && !state.appearance;
    }
    q('[data-name]').disabled = q('[data-character]').disabled = locked || state.busy || state.committed;
    workshop?.setEnabled?.(!locked && !state.busy && !state.committed);
    root.dataset.preflight = state.step;
    q('.journey-load-card').dataset.loading = String(state.busy);
    q('[data-sound-check]').disabled = locked || state.busy || state.committed;
    text(q('[data-profile-error]'), state.step === 'passport' ? state.error : '');
    q('[data-name]').setAttribute('aria-invalid', String(state.step === 'passport' && Boolean(state.error)));
    text(q('[data-prepare-progress]'), state.error || state.progress);
    text(q('[data-sound-result]'), soundError || (state.heard ? 'Сигнал прозвучал. Если слышишь его — подтверди громкость ниже.' : 'Сначала нажми «Прослушать проверку».'));
    const next = q('[data-next]');
    next.disabled = !transportConnected || Boolean(latest?.story?.paused) || state.busy || state.committed && !locked || state.step === 'sound' && !state.heard && !locked;
    text(next, locked ? 'ИЗМЕНИТЬ БОЙЦА ↶' : state.busy ? 'ГОТОВИМ БОЙ…' : state.error && state.step === 'sound' ? 'ПОВТОРИТЬ ПОДГОТОВКУ ↻' : ({ passport: 'СОХРАНИТЬ ИМЯ →', appearance: 'СОХРАНИТЬ ВНЕШНОСТЬ →', sound: 'СЛЫШУ • ГРОМКОСТЬ НА ПОЛНУЮ →' })[state.step]);
    text(q('[data-stage-caption]'), locked ? 'БОЕЦ ГОТОВ' : `ОБЯЗАТЕЛЬНАЯ ПОДГОТОВКА · ${({ passport: 1, appearance: 2, sound: 3 })[state.step]} / 3`);
    text(q('[data-stage-status]'), locked ? 'Ждём готовности соперника.' : state.error || ({ passport: 'Имя обязательно. Характер — по желанию.', appearance: 'Выбери корпус, ядро и трофей. Сохрани свой вариант.', sound: 'Прослушай сигнал и подтверди громкость.' })[state.step]);
  }

  function profile() { return { name: cleanRobotName(q('[data-name]').value), character: cleanCharacter(q('[data-character]').value), customization: workshop?.value() || look }; }
  function flushProfile() {
    clearTimeout(profileTimer);
    if (!latest?.story || latest.story.stage !== 'workshop' || latest.story.ready[playerId]) return;
    const value = profile(); send({ type: 'profile', ...value });
    localStorage.setItem('belobog-name', value.name); localStorage.setItem('belobog-character', value.character); localStorage.setItem('belobog-look', JSON.stringify(value.customization)); onName(value.name, value.character);
  }
  function selectTab(value) {
    if (tab !== value) q('.journey-workshop').scrollTop = 0;
    tab = value;
    q('.journey-passport').hidden = tab !== 'passport'; q('.journey-appearance').hidden = tab !== 'appearance';
    q('.journey-sound').hidden = tab !== 'sound';
    for (const button of root.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    if (tab === 'appearance' && !workshop) {
      workshop = createCustomizationUI(q('.journey-appearance'), { value: look, onChange(value) { look = value; flushProfile(); } });
      workshop.setEnabled?.(!latest?.story?.ready[playerId]);
    }
    workshop?.setVisible?.(tab === 'appearance' && !root.hidden && latest?.story?.stage === 'workshop');
  }
  function refreshInvite() {
    const url = inviteRole === 'referee' && invite ? `${invite}&role=referee` : invite;
    q('[data-invite-link]').value = url;
    text(q('[data-invite-code]'), latest?.room || '—');
    text(q('[data-invite-caption]'), inviteRole === 'referee' ? 'МИКРОФОН ОТДЕЛЬНЫМ УСТРОЙСТВОМ' : 'КОД КОМНАТЫ');
    text(q('[data-invite-detail]'), inviteRole === 'referee' ? 'Своя прямая трансляция, реплики по ходу боя и совершенно тайный фаворит.' : latest?.mode === 'training' ? 'Учебный автоматон уже здесь. Можно пригласить рефери на репетицию.' : 'Ссылка для второго телефона. Открой её и назови своего бойца.');
    q('[data-copy]').disabled = !url;
    if (url && lastQr !== url) { lastQr = url; QRCode.toCanvas(q('canvas'), url, { width: 104, margin: 1, color: { dark: '#172025', light: '#eee4d2' } }).catch(() => {}); }
    for (const button of root.querySelectorAll('[data-invite-role]')) button.setAttribute('aria-pressed', String(button.dataset.inviteRole === inviteRole));
  }
  for (const button of root.querySelectorAll('[data-tab]')) button.addEventListener('click', () => { preflight.edit(button.dataset.tab); });
  for (const input of [q('[data-name]'), q('[data-character]')]) input.addEventListener('input', () => { clearTimeout(profileTimer); profileTimer = setTimeout(flushProfile, 220); });
  q('[data-next]').addEventListener('click', () => {
    voice.unlock();
    onGesture();
    const story = latest?.story; if (!story) return;
    if (story.stage === 'workshop') {
      if (story.ready[playerId]) { preflight.reset(); send({ type: 'ready', ready: false }); return; }
      const current = preflight.snapshot();
      if (current.step === 'passport') {
        if (preflight.savePassport(q('[data-name]').value)) { flushProfile(); q('[data-name]').blur(); }
        else q('[data-name]').focus();
      } else if (current.step === 'appearance') { flushProfile(); preflight.saveAppearance(); }
      else void preflight.confirm();
    }
    else send({ type: 'storyAdvance', sequenceId: story.sequenceId, ruleIndex: story.ruleIndex });
  });
  q('[data-sound-check]').addEventListener('click', async () => {
    const checkedRoom = profileRoom;
    soundError = '';
    try {
      voice.unlock(); onGesture(); await checkSound();
      if (profileRoom === checkedRoom && transportConnected && latest?.story?.stage === 'workshop') preflight.soundChecked();
    } catch { soundError = 'Сигнал не запустился. Нажми ещё раз и проверь звук браузера.'; renderPreflight(); }
  });
  q('[data-leave]').addEventListener('click', leave);
  q('[data-sound]').addEventListener('click', () => { voice.unlock(); toggleSound(); });
  q('[data-voice-retry]').addEventListener('click', () => { void voice.unlock(); void voice.retry(); });
  for (const button of root.querySelectorAll('[data-invite-role]')) button.addEventListener('click', () => { inviteRole = button.dataset.inviteRole; refreshInvite(); });
  q('[data-copy]').addEventListener('click', async () => {
    const input = q('[data-invite-link]');
    try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value); else { input.focus(); input.select(); if (!document.execCommand('copy')) throw Error(); } toast(inviteRole === 'referee' ? 'Приглашение рефери скопировано.' : 'Приглашение сопернику скопировано.'); }
    catch { input.focus(); input.select(); toast('Ссылка выделена. Скопируй её вручную.'); }
  });
  function hide() { root.hidden = true; workshop?.setVisible?.(false); faceoff.update({ active: false }); roundUI.update({ active: false }); voice.cancel(); }
  function prewarm(snapshot) {
    const story=snapshot.story,info=story.roundIntro||{};
    const key=JSON.stringify([snapshot.room,snapshot.phase,story.stage,story.sequenceId,info.round||snapshot.round||1,info.matchSerial||0,story.refereeConnected]);
    if (key===preloadKey) return;
    preloadKey=key;voice.preload(storyVoicePreload(snapshot));
  }

  return {
    profile: () => ({ customization: look }),
    previewActive: () => !root.hidden && latest?.story?.stage === 'workshop' && tab === 'appearance',
    unlock() { voice.unlock(); voice.preload(storyVoicePreload(latest)); },
    setConnected(value) { transportConnected = value; if (!value) preflight.cancel(); if (!value && !root.hidden) { voice.cancel(); q('.journey-paused').hidden = false; } },
    setMuted(value) { isMuted = value; voice.setMuted(value); if (value) preflight.soundMuted(); text(q('[data-sound]'), value ? 'БЕЗ ЗВУКА' : 'ЗВУК ВКЛ.'); q('[data-sound]').setAttribute('aria-pressed', String(!value)); },
    setInvite(value) { invite = value; refreshInvite(); },
    reset() { clearTimeout(profileTimer); hide(); latest = undefined; preflight.reset(); profileRoom = faceoffKey = roundKey = preloadKey = undefined; lastStage = undefined; workshop?.dispose(); workshop = undefined; tab = 'passport'; },
    update(snapshot, id) {
      latest = snapshot; playerId = id;
      const story = snapshot.story ? { ...snapshot.story, paused: snapshot.story.paused || !transportConnected } : null;
      if (story) prewarm(snapshot);
      if (!story || story.stage === 'complete') { if (!root.hidden) hide(); return false; }
      root.hidden = false; root.dataset.stage = story.stage;
      const me = snapshot.players.find(p => p.id === id);
      if (profileRoom !== snapshot.room && me) {
        profileRoom = snapshot.room; look = normalizeCustomization(me.customization);
        inviteRole = snapshot.mode === 'training' ? 'referee' : 'fighter';
        q('[data-invite-role=fighter]').hidden = snapshot.mode === 'training';
        q('[data-name]').value = me.name === 'Автоматон' && !localStorage.getItem('belobog-name') ? '' : me.name;
        q('[data-character]').value = me.character || ''; workshop?.set(look); preflight.reset();
      }
      text(q('[data-room]'), snapshot.room); refreshInvite();
      q('.journey-workshop').hidden = story.stage !== 'workshop';
      q('nav').hidden = story.stage !== 'workshop';
      q('.journey-rules').hidden = story.stage !== 'rules';
      q('.journey-faceoff').hidden = story.stage !== 'faceoff';
      q('.journey-round-intro').hidden = story.stage !== 'roundIntro';
      q('.journey-referee-intro').hidden = story.stage !== 'refereeIntro';
      q('.journey-paused').hidden = !story.paused;
      text(q('.journey-paused strong'), story.refereePreparing ? 'ГОТОВИМ МИКРОФОН' : 'ДЕРЖИМ ПАУЗУ');
      text(q('.journey-paused span'), story.refereePreparing
        ? 'Рефери проверяет звук и готовится к эфиру. Начало дождётся его.'
        : 'Ждём возвращения бойца. История продолжится с этого места.');
      workshop?.setVisible?.(story.stage === 'workshop' && tab === 'appearance');
      if (story.stage !== 'faceoff') { faceoff.update({ active: false }); if (lastStage === 'faceoff') voice.cancel(); }
      if (story.stage !== 'roundIntro') roundUI.update({ active: false });
      const next = q('[data-next]'); next.disabled = story.paused;
      next.hidden = story.stage === 'roundIntro' || story.stage === 'refereeIntro';
      if (story.stage === 'workshop') {
        const locked = Boolean(story.ready[id]);
        q('[data-name]').disabled = q('[data-character]').disabled = locked; workshop?.setEnabled?.(!locked);
        const roster = q('.journey-roster');
        const signature = snapshot.players.map(p => `${p.id}:${p.name}:${p.connected}:${story.ready[p.id]}`).join('|');
        if (roster.dataset.signature !== signature) {
          roster.dataset.signature = signature; roster.replaceChildren();
          for (const p of snapshot.players) { const row = document.createElement('p'), name = document.createElement('strong'), status = document.createElement('span'); name.textContent = p.name; status.textContent = !p.connected ? 'нет связи' : story.ready[p.id] ? 'готов' : p.id === id ? 'это ты' : 'в мастерской'; row.dataset.ready = String(story.ready[p.id]); row.append(name, status); roster.append(row); }
        }
        renderPreflight();
      } else if (story.stage === 'rules') {
        const rule = getClubRuleCard(story.ruleIndex, snapshot.players) || getClubRuleCard(0, snapshot.players);
        const rules = q('.journey-rules');
        if (rules.dataset.card !== rule.id) { rules.scrollTop = 0; rules.dataset.card = rule.id; }
        text(q('[data-rule-section]'), rule.kind === 'charter' ? 'УСТАВ' : 'БОЙ');
        text(q('[data-rule-number]'), String(story.ruleIndex + 1).padStart(2, '0'));
        text(q('[data-rule-kicker]'), `${rule.kind === 'charter' ? 'УСТАВ КЛУБА' : 'КОРОТКО О БОЕ'} / ${story.ruleIndex + 1} ИЗ ${RULE_CARDS.length}`);
        text(q('[data-rule-title]'), rule.title); text(q('[data-rule-text]'), rule.text);
        text(q('.journey-rule-dots'), RULE_CARDS.map((_, i) => i === story.ruleIndex ? '◆' : '◇').join('  '));
        const ack = story.ruleAcks.includes(id);
        next.disabled = story.paused || story.refereeConnected || ack;
        text(next, story.refereeConnected ? 'СЛУШАЕМ РЕФЕРИ' : ack ? 'ЖДЁМ СОПЕРНИКА…' : story.ruleIndex === RULE_CARDS.length - 1 ? 'ВЫХОД НА АРЕНУ →' : 'ПРАВИЛО ПРИНЯТО →');
        text(q('[data-stage-caption]'), story.refereeConnected ? rule.kind === 'charter' ? 'РЕФЕРИ ЗАЧИТЫВАЕТ УСТАВ' : 'РЕФЕРИ ОБЪЯСНЯЕТ БОЙ' : 'ПРОЧИТАЙТЕ И ПОДТВЕРДИТЕ ВДВОЁМ');
        text(q('[data-stage-status]'), story.refereeConnected ? 'Карточки сменяются сами. Дайте ведущему прочитать.' : 'Нет рефери? Дайте голос своим машинам.');
      } else if (story.stage === 'roundIntro') {
        const info = story.roundIntro;
        if (roundKey !== info.sequenceId) { roundKey = info.sequenceId; roundIntro = buildRoundIntro(snapshot.players, snapshot.room, info.round, info.matchSerial); }
        roundUI.update({ active: true, players: snapshot.players, intro: roundIntro, elapsed: story.elapsed, paused: story.paused });
        voice.update({ sequenceId: info.sequenceId, elapsed: story.elapsed, paused: story.paused, beats: roundIntro.beats, enabled: !isMuted });
      } else if (story.stage === 'refereeIntro') {
        voice.cancel();
        text(q('[data-referee-round]'), `ПЕРЕД РАУНДОМ ${snapshot.round}`);
        const remaining = story.refereeIntro?.disconnectedRemaining;
        text(q('[data-referee-connection]'), story.refereeConnected ? 'Таймер ждёт его сигнала.'
          : Number.isFinite(remaining) ? `Возвращаем связь с рефери · ${Math.ceil(remaining)} с` : 'Возвращаем связь с рефери…');
        text(q('[data-stage-caption]'), 'МИКРОФОН У ВЕДУЩЕГО');
        text(q('[data-stage-status]'), 'После объявления — три секунды до боя.');
      } else if (story.stage === 'faceoff') {
        if (faceoffKey !== story.sequenceId) { faceoffKey = story.sequenceId; beats = buildFaceoff(snapshot.players, snapshot.room); }
        const frame = { active: true, sequenceId: story.sequenceId, elapsed: story.elapsed, paused: story.paused, players: snapshot.players, beats, voiceStatus };
        faceoff.update(frame); voice.update({ ...frame, enabled: !isMuted });
        next.disabled = story.paused || story.elapsed < 3 || story.skipVotes.includes(id);
        text(next, story.skipVotes.includes(id) ? 'ПРОПУСК: ЖДЁМ ВТОРОГО' : 'ПРОПУСТИТЬ ВДВОЁМ →');
        text(q('[data-stage-caption]'), 'ПЕРЕД ПЕРВЫМ ГОНГОМ'); text(q('[data-stage-status]'), 'Дуэль в духе JoJo. Имена бойцов — над роботами.');
      }
      lastStage = story.stage;
      return true;
    },
  };
}
