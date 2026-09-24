import { mountRefereePage } from '../src/referee-page.js';
const info = await fetch('/__referee-review__/info').then(response => response.json());
mountRefereePage({ room: info.room });
const lab = document.createElement('details');
lab.style.cssText = 'position:fixed;left:14px;bottom:4px;z-index:50;font:10px Arial;color:#f0dbb1;background:#122329dd;padding:3px 7px;border-radius:3px;';
const title = document.createElement('summary'); title.textContent = 'QA · сцены'; lab.append(title);
for (const [id, label] of [['workshop','Мастерская'], ['rules','Правила'], ['faceoff','Выход'], ['round','Перепалка'], ['fight','Бой'], ['paused','Пауза'], ['final','Финал']]) {
  const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'margin:4px;padding:6px;background:#eee5d1;border:0;border-radius:2px;color:#213931;font:10px Arial;';
  button.addEventListener('click', async () => { await fetch('/__referee-review__/scene', { method: 'POST', body: JSON.stringify({ scene: id }) }); lab.open = false; }); lab.append(button);
}
document.body.append(lab);
