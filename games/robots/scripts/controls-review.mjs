// Local-only UI acceptance: use the real main.js markup, no production debug route.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MAX_HP, WINS_TO_MATCH, ROUND_SECONDS } from '../shared/constants.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, cacheDir: 'artifacts/controls-vite-cache', server: { host: '127.0.0.1', port: Number(process.env.REPLAY_PORT) || 3072, strictPort: true }, plugins: [{ name: 'controls-review', configureServer(vite) {
  vite.middlewares.use(async (request, response, next) => {
    if (!request.url.startsWith('/controls-review')) return next();
    const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    const icons = Function(`return ${source.match(/const icons = (\{[\s\S]*?\n\});/)[1]}`)();
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
    const raw = source.slice(source.indexOf('  <section id="game"'), source.indexOf('  <div id="rotate-screen"'));
    const markup = Function('icon', 'MAX_HP', 'WINS_TO_MATCH', 'ROUND_SECONDS', `return \`${raw}\``)(icon, MAX_HP, WINS_TO_MATCH, ROUND_SECONDS).replace('class="game screen" hidden', 'class="game screen"');
    const finish = source.match(/<div id="finisher-prompt"[\s\S]*?<\/div>\r?\n  <\/div>/)[0];
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Два пальца · проверка управления</title></head><body data-view="game"><div id="arena"></div><div id="app">${markup}${finish}</div><nav id="review"><select id="scene" aria-label="Сценарий"><option value="idle">Обычный бой</option><option value="series">Продолжение серии</option><option value="heavy">Тяжёлая серия</option><option value="whiff">Серия после промаха</option><option value="pursue">Догнать прыжком</option><option value="tech">Вырваться</option><option value="pummel">Дожим</option><option value="throw">Бросок</option><option value="burst">Сброс</option><option value="defend">Защита</option><option value="finish">Добивание</option><option value="paused">Пауза</option></select><label><input id="motion" type="checkbox">Спокойно</label></nav><script type="module" src="/scripts/controls-review.js"></script></body></html>`;
    response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml('/controls-review', html));
  });
} }] });
await server.listen(); console.log(`Controls review: http://127.0.0.1:${server.config.server.port}/controls-review`);
