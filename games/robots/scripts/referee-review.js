import { mountRefereePage } from '../src/referee-page.js';
const info = await fetch('/__referee-review__/info').then(response => response.json());
mountRefereePage({ room: info.room });
const lab = document.createElement('details');
lab.style.cssText = 'position:fixed;left:14px;bottom:4px;z-index:50;font:10px Arial;color:#f0dbb1;background:#122329dd;padding:3px 7px;border-radius:3px;';
const title = document.createElement('summary'); title.textContent = 'QA · сцены'; lab.append(title);
const status = document.createElement('p'); status.style.cssText = 'max-width:300px;margin:5px 0;line-height:1.5;';
status.textContent = 'Сначала выберите фаворита и подключите звук. «Слово рефери» ждёт настоящую кнопку начала раунда. «Бой» включает двух ботов.';
lab.append(status);
for (const [id, label] of [['workshop','Мастерская'], ['rules','Правила'], ['faceoff','Выход'], ['round','Перепалка'], ['refereeIntro','Слово рефери'], ['fight','Бой · боты'], ['paused','Пауза'], ['final','Финал']]) {
  const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'margin:4px;padding:6px;background:#eee5d1;border:0;border-radius:2px;color:#213931;font:10px Arial;';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch('/__referee-review__/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: id }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Не удалось открыть сцену');
      status.textContent = `Сцена: ${result.stage} · ${result.phase}. Пульт использует настоящий сервер.`;
      lab.open = false;
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }); lab.append(button);
}
document.body.append(lab);
