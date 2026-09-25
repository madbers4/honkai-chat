#!/usr/bin/env node
// Standalone, offline review artifact. Never writes into the source game.
import { createHash } from 'node:crypto';
import { readFile, realpath, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Страница прослушивания: 57 разговорных записей v3 + 10 боевых.

node scripts/build-voice-review.mjs --source <game-worktree> --output <artifactdir>

--source  Рабочая копия игры с финальными каталогами spoken-v3, combat-v3,
          spoken-script.json и jojo-v3-final-analysis.json.
--output  Внешняя отсутствующая или пустая папка. Исходная игра не изменяется.
--help    Показать эту справку.

Проверяет все тексты, SHA-256 и размеры до записи результата.
Открывайте index.html напрямую: сервер и подключение к сети не нужны.
`;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTORS = { p1: 'Джотаро · игрок 1', p2: 'Дио · игрок 2' };
const COMBAT_LABELS = {
  'jotaro-single-a': 'Джотаро · одиночный ORA 1',
  'jotaro-single-b': 'Джотаро · одиночный ORA 2',
  'jotaro-finisher': 'Джотаро · завершающий удар',
  'jotaro-barrage': 'Джотаро · серия ORA / ульта',
  'dio-single-a': 'Дио · одиночный MUDA 1',
  'dio-single-b': 'Дио · одиночный MUDA 2',
  'dio-finisher': 'Дио · завершающий удар',
  'dio-barrage': 'Дио · короткая серия MUDA',
  'dio-ultimate': 'Дио · серия MUDA / ульта',
  explosion: 'Взрыв · без голосового исходника',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sameKeys = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const durationEqual = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
const size = (bytes) => `${new Intl.NumberFormat('ru-RU').format(bytes)} байт`;
const seconds = (duration) => `${duration.toFixed(3).replace('.', ',')} с`;

function parseArgs(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return null;
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    assert(['--source', '--output'].includes(flag), `Неизвестный аргумент: ${flag}. См. --help.`);
    assert(argv[i + 1] && !argv[i + 1].startsWith('--'), `Нужно значение ${flag}.`);
    assert(!args[flag.slice(2)], `Повторный аргумент: ${flag}.`);
    args[flag.slice(2)] = argv[i + 1];
  }
  assert(args.source && args.output, 'Укажите --source и --output. См. --help.');
  return args;
}

async function loadSource(source) {
  const inputs = {};
  async function json(relative) {
    let bytes;
    try { bytes = await readFile(path.join(source, relative)); }
    catch (error) { throw new Error(`Не найден обязательный файл ${relative}: ${error.message}`); }
    inputs[relative] = hash(bytes);
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  }
  async function catalog(relative, exportName) {
    const file = path.join(source, relative);
    inputs[relative] = hash(await readFile(file));
    const value = (await import(pathToFileURL(file).href))[exportName];
    assert(value && typeof value === 'object', `В ${relative} нет ${exportName}.`);
    return value;
  }
  const script = await json('scripts/voice-production/spoken-script.json');
  const p1 = await catalog('shared/generated-jotaro-voice-clips.js', 'GENERATED_JOTARO_VOICE_CLIPS');
  const p2 = await catalog('shared/generated-dio-voice-clips.js', 'GENERATED_DIO_VOICE_CLIPS');
  // Check versions before final report existence: stale v2 must never masquerade as v3.
  for (const [speaker, clips] of Object.entries({ p1, p2 })) {
    for (const [id, clip] of Object.entries(clips)) {
      assert(ID.test(id), `Небезопасный id записи: ${id}.`);
      assert(clip.url === `/assets/voices/spoken-v3/${id}.mp3`, `${id}: требуется spoken-v3; найден ${clip.url}. Старые и смешанные пакеты не принимаются.`);
      assert(clip.speaker === speaker, `${id}: голос не соответствует каталогу ${speaker}.`);
    }
  }
  const report = await json('scripts/voice-production/jojo-v3-final-analysis.json');
  const combat = await catalog('shared/combat-voice-clips.js', 'COMBAT_VOICE_CLIPS');
  const combatReport = await json('docs/combat-voice-v3-analysis.json');
  assert(Array.isArray(script.utterances) && script.utterances.length === 57, 'Сценарий должен содержать ровно 57 разговорных записей.');
  const utterances = new Map(script.utterances.map((u) => [u.id, u]));
  assert(utterances.size === 57, 'В сценарии повторяются id.');
  for (const [speaker, clips, count] of [['p1', p1, 28], ['p2', p2, 29]]) {
    const expected = script.utterances.filter((u) => u.speaker === speaker).map((u) => u.id);
    assert(expected.length === count && sameKeys(expected, Object.keys(clips)), `${speaker}: каталог не совпадает с полным набором сценария (${count}).`);
    const actor = report.actors?.[speaker];
    assert(actor && typeof actor.recipe === 'string' && actor.recipe && typeof actor.allRecordingsListeningApproved === 'boolean', `${speaker}: неполные сведения о рецепте / слуховой приёмке.`);
    assert(actor.selectedPilot?.id && SHA.test(actor.selectedPilot.sha256) && typeof actor.selectedPilot.userSelected === 'boolean', `${speaker}: отсутствует точная история выбора пробы.`);
  }
  assert(Array.isArray(report.clips) && report.clips.length === 57, 'Финальный отчёт должен содержать ровно 57 записей.');
  const reportClips = new Map(report.clips.map((clip) => [clip.id, clip]));
  assert(reportClips.size === 57 && sameKeys(reportClips.keys(), utterances.keys()), 'Набор id финального отчёта не совпадает со сценарием.');
  assert(Array.isArray(script.faceoffOrder) && script.faceoffOrder.length === 9, 'Нужны 9 реплик катсцены.');
  assert(Array.isArray(script.roundExchanges) && script.roundExchanges.length === 12, 'Нужны 12 предраундовых пар.');
  const grouped = [...script.faceoffOrder];
  const groupById = new Map(script.faceoffOrder.map((id, i) => [id, { group: 'faceoff', order: i + 1 }]));
  const exchangeIds = new Set();
  for (const [index, exchange] of script.roundExchanges.entries()) {
    assert(ID.test(exchange.id) && !exchangeIds.has(exchange.id), 'Неверный или повторный id предраундовой пары.');
    exchangeIds.add(exchange.id);
    for (const turn of ['setup', 'reply']) {
      const canonical = exchange[`${turn}Text`];
      assert(typeof canonical === 'string' && canonical.trim(), `${exchange.id}: нет текста ${turn}.`);
      for (const speaker of ['p1', 'p2']) {
        const id = exchange.utterances?.[turn]?.[speaker];
        const utterance = utterances.get(id);
        assert(utterance?.speaker === speaker && utterance.text === canonical, `${exchange.id}/${turn}/${speaker}: текст или голос расходится с канонической парой.`);
        grouped.push(id);
        groupById.set(id, { group: 'round', exchange: exchange.id, exchangeOrder: index + 1, turn });
      }
    }
    for (const [parity, first, second] of [['odd', 'p1', 'p2'], ['even', 'p2', 'p1']]) {
      const order = exchange.playOrder?.[parity];
      assert(Array.isArray(order) && order.length === 2 && order[0] === exchange.utterances.setup[first] && order[1] === exchange.utterances.reply[second], `${exchange.id}: нарушен порядок завязка → ответ (${parity}).`);
    }
  }
  assert(grouped.length === 57 && new Set(grouped).size === 57 && sameKeys(grouped, utterances.keys()), 'Катсцена и пары должны покрывать все 57 реплик ровно один раз.');
  assert(sameKeys(Object.keys(combat), Object.keys(COMBAT_LABELS)), 'Боевой каталог должен содержать ровно 10 ожидаемых нарезок.');
  assert(typeof combatReport.listeningApproved === 'boolean', 'В боевом отчёте нет отдельного статуса слуховой приёмки.');
  const files = [];
  const clips = [];
  async function asset(id, clip, expected, metadata, folder) {
    assert(typeof clip.duration === 'number' && clip.duration > 0 && Number.isFinite(clip.duration), `${id}: неверная длительность.`);
    assert(SHA.test(expected.sha256) && Number.isSafeInteger(expected.bytes) && expected.bytes > 0, `${id}: нет проверяемого SHA / размера.`);
    const bytes = await readFile(path.join(source, 'public', ...clip.url.slice(1).split('/')));
    const sha256 = hash(bytes);
    assert(sha256 === expected.sha256 && bytes.length === expected.bytes, `${id}: MP3 не совпадает с SHA / размером финального отчёта.`);
    const localUrl = `audio/${folder}/${id}.mp3`;
    clips.push({ id, ...metadata, text: clip.text ?? null, duration: clip.duration, bytes: bytes.length, sha256, sourceUrl: clip.url, localUrl });
    files.push({ localUrl, bytes });
  }
  for (const id of grouped) {
    const utterance = utterances.get(id);
    const clip = (utterance.speaker === 'p1' ? p1 : p2)[id];
    const row = reportClips.get(id);
    assert(typeof utterance.text === 'string' && utterance.text.trim() && clip.text === utterance.text && row.text === utterance.text, `${id}: текст MP3-каталога / отчёта не совпадает со сценарием.`);
    assert(row.speaker === utterance.speaker && durationEqual(row.duration, clip.duration), `${id}: голос / длительность расходится с финальным отчётом.`);
    // Synthesis punctuation can differ from subtitles; preserve it without presenting it as spoken approval.
    await asset(id, clip, row, { speaker: utterance.speaker, synthesisText: row.synthesisText ?? null, ...groupById.get(id) }, 'spoken');
  }
  for (const [id, label] of Object.entries(COMBAT_LABELS)) {
    const clip = combat[id];
    assert(clip.url === `/assets/voices/combat-v3/${id}.mp3`, `${id}: требуется отдельная нарезка combat-v3.`);
    await asset(id, clip, clip, { group: 'combat', actor: clip.actor, role: clip.role, label }, 'combat');
  }
  return { script, report, combatReport, inputs, clips, files };
}

function makePage(data) {
  const byId = new Map(data.clips.map((clip) => [clip.id, clip]));
  function card(id, heading) {
    const clip = byId.get(id);
    const title = heading ?? ACTORS[clip.speaker] ?? clip.label;
    return `<article class="clip"><h4>${escape(title)}</h4>${clip.text ? `<p class="line">${escape(clip.text)}</p>` : '<p class="line muted">Боевой звук; подпись обозначает его роль, а не ASR-транскрипцию.</p>'}
<audio controls preload="none" src="${escape(clip.localUrl)}" aria-label="${escape(`${title}: ${clip.text ?? clip.label}`)}" data-label="${escape(title)}"></audio>
<p class="meta">${seconds(clip.duration)} · ${size(clip.bytes)} · MP3 <a href="${escape(clip.localUrl)}" download>Скачать</a></p>
<details><summary>Данные записи</summary><code>${escape(id)}</code><span class="hash">SHA-256: ${clip.sha256}</span></details></article>`;
  }
  const actorNotes = ['p1', 'p2'].map((speaker) => {
    const actor = data.report.actors[speaker];
    const selected = actor.selectedPilot.userSelected;
    const recipe = speaker === 'p1' ? 'рецепт по выбранной пробе А' : 'рецепт по выбранной выразительной пробе';
    return `<li><strong>${escape(ACTORS[speaker])}</strong> — ${selected ? recipe : 'выбор пробы не подтверждён'}. ${actor.allRecordingsListeningApproved ? 'Весь разговорный пакет этого актёра отмечен в отчёте как прослушанный и одобренный.' : 'Полная слуховая приёмка новых записей ещё не отмечена.'}</li>`;
  }).join('');
  const faceoff = data.script.faceoffOrder.map((id, i) => card(id, `${i + 1}. ${ACTORS[byId.get(id).speaker]}`)).join('');
  const rounds = data.script.roundExchanges.map((exchange, i) => `<section class="exchange"><h3>${i + 1}. ${escape(exchange.title)}</h3>${['setup', 'reply'].map((turn) => `<h4 class="turn">${turn === 'setup' ? 'Завязка' : 'Ответ'}</h4><div class="grid pair">${['p1', 'p2'].map((speaker) => card(exchange.utterances[turn][speaker])).join('')}</div>`).join('')}</section>`).join('');
  const combat = Object.keys(COMBAT_LABELS).map((id) => card(id)).join('');
  const total = data.clips.reduce((sum, clip) => sum + clip.bytes, 0);
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Голоса бойцовского клуба · v3</title>
<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#10141c;color:#f3eee6;font:16px/1.55 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px clamp(14px,4vw,36px) 70px}h1{font-size:clamp(26px,5vw,42px);line-height:1.15}h2{margin:48px 0 14px;font-size:27px}h3{font-size:21px;margin:0 0 18px}h4{margin:0;font-size:16px}p{margin:10px 0}.eyebrow{color:#efbc72;text-transform:uppercase;letter-spacing:.1em;font-size:12px}.muted,.meta{color:#aeb8c6}.notice{padding:18px 22px;background:#202b3b;border-left:3px solid #eab975;border-radius:5px;margin:24px 0}.notice ul{padding-left:20px;margin:12px 0}.notice li+li{margin-top:10px}nav{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}a{color:#f4c584;text-underline-offset:3px}nav a,button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:9px 15px;border:1px solid #45536a;border-radius:8px;color:#f3eee6;background:#202a38;text-decoration:none;font:inherit}button{cursor:pointer}.toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.toolbar p{flex:1 1 180px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:15px}.pair{grid-template-columns:repeat(2,minmax(0,1fr))}.clip{min-width:0;padding:18px;border:1px solid #354359;border-radius:12px;background:#19222f}.line{font-size:18px;min-height:2.9em}.clip audio{display:block;width:100%;height:54px;margin:16px 0 10px}.meta{font-size:13px}.meta a{display:inline-flex;align-items:center;min-height:44px;margin-left:8px}.exchange{margin:20px 0 32px;padding:22px;background:#141b25;border:1px solid #303b4d;border-radius:14px}.turn{margin:16px 0 10px;color:#e8bd84;font-size:13px;letter-spacing:.05em;text-transform:uppercase}details{font-size:12px;color:#acb8cb}summary{cursor:pointer;min-height:44px;display:flex;align-items:center}code,.hash{display:block;overflow-wrap:anywhere;margin:6px 0}section{scroll-margin-top:18px}footer{margin-top:38px;border-top:1px solid #354359;padding-top:18px;font-size:14px}a:focus-visible,button:focus-visible,summary:focus-visible,audio:focus-visible{outline:3px solid #ffcd82;outline-offset:3px}@media(max-width:620px){.pair{grid-template-columns:1fr}.exchange{padding:14px}.line{min-height:0}.notice{padding:14px 16px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><main>
<p class="eyebrow">Бойцовский клуб · офлайн-прослушивание</p><h1>Голоса и боевые выкрики</h1><p class="muted">57 разговорных записей + 10 боевых звуков · ${size(total)}. Загрузка звука начинается после нажатия ▶.</p>
<aside class="notice"><strong>Выбор пробы ≠ одобрение всего пакета</strong><ul>${actorNotes}</ul><p>Выбранная проба определяет рецепт подачи; новые записи имеют собственные хеши. Техническая проверка и ASR не заменяют прослушивание.</p><p>Боевые нарезки: ${data.combatReport.listeningApproved ? 'слуховое одобрение отмечено в отчёте.' : 'слуховая приёмка ещё не отмечена.'}</p></aside>
<nav aria-label="Разделы"><a href="#faceoff">Катсцена · 9</a><a href="#rounds">Перед раундом · 48</a><a href="#combat">Бой · 10</a><a href="manifest.json" download>Манифест с SHA</a></nav>
<div class="toolbar"><button id="stop" type="button">Остановить звук</button><p id="status" class="muted" role="status" aria-live="polite">Выберите запись. Одновременно играет только один файл.</p></div>
<section id="faceoff"><h2>Катсцена</h2><p class="muted">Все девять реплик в порядке появления.</p><div class="grid">${faceoff}</div></section>
<section id="rounds"><h2>Перед раундом</h2><p class="muted">Двенадцать пар: сначала завязка, затем ответ. Оба варианта голоса показаны рядом. В нечётном раунде начинает игрок 1, в чётном — игрок 2; смысловой порядок сохраняется.</p>${rounds}</section>
<section id="combat"><h2>Боевые звуки</h2><p class="muted">Готовые короткие нарезки оригинальных выкриков и отдельный взрыв.</p><div class="grid">${combat}</div></section>
<footer>Страница автономна: локальные MP3, без API и автозапуска. В <a href="manifest.json" download>манифесте</a> сохранены тексты, длительности, точные размеры, хеши и отдельные статусы выбора проб / слуховой приёмки.</footer>
</main><script>
const players = [...document.querySelectorAll('audio')];
const status = document.getElementById('status');
for (const player of players) {
  player.addEventListener('play', () => {
    for (const other of players) if (other !== player) other.pause();
    status.textContent = 'Сейчас: ' + player.dataset.label;
  });
  player.addEventListener('ended', () => { status.textContent = 'Запись закончилась. Выберите следующую.'; });
  player.addEventListener('error', () => { status.textContent = 'Не удалось открыть локальный MP3: ' + player.dataset.label; });
}
document.getElementById('stop').addEventListener('click', () => {
  for (const player of players) { player.pause(); if (player.readyState > 0) player.currentTime = 0; }
  status.textContent = 'Звук остановлен.';
});
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const player of players) player.pause(); });
</script></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { process.stdout.write(HELP); return; }
  const source = await realpath(path.resolve(args.source));
  const output = path.resolve(args.output);
  assert(!inside(source, output), '--output должен находиться вне исходной рабочей копии игры.');
  // Resolve the nearest existing parent too, so junctions cannot redirect output into the game.
  let ancestor = output;
  for (;;) {
    try { assert(!inside(source, await realpath(ancestor)), '--output через ссылку ведёт внутрь исходной игры.'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); assert(parent !== ancestor, 'Не найден родитель --output.'); ancestor = parent; }
  }
  try { assert((await readdir(output)).length === 0, '--output уже содержит файлы. Выберите новую или пустую папку.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const data = await loadSource(source);
  const manifest = {
    schemaVersion: 1, id: 'club-voice-review-v3', generatedAt: new Date().toISOString(),
    counts: { faceoff: 9, roundExchanges: 12, round: 48, combat: 10, total: 67 },
    sourceName: path.basename(source), sourceFileSha256: data.inputs,
    approvalScope: 'selectedPilot selects a recipe; it does not approve every generated recording. ASR is not listening approval.',
    actors: data.report.actors, combatListeningApproved: data.combatReport.listeningApproved,
    faceoffOrder: data.script.faceoffOrder,
    roundExchanges: data.script.roundExchanges.map(({ id, title, setupText, replyText, utterances, playOrder }) => ({ id, title, setupText, replyText, utterances, playOrder })),
    totalBytes: data.clips.reduce((sum, clip) => sum + clip.bytes, 0), clips: data.clips,
  };
  const html = makePage(data);
  // No artifact is written until every input and MP3 has passed validation.
  await mkdir(path.join(output, 'audio', 'spoken'), { recursive: true });
  await mkdir(path.join(output, 'audio', 'combat'), { recursive: true });
  for (const file of data.files) await writeFile(path.join(output, file.localUrl), file.bytes, { flag: 'wx' });
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'index.html'), html, { flag: 'wx' });
  process.stdout.write(`Готово: ${path.join(output, 'index.html')}\n67 записей; ${size(manifest.totalBytes)}.\n`);
}

main().catch((error) => { process.stderr.write(`Ошибка сборки прослушивания: ${error.message}\n`); process.exitCode = 1; });
