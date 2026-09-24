const role = new URL(location.href).searchParams.get('role');

async function start() {
  if (role === 'referee') {
    // Referee owns a resizable arena panel instead of the fighter's full screen.
    document.getElementById('arena')?.remove();
    document.querySelector('.film-grain')?.remove();
    const { mountRefereePage } = await import('./referee-page.js');
    await mountRefereePage({ container: document.getElementById('app') });
  } else await import('./main.js');
}

start().catch(error => {
  console.error('Club page could not start:', error);
  const app = document.getElementById('app');
  app.replaceChildren();
  const message = document.createElement('p');
  message.textContent = 'Не удалось открыть клуб. Обновите страницу и попробуйте ещё раз.';
  message.style.cssText = 'padding:32px;color:#efdfbf;background:#142127;font:18px/1.6 Arial';
  app.append(message);
});
