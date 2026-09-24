import { DurableObject } from "cloudflare:workers";

const ROOM_TTL_MS = 30 * 60 * 1000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  return !origin || allowed.includes(origin) ? origin || "*" : null;
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function roomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
}

function token() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const size = Number(body.size);
      if (![9, 13, 19].includes(size)) return json({ error: "Недопустимый размер доски" }, 400, cors(origin));
      const id = roomId();
      const creatorToken = token();
      const stub = env.GAME_ROOMS.getByName(id);
      const response = await stub.fetch(new Request("https://room.internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: id, size, creatorToken })
      }));
      if (!response.ok) return json({ error: "Не удалось создать комнату" }, 500, cors(origin));
      return json({ roomId: id, playerToken: creatorToken, color: 1, size }, 201, cors(origin));
    }

    if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
      const id = parts[2].toUpperCase();
      const stub = env.GAME_ROOMS.getByName(id);

      if (parts[3] === "join" && request.method === "POST") {
        const response = await stub.fetch(new Request("https://room.internal/join", { method: "POST" }));
        return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors(origin) } });
      }

      if (parts[3] === "ws") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "Expected WebSocket" }, 426, cors(origin));
        const internal = new URL("https://room.internal/ws");
        internal.searchParams.set("token", url.searchParams.get("token") || "");
        return stub.fetch(new Request(internal, request));
      }

      if (request.method === "GET" && parts.length === 3) {
        const response = await stub.fetch(new Request("https://room.internal/state"));
        return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors(origin) } });
      }
    }

    return json({ ok: true, service: "SchoolWeiqi Go network server" }, 200, cors(origin));
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") return this.init(request);
    if (url.pathname === "/join" && request.method === "POST") return this.join();
    if (url.pathname === "/state") return this.getStateResponse();
    if (url.pathname === "/ws") return this.openWebSocket(url);
    return json({ error: "Not found" }, 404);
  }

  initialState(roomId, size, creatorToken) {
    const board = Array(size * size).fill(0);
    return {
      roomId, size, board, turn: 1,
      captures: { black: 0, white: 0 },
      blackToken: creatorToken,
      whiteToken: null,
      consecutivePasses: 0,
      status: "playing",
      lastMove: null,
      positionHistory: [board.join("")],
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  async init(request) {
    const existing = await this.ctx.storage.get("state");
    if (existing) return json({ error: "Room already exists" }, 409);
    const { roomId, size, creatorToken } = await request.json();
    const state = this.initialState(roomId, size, creatorToken);
    await this.ctx.storage.put("state", state);
    return json({ ok: true });
  }

  async join() {
    const state = await this.ctx.storage.get("state");
    if (!state) return json({ error: "Комната не найдена или уже удалена" }, 404);
    if (state.status === "expired") return json({ error: "Комната удалена" }, 410);
    if (!state.whiteToken) {
      state.whiteToken = token();
      state.updatedAt = Date.now();
      await this.ctx.storage.put("state", state);
      return json({ playerToken: state.whiteToken, color: 2, size: state.size });
    }
    return json({ error: "В комнате уже два игрока" }, 409);
  }

  publicState(state) {
    const presence = { black: false, white: false };
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment();
        if (a?.color === 1) presence.black = true;
        if (a?.color === 2) presence.white = true;
      } catch (_) {}
    }
    return {
      roomId: state.roomId,
      size: state.size,
      board: state.board,
      turn: state.turn,
      captures: state.captures,
      consecutivePasses: state.consecutivePasses,
      status: state.status,
      lastMove: state.lastMove,
      presence
    };
  }

  async getStateResponse() {
    const state = await this.ctx.storage.get("state");
    if (!state) return json({ error: "Комната не найдена" }, 404);
    return json(this.publicState(state));
  }

  async openWebSocket(url) {
    const state = await this.ctx.storage.get("state");
    if (!state) return json({ error: "Комната не найдена или уже удалена" }, 404);
    const supplied = url.searchParams.get("token") || "";
    let color = null;
    if (supplied === state.blackToken) color = 1;
    if (supplied === state.whiteToken) color = 2;
    if (!color) return json({ error: "Недействительный ключ игрока" }, 403);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token: supplied, color });
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete("emptySince");
    server.send(JSON.stringify({ type: "hello", color, state: this.publicState(state) }));
    this.broadcastState(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    let data;
    try { data = JSON.parse(message); } catch (_) { return this.sendError(ws, "Некорректное сообщение"); }
    const attachment = ws.deserializeAttachment();
    const state = await this.ctx.storage.get("state");
    if (!state) return this.sendError(ws, "Комната удалена");
    if (state.status !== "playing") return this.sendError(ws, "Партия уже завершена");
    const color = attachment?.color;
    if (color !== 1 && color !== 2) return this.sendError(ws, "Неизвестный игрок");
    if (state.turn !== color) return this.sendError(ws, "Сейчас ход соперника");

    if (data.type === "move") {
      const result = this.applyMove(state, Number(data.x), Number(data.y), color);
      if (!result.ok) return this.sendError(ws, result.error);
    } else if (data.type === "pass") {
      state.consecutivePasses += 1;
      state.lastMove = { pass: true, color };
      if (state.consecutivePasses >= 2) state.status = "ended";
      else state.turn = color === 1 ? 2 : 1;
    } else {
      return this.sendError(ws, "Неизвестная команда");
    }

    state.updatedAt = Date.now();
    await this.ctx.storage.put("state", state);
    this.broadcastState(state);
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (_) {}
    await this.scheduleCleanup(ws);
    const state = await this.ctx.storage.get("state");
    if (state) this.broadcastState(state, ws);
  }

  async webSocketError(ws) {
    await this.scheduleCleanup(ws);
  }

  async scheduleCleanup(excludeWs = null) {
    const others = this.ctx.getWebSockets().filter(ws => ws !== excludeWs && ws.readyState === 1);
    if (others.length > 0) return;
    const emptySince = Date.now();
    await this.ctx.storage.put("emptySince", emptySince);
    await this.ctx.storage.setAlarm(emptySince + ROOM_TTL_MS);
  }

  async alarm() {
    const active = this.ctx.getWebSockets().filter(ws => ws.readyState === 1);
    if (active.length > 0) {
      await this.ctx.storage.delete("emptySince");
      return;
    }
    const emptySince = await this.ctx.storage.get("emptySince");
    if (!emptySince) return;
    const remaining = ROOM_TTL_MS - (Date.now() - Number(emptySince));
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + remaining);
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  broadcastState(state, excludeWs = null) {
    const payload = JSON.stringify({ type: "state", state: this.publicState(state) });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs || ws.readyState !== 1) continue;
      try { ws.send(payload); } catch (_) {}
    }
  }

  sendError(ws, error) {
    try { ws.send(JSON.stringify({ type: "error", error })); } catch (_) {}
  }

  index(state, x, y) { return y * state.size + x; }
  neighbors(state, x, y) {
    const out = [];
    if (x > 0) out.push([x - 1, y]);
    if (x + 1 < state.size) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]);
    if (y + 1 < state.size) out.push([x, y + 1]);
    return out;
  }
  groupAt(state, board, x, y) {
    const color = board[this.index(state, x, y)];
    if (!color) return { stones: [], liberties: new Set() };
    const todo = [[x, y]], seen = new Set([`${x},${y}`]), stones = [], liberties = new Set();
    while (todo.length) {
      const [cx, cy] = todo.pop();
      stones.push([cx, cy]);
      for (const [nx, ny] of this.neighbors(state, cx, cy)) {
        const v = board[this.index(state, nx, ny)];
        if (v === 0) liberties.add(`${nx},${ny}`);
        else if (v === color) {
          const key = `${nx},${ny}`;
          if (!seen.has(key)) { seen.add(key); todo.push([nx, ny]); }
        }
      }
    }
    return { stones, liberties };
  }
  removeGroup(state, board, group) {
    for (const [x, y] of group.stones) board[this.index(state, x, y)] = 0;
    return group.stones.length;
  }

  applyMove(state, x, y, color) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.size || y >= state.size) return { ok: false, error: "Ход вне доски" };
    const idx = this.index(state, x, y);
    if (state.board[idx] !== 0) return { ok: false, error: "Пересечение занято" };
    const before = state.board.slice();
    state.board[idx] = color;
    const opponent = color === 1 ? 2 : 1;
    let captured = 0;
    const checked = new Set();
    for (const [nx, ny] of this.neighbors(state, x, y)) {
      if (state.board[this.index(state, nx, ny)] !== opponent) continue;
      const key = `${nx},${ny}`;
      if (checked.has(key)) continue;
      const group = this.groupAt(state, state.board, nx, ny);
      for (const [gx, gy] of group.stones) checked.add(`${gx},${gy}`);
      if (group.liberties.size === 0) captured += this.removeGroup(state, state.board, group);
    }
    if (this.groupAt(state, state.board, x, y).liberties.size === 0) {
      state.board = before;
      return { ok: false, error: "Самоубийственный ход запрещён" };
    }
    const afterKey = state.board.join("");
    const ph = state.positionHistory || [];
    if (ph.length >= 2 && afterKey === ph[ph.length - 2]) {
      state.board = before;
      return { ok: false, error: "Нельзя немедленно повторить позицию ко" };
    }
    if (color === 1) state.captures.black += captured;
    else state.captures.white += captured;
    state.positionHistory = [...ph, afterKey].slice(-4);
    state.consecutivePasses = 0;
    state.lastMove = { x, y, color, pass: false };
    state.turn = opponent;
    return { ok: true };
  }
}
