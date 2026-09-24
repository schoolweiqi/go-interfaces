# Сетевая игра

Cloudflare Worker уже развёрнут и подключён к клиенту.

Worker:
https://schoolweiqi-go-network.schoolgo-alexeynechaev.workers.dev

Клиент использует этот адрес из `network-config.js`.

Для GitHub Pages загрузите содержимое этого архива в корень репозитория. После публикации кнопка «Создать онлайн-партию» будет создавать комнату и ссылку вида `?room=...`.

Если Worker в будущем будет переименован или получит другой адрес, достаточно заменить `window.GO_NETWORK_SERVER_URL` в `network-config.js`.
