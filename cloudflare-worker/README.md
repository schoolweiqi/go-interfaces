# Cloudflare server for Go rooms

Сервер использует Cloudflare Workers + Durable Objects + WebSocket Hibernation. Каждая партия — отдельный Durable Object.

## Развёртывание

1. Установите Node.js 20+ и войдите в Cloudflare:
   `npx wrangler login`
2. В этой папке выполните:
   `npm install`
   `npm run deploy`
3. Wrangler напечатает адрес вида `https://schoolweiqi-go-network.<account>.workers.dev`.
4. Откройте файл `../network-config.js` и вставьте этот адрес в `window.GO_NETWORK_SERVER_URL`.
5. Загрузите обновлённые клиентские файлы на GitHub Pages.

## Поведение комнат

- Создатель получает чёрные, второй игрок — белые.
- Состояние позиции хранится в Durable Object, а не в браузере.
- Ключ игрока сохраняется локально только для переподключения к своей роли.
- При потере сети клиент автоматически переподключается.
- Когда оба игрока отключились, Durable Object ставит alarm на 30 минут. Если никто не вернулся, `storage.deleteAll()` удаляет состояние комнаты.
- Если хотя бы один игрок остаётся подключён, таймер удаления не запускается.

## Безопасность

`ALLOWED_ORIGINS` в `wrangler.jsonc` уже содержит `https://schoolweiqi.github.io`. При смене домена добавьте его туда.
