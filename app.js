// Application orchestration: custom network rooms and startup.

    function networkConfigured() {
      return NETWORK_SERVER_URL && !NETWORK_SERVER_URL.includes('YOUR-WORKER');
    }

    function roomStorageKey(roomId) { return `go-network-room:${roomId}`; }

    function saveRoomCredential(roomId, token, color) {
      localStorage.setItem(roomStorageKey(roomId), JSON.stringify({ token, color, touchedAt: Date.now() }));
    }

    function loadRoomCredential(roomId) {
      try {
        const raw = localStorage.getItem(roomStorageKey(roomId));
        if (!raw) return null;
        const value = JSON.parse(raw);
        if (!value.token) return null;
        // Локально держим только ключ переподключения. Игровое состояние хранится на сервере.
        if (Date.now() - Number(value.touchedAt || 0) > NETWORK_RECONNECT_WINDOW_MS) {
          localStorage.removeItem(roomStorageKey(roomId));
          return null;
        }
        return value;
      } catch (_) { return null; }
    }

    function makeRoomLink(roomId) {
      const url = new URL(location.href);
      url.searchParams.set('room', roomId);
      url.hash = '';
      return url.href;
    }

    function setRoomInUrl(roomId) {
      const url = new URL(location.href);
      if (roomId) url.searchParams.set('room', roomId);
      else url.searchParams.delete('room');
      history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }

    async function networkRequest(path, options = {}) {
      if (!networkConfigured()) throw new Error('Cloudflare Worker ещё не развёрнут. Укажите его URL в network-config.js.');
      const response = await fetch(`${NETWORK_SERVER_URL}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
      });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    }

    function applyNetworkState(state) {
      if (!state || !Array.isArray(state.board)) return;

      const previousState = networkGame.lastState;
      const previousMoveNumber = Number(previousState?.moveNumber ?? previousState?.moves?.length ?? -1);
      const nextMoveNumber = Number(state.moveNumber ?? state.moves?.length ?? -1);
      const hasNewMove = Boolean(previousState) && nextMoveNumber > previousMoveNumber;
      const lastMoveColor = Number(state.lastMove?.color || 0);
      if (board.size !== state.size) board.setSize(state.size);
      board.stones = state.board.slice();
      board.captures = { 1: Number(state.captures?.black || 0), 2: Number(state.captures?.white || 0) };
      board.history = [];
      board.positionHistory = [board.positionKey()];
      board.lastMove = state.lastMove && !state.lastMove.pass ? { x: state.lastMove.x, y: state.lastMove.y, stone: state.lastMove.color } : null;
      turn = state.turn || 1;
      networkGame.lastState = state;
      updateTurn();
      updateCaptures();
      board.draw();
      if (
        hasNewMove &&
        state.lastMove &&
        !state.lastMove.pass &&
        window.stoneSound &&
        typeof window.stoneSound.play === 'function'
      ) {
        window.stoneSound.play();
      }

      const myTurn = networkGame.color === turn && state.status === 'playing';
      if (
        hasNewMove &&
        myTurn &&
        (lastMoveColor === 1 || lastMoveColor === 2) &&
        lastMoveColor !== networkGame.color
      ) {
        window.movePause.arm();
      }
      const colorText = networkGame.color === 1 ? 'чёрные' : networkGame.color === 2 ? 'белые' : 'наблюдатель';
      const blackOnline = state.presence?.black ? '● в сети' : '● не в сети';
      const whiteOnline = state.presence?.white ? '○ в сети' : '○ не в сети';
      if (state.status === 'ended') {
        networkStatus.innerHTML = `<strong>Партия завершена.</strong><br>${blackOnline} · ${whiteOnline}`;
      } else {
        networkStatus.innerHTML = `<span class="networkBadge">Вы: ${colorText}</span>${myTurn ? '<strong>Ваш ход</strong>' : 'Ход соперника'}<br>${blackOnline} · ${whiteOnline}`;
      }
    }

    function clearReconnectTimer() {
      if (networkGame.reconnectTimer) clearTimeout(networkGame.reconnectTimer);
      networkGame.reconnectTimer = null;
    }

    function scheduleNetworkReconnect() {
      if (!networkGame.active || networkGame.manualClose) return;
      if (!networkGame.reconnectStartedAt) networkGame.reconnectStartedAt = Date.now();
      const elapsed = Date.now() - networkGame.reconnectStartedAt;
      if (elapsed >= NETWORK_RECONNECT_WINDOW_MS) {
        networkStatus.textContent = 'Время переподключения истекло. Комната могла быть удалена.';
        return;
      }
      clearReconnectTimer();
      const delay = Math.min(10000, 1200 + Math.floor(elapsed / 10000) * 800);
      networkStatus.textContent = navigator.onLine ? 'Связь потеряна. Переподключаюсь…' : 'Нет интернета. Переподключение продолжится после восстановления сети.';
      networkGame.reconnectTimer = setTimeout(() => connectNetworkSocket().catch(() => scheduleNetworkReconnect()), delay);
    }

    async function connectNetworkSocket() {
      if (!networkGame.roomId || !networkGame.token) return;
      clearReconnectTimer();
      if (!networkConfigured()) throw new Error('Не указан URL Cloudflare Worker.');
      const wsBase = NETWORK_SERVER_URL.replace(/^http/, 'ws');
      const ws = new WebSocket(`${wsBase}/api/rooms/${encodeURIComponent(networkGame.roomId)}/ws?token=${encodeURIComponent(networkGame.token)}`);
      networkGame.socket = ws;
      networkGame.manualClose = false;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Таймаут подключения')), 10000);
        ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WebSocket не подключился')); }, { once: true });
      });

      networkGame.connected = true;
      networkGame.reconnectStartedAt = null;
      saveRoomCredential(networkGame.roomId, networkGame.token, networkGame.color);
      networkStatus.textContent = 'Подключено. Ожидаю состояние партии…';

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'state') applyNetworkState(msg.state);
        if (msg.type === 'error') networkStatus.textContent = `Сервер: ${msg.error}`;
        if (msg.type === 'hello') {
          if (msg.color) networkGame.color = msg.color;
          if (msg.state) applyNetworkState(msg.state);
        }
      });
      ws.addEventListener('close', () => {
        networkGame.connected = false;
        if (networkGame.socket === ws) networkGame.socket = null;
        scheduleNetworkReconnect();
      });
      ws.addEventListener('error', () => {});
    }

    async function activateNetworkRoom(roomId, token, color) {
      if (botGame.active) stopBotGame();
      gameMode = 'network';
      networkGame.active = true;
      networkGame.roomId = roomId;
      networkGame.token = token;
      networkGame.color = Number(color);
      networkGame.manualClose = false;
      networkGame.reconnectStartedAt = null;
      saveRoomCredential(roomId, token, color);
      setRoomInUrl(roomId);
      networkGameLink.value = makeRoomLink(roomId);
      networkLinkBox.hidden = false;
      leaveNetworkButton.hidden = false;
      createNetworkButton.hidden = true;
      document.getElementById('undo').disabled = true;
      await connectNetworkSocket();
    }

    async function createNetworkGame() {
      createNetworkButton.disabled = true;
      networkStatus.textContent = 'Создаю комнату в Cloudflare…';
      try {
        const result = await networkRequest('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ size: Number(networkSizeSelect.value) })
        });
        await activateNetworkRoom(result.roomId, result.playerToken, result.color);
        networkStatus.textContent = 'Комната создана. Отправьте ссылку второму игроку.';
      } catch (error) {
        networkStatus.textContent = `Не удалось создать партию: ${error.message}`;
      } finally {
        createNetworkButton.disabled = false;
      }
    }

    async function joinNetworkRoom(roomId) {
      if (!roomId) return;
      if (!networkConfigured()) {
        networkStatus.textContent = 'В ссылке есть комната, но Cloudflare Worker ещё не настроен.';
        return;
      }
      networkStatus.textContent = 'Подключаюсь к онлайн-партии…';
      const saved = loadRoomCredential(roomId);
      try {
        let token, color;
        if (saved) {
          token = saved.token;
          color = saved.color;
        } else {
          const result = await networkRequest(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
            method: 'POST',
            body: JSON.stringify({})
          });
          token = result.playerToken;
          color = result.color;
        }
        await activateNetworkRoom(roomId, token, color);
      } catch (error) {
        localStorage.removeItem(roomStorageKey(roomId));
        networkStatus.textContent = `Не удалось войти в комнату: ${error.message}`;
      }
    }

    function leaveNetworkGame() {
      networkGame.manualClose = true;
      clearReconnectTimer();
      if (networkGame.socket) {
        try { networkGame.socket.close(1000, 'user left'); } catch (_) {}
      }
      networkGame.socket = null;
      networkGame.connected = false;
      networkGame.active = false;
      gameMode = 'local';
      createNetworkButton.hidden = false;
      leaveNetworkButton.hidden = true;
      networkLinkBox.hidden = true;
      document.getElementById('undo').disabled = false;
      setRoomInUrl(null);
      networkStatus.textContent = 'Вы вышли из онлайн-партии. Комната удалится через 30 минут, если в ней никого не останется.';
    }

    function sendNetworkAction(payload) {
      if (!networkGame.socket || networkGame.socket.readyState !== WebSocket.OPEN) {
        networkStatus.textContent = 'Нет соединения с сервером. Жду переподключения…';
        return false;
      }
      networkGame.socket.send(JSON.stringify(payload));
      return true;
    }

    createNetworkButton.addEventListener('click', () => createNetworkGame());
    leaveNetworkButton.addEventListener('click', leaveNetworkGame);
    copyNetworkLinkButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(networkGameLink.value);
        copyNetworkLinkButton.textContent = 'Скопировано';
        setTimeout(() => copyNetworkLinkButton.textContent = 'Копировать', 1200);
      } catch (_) {
        networkGameLink.select();
        document.execCommand('copy');
      }
    });
    window.addEventListener('online', () => {
      if (networkGame.active && !networkGame.connected) connectNetworkSocket().catch(() => scheduleNetworkReconnect());
    });


    updateTurn();
    updateCaptures();
    requestAnimationFrame(() => board.draw());
    // Восстанавливаем OAuth/OGS-сессию после загрузки всех игровых модулей.
    handleOgsCallback().catch(error => {
      const status = document.getElementById('ogsStatus');
      if (status) status.textContent = 'Ошибка запуска OGS: ' + error.message;
    });

    const initialRoomId = new URL(location.href).searchParams.get('room');
    if (initialRoomId) joinNetworkRoom(initialRoomId);
