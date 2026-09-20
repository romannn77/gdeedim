(() => {
  const button = document.getElementById('installApp');
  const strip = document.getElementById('installStrip');
  const help = document.getElementById('installHelp');
  const mode = window.matchMedia('(display-mode: standalone)');
  let pendingPrompt = null;
  const installed = () => mode.matches || navigator.standalone === true;
  const refresh = () => { strip.hidden = installed(); };
  refresh();
  mode.addEventListener?.('change', refresh);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); pendingPrompt = event; refresh();
  });
  window.addEventListener('appinstalled', () => { pendingPrompt = null; strip.hidden = true; });
  button.addEventListener('click', async () => {
    if (pendingPrompt) {
      const prompt = pendingPrompt; pendingPrompt = null;
      try { await prompt.prompt(); const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted') strip.hidden = true;
      } catch { showHelp(); }
    } else showHelp();
  });
  function showHelp() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    document.getElementById('installInstructions').textContent = ios
      ? 'На iPhone: откройте этот сайт в Safari, нажмите «Поделиться», затем «На экран Домой». Если есть переключатель «Открывать как веб-приложение», включите его и нажмите «Добавить».'
      : 'Откройте сайт в Chrome или Edge. В меню браузера выберите «Установить приложение» или «Добавить на главный экран». Если такой команды нет, установка может не поддерживаться этим браузером.';
    help.showModal();
  }
  function connection() { document.getElementById('connectionNote').hidden = navigator.onLine; }
  connection(); window.addEventListener('offline', connection); window.addEventListener('online', connection);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      const swUrl = new URL('sw.js', document.baseURI);
      const scope = new URL('./', document.baseURI).pathname;
      navigator.serviceWorker.register(swUrl.pathname, { scope, updateViaCache: 'none' })
        .catch(() => { console.warn('Offline screen unavailable'); });
    });
  }
})();
