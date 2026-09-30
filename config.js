// Central project configuration.
// Cloudflare Worker для сетевых партий.
window.GO_NETWORK_SERVER_URL = 'https://schoolweiqi-go-network.schoolgo-alexeynechaev.workers.dev';

    // ВСТАВЬТЕ СЮДА Client ID вашего OAuth-приложения OGS.
    // Это публичный идентификатор приложения, хранить его в коде безопасно.
    const OGS_CLIENT_ID = 'im40YDLq7YiT6Vz4XTXduG1F1SzHxKD23T9KNJ4l';
    const OGS_REDIRECT_URI = 'https://schoolweiqi.github.io/go-interfaces/';

    const OGS = {
      authUrl: 'https://online-go.com/oauth2/authorize/',
      tokenUrl: 'https://online-go.com/oauth2/token/',
      meUrl: 'https://online-go.com/api/v1/me/',
      configUrl: 'https://online-go.com/api/v1/ui/config',
      websocketUrl: 'wss://wsp.online-go.com'
    };

    // URL развёрнутого Cloudflare Worker. Изменяется в network-config.js без правки index.html.
    const NETWORK_SERVER_URL = (window.GO_NETWORK_SERVER_URL || '').replace(/\/$/, '');
    const NETWORK_RECONNECT_WINDOW_MS = 30 * 60 * 1000;
