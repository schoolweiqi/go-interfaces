// Fox Go: isolated experimental transport adapter.
// IMPORTANT: WebSocket connection is NOT Fox account authentication.
// Browser cannot open Fox TCP sockets directly. Configure an authorized WSS->TCP proxy.
// Never place account passwords or a private proxy credential in public source files.
(() => {
  'use strict';
  const connectButton = document.getElementById('foxConnect');
  const disconnectButton = document.getElementById('foxDisconnect');
  const status = document.getElementById('foxStatus');
  if (!connectButton || !disconnectButton || !status) return;

  const config = window.GO_FOX_CONFIG || {};
  let socket = null;
  let timeout = null;
  let manuallyClosed = false;

  function update(message, connected = false, busy = false) {
    status.textContent = message;
    connectButton.disabled = connected || busy;
    disconnectButton.hidden = !connected && !busy;
  }

  function disconnect() {
    manuallyClosed = true;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    const previous = socket;
    socket = null;
    if (previous) previous.close(1000, 'User disconnected');
    update('Не подключено к Fox.');
  }

  function connect() {
    if (socket) return;
    if (!config.proxyUrl) {
      update('Fox: TCP-прокси не настроен. Укажите GO_FOX_CONFIG.proxyUrl в config.js. Авторизация пока не реализована.');
      return;
    }
    let url;
    try {
      url = new URL(config.proxyUrl, location.href);
      if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('Для удалённого прокси требуется wss://');
      }
      url.pathname = '/proxy';
      url.search = '';
      url.searchParams.set('host', config.host || '43.132.13.39');
      url.searchParams.set('port', String(config.port || 10000));
    } catch (error) {
      update('Fox: неверный адрес прокси: ' + error.message);
      return;
    }
    manuallyClosed = false;
    update('Соединение с TCP-прокси Fox…', false, true);
    try {
      // No third-party proxy token is bundled or borrowed.
      // Configure a proxy that you own and authorize for this site.
      const protocols = ['tcp-proxy'];
      if (config.proxyToken) protocols.push(config.proxyToken);
      const ws = new WebSocket(url.href, protocols);
      socket = ws;
      ws.binaryType = 'arraybuffer';
      timeout = setTimeout(() => {
        if (socket !== ws || ws.readyState === WebSocket.OPEN) return;
        update('Fox: время ожидания соединения истекло.');
        ws.close();
      }, 10000);
      ws.onopen = () => {
        if (socket !== ws) return;
        clearTimeout(timeout);
        timeout = null;
        update('Транспорт Fox подключён. Вход в аккаунт пока не реализован.', true);
      };
      ws.onmessage = () => {
        // Binary Fox protocol framing and login response parsing are next steps.
      };
      ws.onerror = () => {
        if (socket === ws) update('Fox: ошибка соединения с прокси.');
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        clearTimeout(timeout);
        timeout = null;
        socket = null;
        if (!manuallyClosed) update('Fox: соединение закрыто. Проверьте настройки прокси и доступность сервера.');
      };
    } catch (error) {
      socket = null;
      update('Fox: не удалось открыть соединение: ' + error.message);
    }
  }
  connectButton.addEventListener('click', connect);
  disconnectButton.addEventListener('click', disconnect);
  window.goFox = { connect, disconnect, get connected() { return socket?.readyState === WebSocket.OPEN; } };
})();
