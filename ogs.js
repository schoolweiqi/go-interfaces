// OGS OAuth, websocket matchmaking and move/search integration.

    function base64Url(bytes) {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function randomUrlSafe(bytes = 32) {
      const data = new Uint8Array(bytes);
      crypto.getRandomValues(data);
      return base64Url(data);
    }

    async function sha256Base64Url(text) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return base64Url(new Uint8Array(digest));
    }

    function cleanOAuthQuery() {
      const url = new URL(location.href);
      ['code', 'state', 'error', 'error_description'].forEach(k => url.searchParams.delete(k));
      history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    }

    function currentRedirectCandidate() {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
      const u = new URL(location.href);
      u.search = '';
      u.hash = '';
      return u.href;
    }


    let ogsSocket = null;
    let ogsSocketReady = false;
    let activeAutomatchUuid = null;
    let lastOgsConfig = null;

    function wsSend(command, data = {}, id) {
      if (!ogsSocket || ogsSocket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket OGS ещё не подключён');
      }
      const packet = id === undefined ? [command, data] : [command, data, id];
      ogsSocket.send(JSON.stringify(packet));
    }

    async function getOgsConfig(accessToken) {
      const response = await fetch(OGS.configUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new Error(`OGS /ui/config: HTTP ${response.status}`);
      return response.json();
    }

    function setSearchState(searching, message) {
      const findButton = document.getElementById('findOpponent');
      const cancelButton = document.getElementById('cancelSearch');
      findButton.hidden = searching;
      cancelButton.hidden = !searching;
      if (message) document.getElementById('gameMsg').textContent = message;
    }

    function handleOgsSocketMessage(event) {
      let packet;
      try { packet = JSON.parse(event.data); } catch (_) { return; }
      if (!Array.isArray(packet) || packet.length < 2) return;

      const type = packet[0];
      const data = packet[1] || {};
      if (typeof type !== 'string') return; // request-id response

      if (type === 'automatch/entry') {
        activeAutomatchUuid = data.uuid || activeAutomatchUuid;
        setSearchState(true, 'OGS ищет подходящего соперника…');
      } else if (type === 'automatch/cancel') {
        activeAutomatchUuid = null;
        setSearchState(false, 'Поиск соперника отменён.');
      } else if (type === 'automatch/start') {
        activeAutomatchUuid = null;
        setSearchState(false, `Соперник найден. Партия #${data.game_id} создана.`);
        // Пока наша доска ещё не синхронизирована с живой OGS-партией,
        // безопасно переводим игрока в официальный игровой экран OGS.
        if (data.game_id) {
          setTimeout(() => { location.href = `https://online-go.com/game/${data.game_id}`; }, 650);
        }
      }
    }

    async function connectOgsSocket(accessToken) {
      const findButton = document.getElementById('findOpponent');
      ogsSocketReady = false;
      findButton.disabled = true;

      lastOgsConfig = await getOgsConfig(accessToken);
      const jwt = lastOgsConfig && lastOgsConfig.user_jwt;
      if (!jwt) throw new Error('OGS не вернул user_jwt');

      if (ogsSocket) {
        try { ogsSocket.close(); } catch (_) {}
      }

      ogsSocket = new WebSocket(OGS.websocketUrl);
      ogsSocket.addEventListener('message', handleOgsSocketMessage);
      ogsSocket.addEventListener('open', () => {
        try {
          wsSend('authenticate', {
            jwt,
            client: 'SchoolWeiqi Go Interfaces',
            client_version: '0.4'
          });
          ogsSocketReady = true;
          findButton.disabled = false;
          document.getElementById('gameMsg').textContent = 'OGS подключён. Можно запустить автоматический поиск.';
        } catch (error) {
          document.getElementById('gameMsg').textContent = `Ошибка WebSocket: ${error.message}`;
        }
      });
      ogsSocket.addEventListener('close', () => {
        ogsSocketReady = false;
        findButton.disabled = true;
        if (sessionStorage.getItem('ogs_access_token')) {
          document.getElementById('gameMsg').textContent = 'Соединение с игровым сервером OGS закрыто. Обновите страницу.';
        }
      });
      ogsSocket.addEventListener('error', () => {
        document.getElementById('gameMsg').textContent = 'Не удалось подключиться к игровому WebSocket OGS.';
      });
    }

    function makeUuid() {
      if (crypto.randomUUID) return crypto.randomUUID();
      return `${randomUrlSafe(12)}-${Date.now()}`;
    }

    function automatchPreferences() {
      const size = document.getElementById('size').value;
      const speed = document.getElementById('speed').value;
      return {
        uuid: makeUuid(),
        size_speed_options: [{ size: `${size}x${size}`, speed, system: 'byoyomi' }],
        lower_rank_diff: 3,
        upper_rank_diff: 3,
        rules: { condition: 'preferred', value: 'japanese' },
        handicap: { condition: 'preferred', value: 'disabled' },
        timestamp: Date.now()
      };
    }

    function startAutomatch() {
      if (botGame && botGame.active) stopBotGame();
      if (!sessionStorage.getItem('ogs_access_token')) {
        document.getElementById('gameMsg').textContent = 'Сначала войдите в OGS.';
        return;
      }
      if (!ogsSocketReady) {
        document.getElementById('gameMsg').textContent = 'Игровое соединение OGS ещё не готово.';
        return;
      }
      const preferences = automatchPreferences();
      activeAutomatchUuid = preferences.uuid;
      wsSend('automatch/find_match', preferences);
      setSearchState(true, `Ищем соперника: ${document.getElementById('size').value}×${document.getElementById('size').value}, ${document.getElementById('speed').selectedOptions[0].text}, бёёми…`);
    }

    function cancelAutomatch() {
      if (!activeAutomatchUuid || !ogsSocketReady) return;
      wsSend('automatch/cancel', { uuid: activeAutomatchUuid });
      activeAutomatchUuid = null;
      setSearchState(false, 'Запрос на отмену поиска отправлен.');
    }

    const authMsg = document.getElementById('authMsg');
    const loginButton = document.getElementById('login');
    const logoutButton = document.getElementById('logout');
    // Верхняя статусная полоса удалена из интерфейса.
    // Оставляем переменную nullable, чтобы OGS-код мог работать без отдельного
    // визуального индикатора подключения в шапке.
    const headerStatus = document.getElementById('status');

    function setLoggedOut(message = 'Не подключено к OGS') {
      loginButton.hidden = false;
      logoutButton.hidden = true;
      if (headerStatus) headerStatus.textContent = 'Локальный режим · OGS не подключён';
      authMsg.textContent = message;
      const findButton = document.getElementById('findOpponent');
      if (findButton) findButton.disabled = true;
    }

    function setLoggedIn(user) {
      loginButton.hidden = true;
      logoutButton.hidden = false;
      const name = user && (user.username || user.name) ? (user.username || user.name) : 'пользователь';
      if (headerStatus) headerStatus.textContent = `OGS · ${name}`;
      authMsg.textContent = `Подключено к OGS как ${name}.`;
      const token = sessionStorage.getItem('ogs_access_token');
      if (token) connectOgsSocket(token).catch(error => {
        document.getElementById('gameMsg').textContent = `OGS API подключён, но игровой сервер недоступен: ${error.message}`;
      });
    }

    async function getOgsUser(accessToken) {
      const response = await fetch(OGS.meUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new Error(`OGS /me/: HTTP ${response.status}`);
      return response.json();
    }

    async function startOgsLogin() {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') {
        authMsg.textContent = 'OAuth нельзя запустить из file://. Разместите эту папку на статическом https:// адресе (например GitHub Pages).';
        return;
      }

      const clientId = OGS_CLIENT_ID;
      const redirectUri = OGS_REDIRECT_URI;
      if (!clientId || clientId === 'PASTE_YOUR_OGS_CLIENT_ID_HERE') {
        authMsg.textContent = 'В коде ещё не указан OGS Client ID.';
        return;
      }

      const verifier = randomUrlSafe(48);
      const challenge = await sha256Base64Url(verifier);
      const state = randomUrlSafe(24);
      sessionStorage.setItem('ogs_pkce_verifier', verifier);
      sessionStorage.setItem('ogs_oauth_state', state);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'read write',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });
      location.href = `${OGS.authUrl}?${params}`;
    }

    async function handleOgsCallback() {
      const params = new URLSearchParams(location.search);
      const error = params.get('error');
      if (error) {
        const description = params.get('error_description') || error;
        cleanOAuthQuery();
        setLoggedOut(`OGS отказал в авторизации: ${description}`);
        return;
      }

      const code = params.get('code');
      if (!code) {
        const token = sessionStorage.getItem('ogs_access_token');
        if (!token) return setLoggedOut('Готово к входу через OGS.');
        try {
          return setLoggedIn(await getOgsUser(token));
        } catch (_) {
          sessionStorage.removeItem('ogs_access_token');
          return setLoggedOut('Сессия OGS закончилась. Войдите снова.');
        }
      }

      const returnedState = params.get('state');
      const expectedState = sessionStorage.getItem('ogs_oauth_state');
      const verifier = sessionStorage.getItem('ogs_pkce_verifier');
      const clientId = OGS_CLIENT_ID;
      const redirectUri = OGS_REDIRECT_URI;

      if (!returnedState || returnedState !== expectedState) {
        cleanOAuthQuery();
        return setLoggedOut('Ошибка OAuth: параметр state не совпал. Попробуйте войти снова.');
      }
      if (!verifier || !clientId || !redirectUri) {
        cleanOAuthQuery();
        return setLoggedOut('Ошибка OAuth: потеряны параметры PKCE. Запустите вход ещё раз.');
      }

      authMsg.textContent = 'Получаю токен OGS…';
      try {
        const response = await fetch(OGS.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.access_token) {
          throw new Error(data.error_description || data.error || `HTTP ${response.status}`);
        }

        sessionStorage.setItem('ogs_access_token', data.access_token);
        if (data.refresh_token) sessionStorage.setItem('ogs_refresh_token', data.refresh_token);
        sessionStorage.removeItem('ogs_pkce_verifier');
        sessionStorage.removeItem('ogs_oauth_state');
        cleanOAuthQuery();
        setLoggedIn(await getOgsUser(data.access_token));
      } catch (error) {
        cleanOAuthQuery();
        setLoggedOut(`Не удалось войти в OGS: ${error.message}`);
      }
    }

    loginButton.addEventListener('click', () => startOgsLogin().catch(error => {
      authMsg.textContent = `Ошибка OAuth: ${error.message}`;
    }));

    logoutButton.addEventListener('click', () => {
      sessionStorage.removeItem('ogs_access_token');
      sessionStorage.removeItem('ogs_refresh_token');
      sessionStorage.removeItem('ogs_pkce_verifier');
      sessionStorage.removeItem('ogs_oauth_state');
      activeAutomatchUuid = null;
      ogsSocketReady = false;
      if (ogsSocket) { try { ogsSocket.close(); } catch (_) {} ogsSocket = null; }
      setLoggedOut('Вы вышли из OGS.');
    });

