// OGS OAuth, automatch and live game integration.
//
// OGS remains the authoritative source of the live game state. Local board
// rendering is updated only from OGS gamedata/move events, never optimistically.

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomUrlSafe(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function cleanOAuthQuery() {
  const url = new URL(location.href);
  ["code", "state", "error", "error_description"].forEach((key) => url.searchParams.delete(key));
  history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}

const authMsg = document.getElementById("authMsg");
const loginButton = document.getElementById("login");
const logoutButton = document.getElementById("logout");
const findButton = document.getElementById("findOpponent");
const ogsBotButton = document.getElementById("challengeOgsBot");
const ogsChallengePlayerUrl = document.getElementById("ogsChallengePlayerUrl");
const cancelButton = document.getElementById("cancelSearch");
const ogsStatus = document.getElementById("ogsStatus");
const ogsGameInfo = document.getElementById("ogsGameInfo");
const ogsClock = document.getElementById("ogsClock");
const ogsStoneRemoval = document.getElementById("ogsStoneRemoval");
const ogsAcceptScoreButton = document.getElementById("ogsAcceptScore");
const ogsResumePlayButton = document.getElementById("ogsResumePlay");
const ogsPlayActions = document.getElementById("ogsPlayActions");
const ogsPassButton = document.getElementById("ogsPass");
const ogsResignButton = document.getElementById("ogsResign");
const ogsResult = document.getElementById("ogsResult");

let ogsSocket = null;
let ogsSocketReady = false;
let activeAutomatchUuid = null;
let lastOgsConfig = null;
let ogsCurrentUser = null;
let ogsReconnectTimer = null;
let ogsReconnectAttempt = 0;

const ogsBotChallenge = {
  active: false,
  challengeId: null,
  gameId: null,
  keepaliveTimer: null,
  playerId: null
};

const ogsGame = {
  active: false,
  gameId: null,
  phase: null,
  playerId: null,
  color: null,
  players: { black: null, white: null },
  moves: [],
  moveNumber: 0,
  nextMoveColor: 1,
  removed: new Set(),
  acceptedByMe: false,
  awaitingMove: false,
  clock: null,
  timeControl: null,
  score: null,
  winner: null,
  outcome: "",
  resultRecord: null
};
window.ogsGame = ogsGame;

function setOgsStatus(message) {
  if (ogsStatus) ogsStatus.textContent = message || "";
}

function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return randomUrlSafe(16) + "-" + Date.now();
}

function wsSend(command, data = {}, id) {
  if (!ogsSocket || ogsSocket.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket OGS ещё не подключён");
  }
  const packet = id === undefined ? [command, data] : [command, data, id];
  ogsSocket.send(JSON.stringify(packet));
}

async function getOgsConfig(accessToken) {
  const response = await fetch(OGS.configUrl, {
    headers: { Authorization: "Bearer " + accessToken }
  });
  if (!response.ok) throw new Error("OGS /ui/config: HTTP " + response.status);
  return response.json();
}

async function getOgsUser(accessToken) {
  const response = await fetch(OGS.meUrl, {
    headers: { Authorization: "Bearer " + accessToken }
  });
  if (!response.ok) throw new Error("OGS /me/: HTTP " + response.status);
  return response.json();
}

function ogsPlayerName(player, fallback) {
  if (!player) return fallback;
  return player.username || player.name || fallback;
}

function ogsColorName(color) {
  if (Number(color) === 1) return "чёрные";
  if (Number(color) === 2) return "белые";
  return "наблюдатель";
}

function ogsCurrentPlayerColorFromClock(clock) {
  if (!clock) return null;
  if (Number(clock.current_player) === Number(clock.black_player_id)) return 1;
  if (Number(clock.current_player) === Number(clock.white_player_id)) return 2;
  return null;
}

function formatClockMs(milliseconds) {
  let ms = Number(milliseconds);
  if (!Number.isFinite(ms)) return "—";
  ms = Math.max(0, ms);

  // Match OGS's display convention: ceil the running second so 9.2 s
  // is shown as 0:10 rather than 0:09.
  let totalSeconds = Math.ceil((ms - 1) / 1000);
  if (ms <= 0) totalSeconds = 0;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function rawOgsThinkingTimeMs(value) {
  if (typeof value === "number") {
    // Simple time is the exception in the OGS wire format: numeric clock
    // values are already milliseconds.
    return Math.max(0, value);
  }
  if (!value || typeof value !== "object") return 0;
  const seconds = Number(value.thinking_time);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
}

function ogsClockElapsedMs(clock) {
  if (!clock || clock.start_mode) return 0;

  const lastMove = Number(clock.last_move);
  if (!Number.isFinite(lastMove) || lastMove <= 0) return 0;

  let effectiveNow = Date.now();

  // If OGS supplied its current server timestamp, use it to compensate for
  // a client computer whose wall clock is slightly off.
  const serverNow = Number(clock.now);
  if (Number.isFinite(serverNow) && serverNow > 0) {
    const receivedAgo = Math.max(0, Date.now() - Number(clock._received_at || Date.now()));
    effectiveNow = serverNow + receivedAgo;
  }

  if (clock.pause && clock.pause.paused) {
    const pausedSince = Number(clock.pause.paused_since || clock.paused_since);
    if (Number.isFinite(pausedSince) && pausedSince > 0) {
      effectiveNow = Math.max(lastMove, pausedSince);
    }
  }

  return Math.max(0, effectiveNow - lastMove);
}

function computeOgsPlayerClock(rawValue, isCurrentPlayer, elapsedMs, timeControl) {
  const tc = timeControl || {};
  const system = String(tc.system || "byoyomi");

  if (typeof rawValue === "number") {
    return {
      main_time: isCurrentPlayer ? Math.max(0, rawValue - elapsedMs) : Math.max(0, rawValue)
    };
  }

  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const baseMainMs = rawOgsThinkingTimeMs(raw);

  if (system === "byoyomi") {
    let mainTime = baseMainMs;
    let overtimeUsage = 0;

    if (isCurrentPlayer) {
      mainTime = baseMainMs - elapsedMs;
      if (mainTime <= 0) {
        overtimeUsage = -mainTime;
        mainTime = 0;
      }
    }

    let periodsLeft = Number(raw.periods);
    if (!Number.isFinite(periodsLeft)) periodsLeft = Number(tc.periods);
    if (!Number.isFinite(periodsLeft)) periodsLeft = 0;

    const periodSeconds = Number(tc.period_time ?? raw.period_time);
    const periodMs = Number.isFinite(periodSeconds) ? Math.max(0, periodSeconds * 1000) : 0;
    let periodTimeLeft = periodMs;

    if (isCurrentPlayer && overtimeUsage > 0 && periodMs > 0) {
      const periodsUsed = Math.floor(overtimeUsage / periodMs);
      periodsLeft -= periodsUsed;
      periodTimeLeft = periodMs - (overtimeUsage - periodsUsed * periodMs);
    }

    return {
      main_time: Math.max(0, mainTime),
      periods_left: Math.max(0, periodsLeft),
      period_time_left: Math.max(0, periodTimeLeft)
    };
  }

  if (system === "canadian") {
    let mainTime = baseMainMs;
    let overtimeUsage = 0;

    if (isCurrentPlayer) {
      mainTime = baseMainMs - elapsedMs;
      if (mainTime <= 0) {
        overtimeUsage = -mainTime;
        mainTime = 0;
      }
    }

    let blockTime = Number(raw.block_time);
    blockTime = Number.isFinite(blockTime) ? blockTime * 1000 : 0;
    if (isCurrentPlayer && overtimeUsage > 0) {
      blockTime = Math.max(0, blockTime - overtimeUsage);
    }

    return {
      main_time: Math.max(0, mainTime),
      moves_left: Number(raw.moves_left) || 0,
      block_time_left: Math.max(0, blockTime)
    };
  }

  // Absolute and Fischer use thinking_time in seconds on the wire.
  return {
    main_time: isCurrentPlayer ? Math.max(0, baseMainMs - elapsedMs) : baseMainMs
  };
}

function currentOgsDisplayClock() {
  const clock = ogsGame.clock;
  if (!clock) return null;

  const activeColor = ogsCurrentPlayerColorFromClock(clock);
  const elapsed = ogsClockElapsedMs(clock);
  const tc = ogsGame.timeControl || {};

  return {
    activeColor,
    black: computeOgsPlayerClock(clock.black_time, activeColor === 1 && !clock.start_mode, elapsed, tc),
    white: computeOgsPlayerClock(clock.white_time, activeColor === 2 && !clock.start_mode, elapsed, tc)
  };
}

function formatClockPart(value) {
  if (!value || typeof value !== "object") return "—";

  const main = Number(value.main_time);
  if (Number.isFinite(main) && main > 0) {
    return formatClockMs(main);
  }

  if (Number.isFinite(Number(value.period_time_left))) {
    const periods = Math.max(0, Number(value.periods_left) || 0);
    return formatClockMs(value.period_time_left) + " · " + periods + " бёёми";
  }

  if (Number.isFinite(Number(value.block_time_left))) {
    const moves = Math.max(0, Number(value.moves_left) || 0);
    return formatClockMs(value.block_time_left) + " / " + moves;
  }

  if (Number.isFinite(main)) return formatClockMs(main);
  return "—";
}

function renderOgsClock() {
  if (!ogsClock) return;
  if (!ogsGame.active || ogsGame.phase !== "play" || !ogsGame.clock) {
    ogsClock.hidden = true;
    return;
  }

  const display = currentOgsDisplayClock();
  if (!display) {
    ogsClock.hidden = true;
    return;
  }

  const black = formatClockPart(display.black);
  const white = formatClockPart(display.white);
  const markerBlack = display.activeColor === 1 ? "▶ " : "";
  const markerWhite = display.activeColor === 2 ? "▶ " : "";

  ogsClock.textContent = markerBlack + "● " + black + "   " + markerWhite + "○ " + white;
  ogsClock.hidden = false;
}

function renderOgsGameInfo() {
  if (!ogsGameInfo) return;
  if (!ogsGame.active || !ogsGame.gameId) {
    ogsGameInfo.hidden = true;
    ogsGameInfo.textContent = "";
    return;
  }

  const black = ogsPlayerName(ogsGame.players.black, "Black");
  const white = ogsPlayerName(ogsGame.players.white, "White");
  const phaseText =
    ogsGame.phase === "stone removal" ? "подсчёт" :
    ogsGame.phase === "finished" ? "завершена" : "игра";

  ogsGameInfo.textContent =
    "Партия #" + ogsGame.gameId +
    " · " + black + " — " + white +
    " · вы: " + ogsColorName(ogsGame.color) +
    " · " + phaseText;
  ogsGameInfo.hidden = false;
}

function renderOgsResult() {
  if (!ogsResult) return;
  if (!ogsGame.active || ogsGame.phase !== "finished") {
    ogsResult.hidden = true;
    return;
  }

  const record = ogsGame.resultRecord || {};
  const blackId = Number(ogsGame.players.black && ogsGame.players.black.id);
  const whiteId = Number(ogsGame.players.white && ogsGame.players.white.id);
  let winner = record.winner !== undefined ? record.winner : ogsGame.winner;
  let winnerColor = null;

  if (winner === "black" || Number(winner) === blackId) winnerColor = 1;
  if (winner === "white" || Number(winner) === whiteId) winnerColor = 2;

  if (!winnerColor) {
    if (record.black_lost === true && record.white_lost === false) winnerColor = 2;
    if (record.white_lost === true && record.black_lost === false) winnerColor = 1;
  }

  const outcome = String(record.outcome || ogsGame.outcome || "").trim();
  let resultText = "Партия завершена.";
  if (winnerColor) resultText = "Победа " + (winnerColor === 1 ? "чёрных" : "белых") + ".";
  if (outcome) resultText += " Результат OGS: " + outcome + ".";

  const score = record.score || ogsGame.score;
  if (score && score.black && score.white) {
    const blackTotal = Number(score.black.total);
    const whiteTotal = Number(score.white.total);
    if (Number.isFinite(blackTotal) && Number.isFinite(whiteTotal)) {
      resultText += " Счёт: ● " + blackTotal + " — ○ " + whiteTotal + ".";
    }
  }

  ogsResult.textContent = resultText;
  ogsResult.hidden = false;
}


function parseOgsPlayerId(value) {
  const text = String(value || "").trim();

  // Primary supported form:
  // https://online-go.com/player/1195520/
  const match = text.match(/^https?:\/\/(?:www\.)?online-go\.com\/player\/(\d+)\/?(?:[?#].*)?$/i);
  if (!match) return null;

  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function buildOgsDirectChallenge() {
  // Keep this independent from OGS "active-bots". Bots can be shown as
  // offline there and still accept direct challenges through the REST API.
  // The same payload also works for a normal OGS player.
  const timeControl = {
    system: "byoyomi",
    speed: "live",
    main_time: 600,
    period_time: 30,
    periods: 5,
    pause_on_weekends: false,
    time_control: "byoyomi"
  };

  return {
    initialized: false,
    challenger_color: "automatic",
    invite_only: false,
    min_ranking: -1000,
    max_ranking: 1000,
    rengo_auto_start: 0,
    game: {
      name: "Friendly Match",
      rules: "japanese",
      ranked: false,
      width: 19,
      height: 19,
      handicap: 0,
      komi_auto: "automatic",
      disable_analysis: false,
      initial_state: null,
      private: false,
      time_control: "byoyomi",
      time_control_parameters: timeControl,
      pause_on_weekends: false,
      rengo: false,
      rengo_casual_mode: true
    }
  };
}

function clearOgsBotChallenge({ disconnect = true } = {}) {
  if (ogsBotChallenge.keepaliveTimer) {
    clearInterval(ogsBotChallenge.keepaliveTimer);
    ogsBotChallenge.keepaliveTimer = null;
  }

  if (disconnect && ogsBotChallenge.gameId && ogsSocketReady) {
    try {
      wsSend("game/disconnect", { game_id: Number(ogsBotChallenge.gameId) });
    } catch (_) {}
  }

  ogsBotChallenge.active = false;
  ogsBotChallenge.challengeId = null;
  ogsBotChallenge.gameId = null;
  ogsBotChallenge.playerId = null;
}

async function startOgsBotChallenge() {
  const token = sessionStorage.getItem("ogs_access_token");
  if (!token || !ogsCurrentUser) {
    setOgsStatus("Сначала подключитесь к OGS.");
    return;
  }
  if (!ogsSocketReady) {
    setOgsStatus("Игровое соединение OGS ещё не готово.");
    return;
  }
  if (activeAutomatchUuid) {
    setOgsStatus("Сначала отмените обычный поиск партии.");
    return;
  }
  if (ogsBotChallenge.active) return;
  if (ogsGame.active && ogsGame.phase !== "finished") {
    setOgsStatus("Сначала завершите текущую OGS-партию.");
    return;
  }

  const playerId = parseOgsPlayerId(ogsChallengePlayerUrl && ogsChallengePlayerUrl.value);
  if (!playerId) {
    setOgsStatus("Вставьте ссылку вида https://online-go.com/player/1195520/");
    if (ogsChallengePlayerUrl) ogsChallengePlayerUrl.focus();
    return;
  }

  if (Number(ogsCurrentUser.id) === playerId) {
    setOgsStatus("Нельзя отправить вызов самому себе.");
    return;
  }

  const challenge = buildOgsDirectChallenge();

  if (typeof botGame !== "undefined" && botGame.active && typeof stopBotGame === "function") {
    stopBotGame();
  }
  if (typeof networkGame !== "undefined" && networkGame.active && typeof leaveNetworkGame === "function") {
    leaveNetworkGame();
  }
  if (ogsGame.active && ogsGame.phase === "finished") disconnectOgsGame(false);

  ogsBotChallenge.active = true;
  ogsBotChallenge.playerId = playerId;
  setOgsStatus("Отправляю вызов игроку OGS #" + playerId + "…");
  refreshOgsControls();

  try {
    const response = await fetch(
      OGS.apiUrl + "players/" + playerId + "/challenge",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(challenge)
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        result.detail ||
        result.message ||
        result.error ||
        ("HTTP " + response.status);
      throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }

    const gameId = Number(
      typeof result.game === "object" && result.game
        ? result.game.id
        : result.game
    );
    const challengeId = Number(result.challenge);

    if (!Number.isFinite(gameId) || gameId <= 0) {
      throw new Error("OGS не вернул game_id для вызова");
    }

    ogsBotChallenge.gameId = gameId;
    ogsBotChallenge.challengeId = Number.isFinite(challengeId) ? challengeId : null;

    // OGS official client keeps a live direct challenge alive once a second
    // and connects to the provisional game immediately. Gamedata means the
    // challenge has been accepted and the real game has started.
    if (ogsBotChallenge.challengeId) {
      ogsBotChallenge.keepaliveTimer = setInterval(() => {
        if (!ogsBotChallenge.active || !ogsSocketReady) return;
        try {
          wsSend("challenge/keepalive", {
            challenge_id: Number(ogsBotChallenge.challengeId),
            game_id: Number(ogsBotChallenge.gameId)
          });
        } catch (_) {}
      }, 1000);
    }

    wsSend("game/connect", { game_id: gameId, chat: false });
    setOgsStatus(
      "Вызов отправлен игроку OGS #" + playerId + ". Ожидаю принятия…"
    );
    refreshOgsControls();
  } catch (error) {
    clearOgsBotChallenge();
    setOgsStatus("Не удалось отправить вызов: " + error.message);
    refreshOgsControls();
  }
}

function refreshOgsControls() {
  const token = sessionStorage.getItem("ogs_access_token");
  const loggedIn = Boolean(token && ogsCurrentUser);
  const searching = Boolean(activeAutomatchUuid);
  const pendingBotChallenge = Boolean(ogsBotChallenge.active);
  const activeLiveGame = Boolean(ogsGame.active && ogsGame.phase && ogsGame.phase !== "finished");

  loginButton.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;

  findButton.hidden = searching;
  cancelButton.hidden = !searching;
  findButton.disabled = !loggedIn || !ogsSocketReady || activeLiveGame || pendingBotChallenge;
  cancelButton.disabled = !ogsSocketReady;

  if (ogsBotButton) {
    ogsBotButton.disabled =
      !loggedIn ||
      !ogsSocketReady ||
      searching ||
      activeLiveGame ||
      pendingBotChallenge;
    ogsBotButton.textContent = pendingBotChallenge ? "Бот…" : "Бот";
    ogsBotButton.title = "Отправить прямой вызов по ссылке OGS";
  }

  if (ogsChallengePlayerUrl) {
    ogsChallengePlayerUrl.disabled = activeLiveGame || pendingBotChallenge;
  }

  const showPlayActions = Boolean(ogsGame.active && ogsGame.phase === "play");
  if (ogsPlayActions) {
    ogsPlayActions.hidden = !showPlayActions;
  }
  if (ogsPassButton) {
    ogsPassButton.disabled =
      !showPlayActions ||
      !ogsSocketReady ||
      ogsGame.awaitingMove ||
      ogsGame.color !== turn;
  }
  if (ogsResignButton) {
    ogsResignButton.disabled = !showPlayActions || !ogsSocketReady;
  }

  if (ogsStoneRemoval) {
    ogsStoneRemoval.hidden = !(ogsGame.active && ogsGame.phase === "stone removal");
  }

  if (ogsAcceptScoreButton) {
    ogsAcceptScoreButton.disabled = !ogsSocketReady || ogsGame.acceptedByMe;
    ogsAcceptScoreButton.textContent = ogsGame.acceptedByMe
      ? "Ожидаем подтверждение соперника"
      : "Подтвердить мёртвые камни";
  }

  if (typeof gameMode !== "undefined" && gameMode === "ogs") {
    const passButton = document.getElementById("pass");
    const undoButton = document.getElementById("undo");
    if (passButton) {
      passButton.disabled =
        ogsGame.phase !== "play" ||
        ogsGame.awaitingMove ||
        ogsGame.color !== turn;
    }
    if (undoButton) undoButton.disabled = true;
  }

  const blockOtherGames = searching || pendingBotChallenge || activeLiveGame;
  const botButton = document.getElementById("startBotGame");
  const networkButton = document.getElementById("createNetworkGame");
  const sgfLoadButton = document.getElementById("loadSgf");
  if (botButton) botButton.disabled = blockOtherGames;
  if (networkButton) networkButton.disabled = blockOtherGames;
  if (sgfLoadButton) sgfLoadButton.disabled = activeLiveGame;

  renderOgsGameInfo();
  renderOgsClock();
  renderOgsResult();
}

function setSearchState(searching, message) {
  if (!searching) activeAutomatchUuid = null;
  if (message) setOgsStatus(message);
  refreshOgsControls();
}

function setLoggedOut(message = "Не подключено к OGS") {
  ogsCurrentUser = null;
  authMsg.textContent = message;
  setOgsStatus("Подключитесь к OGS, чтобы искать партии.");
  refreshOgsControls();
}

function setLoggedIn(user) {
  ogsCurrentUser = user || null;
  const name = user && (user.username || user.name) ? (user.username || user.name) : "пользователь";
  authMsg.textContent = "Подключено как " + name + ".";
  setOgsStatus("Соединяюсь с игровым сервером OGS…");
  refreshOgsControls();

  const token = sessionStorage.getItem("ogs_access_token");
  if (token) {
    connectOgsSocket(token).catch((error) => {
      setOgsStatus("OGS API подключён, но игровой сервер недоступен: " + error.message);
    });
  }
}

function clearOgsReconnect() {
  if (ogsReconnectTimer) clearTimeout(ogsReconnectTimer);
  ogsReconnectTimer = null;
}

function scheduleOgsReconnect() {
  if (!sessionStorage.getItem("ogs_access_token")) return;
  clearOgsReconnect();
  ogsReconnectAttempt += 1;
  const delay = Math.min(10000, 800 + ogsReconnectAttempt * 900);
  setOgsStatus(
    ogsGame.active
      ? "Связь с OGS потеряна. Переподключаю партию…"
      : "Связь с OGS потеряна. Переподключаюсь…"
  );
  ogsReconnectTimer = setTimeout(() => {
    const token = sessionStorage.getItem("ogs_access_token");
    if (!token) return;
    connectOgsSocket(token).catch(() => scheduleOgsReconnect());
  }, delay);
}

function connectCurrentOgsGame() {
  if (!ogsSocketReady || !ogsGame.gameId) return;
  wsSend("game/connect", { game_id: Number(ogsGame.gameId), chat: false });
  setOgsStatus("Подключаю игровую доску к партии #" + ogsGame.gameId + "…");
}

async function connectOgsSocket(accessToken) {
  clearOgsReconnect();
  ogsSocketReady = false;
  refreshOgsControls();

  lastOgsConfig = await getOgsConfig(accessToken);
  const jwt = lastOgsConfig && lastOgsConfig.user_jwt;
  if (!jwt) throw new Error("OGS не вернул user_jwt");

  const previous = ogsSocket;
  const socket = new WebSocket(OGS.websocketUrl);
  ogsSocket = socket;
  if (previous) {
    try { previous.close(); } catch (_) {}
  }

  socket.addEventListener("message", handleOgsSocketMessage);

  socket.addEventListener("open", () => {
    if (ogsSocket !== socket) return;
    try {
      wsSend("authenticate", {
        jwt,
        client: "SchoolWeiqi Go Interfaces",
        client_version: "0.5"
      });
      ogsSocketReady = true;
      ogsReconnectAttempt = 0;
      setOgsStatus("OGS подключён. Можно искать партию.");
      refreshOgsControls();

      const savedGameId = Number(sessionStorage.getItem("ogs_active_game_id"));
      if (!ogsGame.active && Number.isFinite(savedGameId) && savedGameId > 0) {
        beginOgsGame(savedGameId, true);
      } else if (ogsGame.active && ogsGame.gameId) {
        connectCurrentOgsGame();
      }
    } catch (error) {
      setOgsStatus("Ошибка WebSocket OGS: " + error.message);
    }
  });

  socket.addEventListener("close", () => {
    if (ogsSocket !== socket) return;
    ogsSocket = null;
    ogsSocketReady = false;
    refreshOgsControls();
    scheduleOgsReconnect();
  });

  socket.addEventListener("error", () => {
    if (ogsSocket === socket) setOgsStatus("Ошибка соединения с игровым сервером OGS.");
  });
}

function automatchPreferences() {
  return {
    uuid: makeUuid(),
    size_speed_options: [
      { size: "19x19", speed: "live", system: "byoyomi" }
    ],
    lower_rank_diff: 3,
    upper_rank_diff: 3,
    rules: { condition: "required", value: "japanese" },
    handicap: { condition: "required", value: "disabled" },
    timestamp: Date.now()
  };
}

function startAutomatch() {
  if (!sessionStorage.getItem("ogs_access_token")) {
    setOgsStatus("Сначала подключитесь к OGS.");
    return;
  }
  if (!ogsSocketReady) {
    setOgsStatus("Игровое соединение OGS ещё не готово.");
    return;
  }
  if (ogsGame.active && ogsGame.phase !== "finished") {
    setOgsStatus("Сначала завершите текущую OGS-партию.");
    return;
  }

  if (typeof botGame !== "undefined" && botGame.active && typeof stopBotGame === "function") stopBotGame();
  if (typeof networkGame !== "undefined" && networkGame.active && typeof leaveNetworkGame === "function") leaveNetworkGame();

  if (ogsGame.active && ogsGame.phase === "finished") disconnectOgsGame(false);

  const preferences = automatchPreferences();
  activeAutomatchUuid = preferences.uuid;
  wsSend("automatch/find_match", preferences);
  setSearchState(
    true,
    "Ищем соперника: 19×19 · Japanese · Live · byo-yomi."
  );
}

function cancelAutomatch() {
  if (!activeAutomatchUuid || !ogsSocketReady) return;
  wsSend("automatch/cancel", { uuid: activeAutomatchUuid });
  activeAutomatchUuid = null;
  setOgsStatus("Запрос на отмену поиска отправлен.");
  refreshOgsControls();
}

function resetOgsGameState() {
  ogsGame.active = false;
  ogsGame.gameId = null;
  ogsGame.phase = null;
  ogsGame.playerId = null;
  ogsGame.color = null;
  ogsGame.players = { black: null, white: null };
  ogsGame.moves = [];
  ogsGame.moveNumber = 0;
  ogsGame.nextMoveColor = 1;
  ogsGame.removed = new Set();
  ogsGame.acceptedByMe = false;
  ogsGame.awaitingMove = false;
  ogsGame.clock = null;
  ogsGame.timeControl = null;
  ogsGame.score = null;
  ogsGame.winner = null;
  ogsGame.outcome = "";
  ogsGame.resultRecord = null;
  if (typeof board !== "undefined") {
    board.removedStoneKeys = new Set();
    board.draw();
  }
}

function disconnectOgsGame(switchToLocal = true) {
  if (ogsGame.gameId && ogsSocketReady) {
    try { wsSend("game/disconnect", { game_id: Number(ogsGame.gameId) }); } catch (_) {}
  }
  sessionStorage.removeItem("ogs_active_game_id");
  resetOgsGameState();

  if (switchToLocal && typeof gameMode !== "undefined" && gameMode === "ogs") {
    gameMode = "local";
    const undoButton = document.getElementById("undo");
    const passButton = document.getElementById("pass");
    if (undoButton) undoButton.disabled = false;
    if (passButton) passButton.disabled = false;
  }
  refreshOgsControls();
}

function beginOgsGame(gameId, restored = false) {
  const numericId = Number(gameId);
  if (!Number.isFinite(numericId) || numericId <= 0) return;

  if (typeof botGame !== "undefined" && botGame.active && typeof stopBotGame === "function") stopBotGame();
  if (typeof networkGame !== "undefined" && networkGame.active && typeof leaveNetworkGame === "function") leaveNetworkGame();

  if (ogsGame.gameId && ogsGame.gameId !== numericId && ogsSocketReady) {
    try { wsSend("game/disconnect", { game_id: Number(ogsGame.gameId) }); } catch (_) {}
  }

  resetOgsGameState();
  ogsGame.active = true;
  ogsGame.gameId = numericId;
  ogsGame.phase = "play";
  sessionStorage.setItem("ogs_active_game_id", String(numericId));

  gameMode = "ogs";
  board.setSize(19);
  board.sgfKomi = 6.5;
  turn = 1;
  updateTurn();
  updateCaptures();
  document.getElementById("undo").disabled = true;

  setOgsStatus(
    restored
      ? "Восстанавливаю OGS-партию #" + numericId + "…"
      : "Соперник найден. Подключаю партию #" + numericId + " к нашей доске…"
  );
  refreshOgsControls();
  connectCurrentOgsGame();
}

function ogsCharToNum(character) {
  if (character === ".") return -1;
  const code = String(character || "").toLowerCase().charCodeAt(0) - 97;
  return Number.isFinite(code) ? code : -1;
}

function ogsNumToChar(number) {
  const value = Number(number);
  return value < 0 ? "." : String.fromCharCode(97 + value);
}

function encodeOgsMove(x, y) {
  return ogsNumToChar(x) + ogsNumToChar(y);
}

function decodeOgsStringMoves(value) {
  const result = [];
  const text = String(value || "");
  let i = 0;

  while (i < text.length - 1) {
    if (text[i] === "!" && i + 3 < text.length) {
      const color = Number(text[i + 1]);
      result.push({
        x: ogsCharToNum(text[i + 2]),
        y: ogsCharToNum(text[i + 3]),
        color: color === 1 || color === 2 ? color : 0
      });
      i += 4;
      continue;
    }

    result.push({
      x: ogsCharToNum(text[i]),
      y: ogsCharToNum(text[i + 1]),
      color: 0
    });
    i += 2;
  }

  return result;
}

function decodeOgsMoves(value) {
  if (!value) return [];

  if (typeof value === "string") return decodeOgsStringMoves(value);

  if (Array.isArray(value)) {
    if (!value.length) return [];

    if (typeof value[0] === "number") {
      return [{
        x: Number(value[0]),
        y: Number(value[1]),
        color: Number(value[3]) === 1 || Number(value[3]) === 2 ? Number(value[3]) : 0,
        raw: value
      }];
    }

    const result = [];
    for (const item of value) {
      if (Array.isArray(item)) {
        result.push({
          x: Number(item[0]),
          y: Number(item[1]),
          color: Number(item[3]) === 1 || Number(item[3]) === 2 ? Number(item[3]) : 0,
          raw: item
        });
      } else if (item && typeof item === "object" && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) {
        result.push({
          ...item,
          x: Number(item.x),
          y: Number(item.y),
          color: Number(item.color) === 1 || Number(item.color) === 2 ? Number(item.color) : 0
        });
      }
    }
    return result;
  }

  if (typeof value === "object" && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
    return [{
      ...value,
      x: Number(value.x),
      y: Number(value.y),
      color: Number(value.color) === 1 || Number(value.color) === 2 ? Number(value.color) : 0
    }];
  }

  return [];
}

function forceApplyAuthoritativeMove(x, y, color, draw = false) {
  if (x < 0 || y < 0) {
    board.playPass(color, draw);
    return true;
  }
  if (board.getStone(x, y) !== 0) return false;

  const before = board.stones.slice();
  const capturesBefore = { ...board.captures };
  const previousLastMove = board.lastMove ? { ...board.lastMove } : null;
  const fogBefore = {
    1: board.fogExplored[1].slice(),
    2: board.fogExplored[2].slice()
  };

  board.setStone(x, y, color);
  const opponent = color === 1 ? 2 : 1;
  let captured = 0;
  const checked = new Set();

  for (const [nx, ny] of board.neighbors(x, y)) {
    if (board.getStone(nx, ny) !== opponent) continue;
    const key = nx + "," + ny;
    if (checked.has(key)) continue;
    const group = board.groupAt(nx, ny);
    for (const [gx, gy] of group.stones) checked.add(gx + "," + gy);
    if (group.liberties.size === 0) captured += board.removeGroup(group);
  }

  board.captures[color] += captured;
  board.history.push({
    pass: false,
    x,
    y,
    stone: color,
    before,
    capturesBefore,
    captured,
    previousLastMove,
    fogBefore
  });
  board.lastMove = { x, y, stone: color };
  board.positionHistory.push(board.positionKey());
  board.updateFogExploration();
  if (draw) board.draw();
  return true;
}

function applyAuthoritativeOgsMove(move, color, draw = false) {
  if (!move) return false;
  if (move.x < 0 || move.y < 0) {
    board.playPass(color, draw);
    return true;
  }

  const result = board.playStone(move.x, move.y, color, draw);
  if (result.ok) return true;

  // The server has already accepted this move. If our simplified local ko
  // model differs from OGS, apply the server move without local ko rejection.
  return forceApplyAuthoritativeMove(move.x, move.y, color, draw);
}

function inferPlayerColor(data) {
  const playerId = Number(data.player_id || (ogsCurrentUser && ogsCurrentUser.id));
  const black = data.players && data.players.black ? data.players.black : null;
  const white = data.players && data.players.white ? data.players.white : null;
  const blackId = Number((black && black.id) || data.black_player_id);
  const whiteId = Number((white && white.id) || data.white_player_id);

  ogsGame.playerId = Number.isFinite(playerId) ? playerId : null;
  ogsGame.players = { black, white };

  if (Number.isFinite(playerId) && playerId === blackId) return 1;
  if (Number.isFinite(playerId) && playerId === whiteId) return 2;
  return null;
}

function setRemovedKeysFromMoves(moves) {
  const next = new Set();
  for (const move of moves) {
    if (move.x >= 0 && move.y >= 0) next.add(move.x + "," + move.y);
  }
  ogsGame.removed = next;
  board.removedStoneKeys = new Set(next);
  board.draw();
}

function applyOgsGamedata(data) {
  if (!data || typeof data !== "object") return;

  const gameId = Number(data.game_id || ogsGame.gameId);
  if (!Number.isFinite(gameId)) return;

  ogsGame.active = true;
  ogsGame.gameId = gameId;
  ogsGame.phase = data.phase || "play";
  ogsGame.color = inferPlayerColor(data);
  ogsGame.score = data.score || null;
  ogsGame.winner = data.winner !== undefined ? data.winner : null;
  ogsGame.outcome = data.outcome || "";
  ogsGame.clock = data.clock
    ? { ...data.clock, _received_at: Date.now() }
    : ogsGame.clock;
  ogsGame.timeControl = data.time_control || ogsGame.timeControl;
  ogsGame.awaitingMove = false;

  sessionStorage.setItem("ogs_active_game_id", String(gameId));
  gameMode = "ogs";

  const size = Number(data.width || data.height || 19);
  board.setSize(Number.isFinite(size) ? size : 19);
  board.sgfKomi = Number.isFinite(Number(data.komi)) ? Number(data.komi) : 6.5;

  const setupBlack = decodeOgsMoves(data.initial_state && data.initial_state.black);
  const setupWhite = decodeOgsMoves(data.initial_state && data.initial_state.white);
  board.sgfSetup = {
    black: setupBlack.filter((m) => m.x >= 0 && m.y >= 0).map((m) => [m.x, m.y]),
    white: setupWhite.filter((m) => m.x >= 0 && m.y >= 0).map((m) => [m.x, m.y])
  };
  for (const move of setupBlack) if (move.x >= 0 && move.y >= 0) board.setStone(move.x, move.y, 1);
  for (const move of setupWhite) if (move.x >= 0 && move.y >= 0) board.setStone(move.x, move.y, 2);
  board.positionHistory = [board.positionKey()];
  board.updateFogExploration();

  const moves = decodeOgsMoves(data.moves);
  let nextColor = data.initial_player === "white" ? 2 : 1;
  for (const move of moves) {
    const color = move.color === 1 || move.color === 2 ? move.color : nextColor;
    if (!applyAuthoritativeOgsMove(move, color, false)) {
      console.warn("Не удалось восстановить подтверждённый ход OGS", move);
      break;
    }
    nextColor = color === 1 ? 2 : 1;
  }

  ogsGame.moves = moves.slice();
  ogsGame.moveNumber = moves.length;
  ogsGame.nextMoveColor = nextColor;
  turn = nextColor;

  const clockTurn = ogsCurrentPlayerColorFromClock(ogsGame.clock);
  if (clockTurn) turn = clockTurn;

  const removed = decodeOgsMoves(data.removed);
  setRemovedKeysFromMoves(removed);

  board.draw();
  updateTurn();
  updateCaptures();

  if (ogsGame.phase === "stone removal") {
    setOgsStatus("Подсчёт: нажимайте на мёртвые группы, затем подтвердите.");
  } else if (ogsGame.phase === "finished") {
    finishOgsGame(data);
  } else {
    setOgsStatus(
      ogsGame.color === turn
        ? "Ваш ход."
        : "Ход соперника."
    );
  }
  refreshOgsControls();
}

function resyncOgsGame(message) {
  if (message) setOgsStatus(message);
  if (ogsGame.gameId && ogsSocketReady) connectCurrentOgsGame();
}

function applyOgsMoveEvent(data) {
  if (!ogsGame.active || !data || Number(data.game_id) !== Number(ogsGame.gameId)) return;

  const serverMoveNumber = Number(data.move_number);
  if (Number.isFinite(serverMoveNumber)) {
    const expectedMoveNumber = ogsGame.moveNumber + 1;

    // OGS numbers the incoming move itself: after N moves are already on the
    // board, the next event carries move_number = N + 1. The previous code
    // compared it with N and therefore rejected every live move as "missing".
    if (serverMoveNumber <= ogsGame.moveNumber) return;
    if (serverMoveNumber > expectedMoveNumber) {
      resyncOgsGame("Обнаружен пропущенный ход. Синхронизирую позицию с OGS…");
      return;
    }
  }

  const move = decodeOgsMoves(data.move)[0];
  if (!move) {
    resyncOgsGame("Не удалось прочитать ход OGS. Синхронизирую позицию…");
    return;
  }

  // Do not use the UI turn indicator to color an incoming stone.
  // A clock event for the next player can arrive before the move event itself.
  // The authoritative move sequence is the stable source for the stone color.
  const color = move.color === 1 || move.color === 2
    ? move.color
    : ogsGame.nextMoveColor;

  if (color !== 1 && color !== 2) {
    resyncOgsGame("Не удалось определить цвет хода OGS. Синхронизирую позицию…");
    return;
  }

  if (!applyAuthoritativeOgsMove(move, color, false)) {
    resyncOgsGame("Локальная позиция разошлась с OGS. Загружаю состояние сервера…");
    return;
  }

  ogsGame.moves.push(move);
  ogsGame.moveNumber = Number.isFinite(serverMoveNumber)
    ? serverMoveNumber
    : ogsGame.moveNumber + 1;
  ogsGame.awaitingMove = false;
  ogsGame.nextMoveColor = color === 1 ? 2 : 1;

  // The move sequence determines who should play next. A later clock event
  // may confirm the same value and update the visible timer.
  turn = ogsGame.nextMoveColor;

  board.draw();
  updateTurn();
  updateCaptures();

  if (
    (ogsGame.color === 1 || ogsGame.color === 2) &&
    color !== ogsGame.color &&
    turn === ogsGame.color
  ) {
    window.movePause.arm();
  }

  setOgsStatus(
    ogsGame.color === turn
      ? "Ваш ход."
      : "Ход соперника."
  );
  refreshOgsControls();
}

function applyRemovedStonesEvent(data) {
  if (!data || typeof data !== "object" || "strict_seki_mode" in data) return;

  if (typeof data.all_removed === "string") {
    setRemovedKeysFromMoves(decodeOgsMoves(data.all_removed));
  } else {
    const moves = decodeOgsMoves(data.stones);
    for (const move of moves) {
      const key = move.x + "," + move.y;
      if (data.removed) ogsGame.removed.add(key);
      else ogsGame.removed.delete(key);
    }
    board.removedStoneKeys = new Set(ogsGame.removed);
    board.draw();
  }

  ogsGame.acceptedByMe = false;
  setOgsStatus("Список мёртвых камней изменён. Проверьте позицию и подтвердите.");
  refreshOgsControls();
}

function encodeRemovedStoneSet() {
  return [...ogsGame.removed]
    .map((key) => key.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .map(([x, y]) => encodeOgsMove(x, y))
    .join("");
}

function toggleOgsRemovedGroup(x, y) {
  if (ogsGame.phase !== "stone removal") return;
  const stone = board.getStone(x, y);
  if (!stone) {
    setOgsStatus("Для ручного подсчёта выберите камень мёртвой группы.");
    return;
  }

  const group = board.groupAt(x, y);
  if (!group.stones.length) return;

  const keys = group.stones.map(([gx, gy]) => gx + "," + gy);
  const currentlyRemoved = keys.every((key) => ogsGame.removed.has(key));
  const encoded = group.stones.map(([gx, gy]) => encodeOgsMove(gx, gy)).join("");

  wsSend("game/removed_stones/set", {
    game_id: Number(ogsGame.gameId),
    removed: !currentlyRemoved,
    stones: encoded,
    strict_seki_mode: false
  });
}

function handleOgsBoardClick(x, y) {
  if (!ogsGame.active) return;

  if (ogsGame.phase === "stone removal") {
    if (!ogsSocketReady) return;
    toggleOgsRemovedGroup(x, y);
    return;
  }

  if (ogsGame.phase !== "play") return;
  if (window.movePause.isLocked()) {
    setOgsStatus(`Пауза перед ходом: подождите ещё ${window.movePause.remainingSeconds()} сек.`);
    return;
  }
  if (!ogsSocketReady || ogsGame.awaitingMove) return;

  if (ogsGame.color !== turn) {
    setOgsStatus("Сейчас ход соперника.");
    return;
  }

  if (board.getStone(x, y) !== 0) {
    setOgsStatus("Это пересечение занято.");
    return;
  }

  ogsGame.awaitingMove = true;
  setOgsStatus("Отправляю ход на OGS…");
  refreshOgsControls();

  try {
    wsSend("game/move", {
      game_id: Number(ogsGame.gameId),
      move: encodeOgsMove(x, y)
    });
  } catch (error) {
    ogsGame.awaitingMove = false;
    setOgsStatus("Не удалось отправить ход: " + error.message);
    refreshOgsControls();
  }
}

function submitOgsPass() {
  if (!ogsGame.active || ogsGame.phase !== "play") return;
  if (window.movePause.isLocked()) {
    setOgsStatus(`Пауза перед ходом: подождите ещё ${window.movePause.remainingSeconds()} сек.`);
    return;
  }
  if (!ogsSocketReady || ogsGame.awaitingMove) return;
  if (ogsGame.color !== turn) {
    setOgsStatus("Сейчас ход соперника.");
    return;
  }

  ogsGame.awaitingMove = true;
  setOgsStatus("Отправляю пас на OGS…");
  refreshOgsControls();

  try {
    wsSend("game/move", {
      game_id: Number(ogsGame.gameId),
      move: ".."
    });
  } catch (error) {
    ogsGame.awaitingMove = false;
    setOgsStatus("Не удалось отправить пас: " + error.message);
    refreshOgsControls();
  }
}

function acceptOgsRemovedStones() {
  if (!ogsGame.active || ogsGame.phase !== "stone removal" || !ogsSocketReady) return;
  const stones = encodeRemovedStoneSet();
  wsSend("game/removed_stones/accept", {
    game_id: Number(ogsGame.gameId),
    stones,
    strict_seki_mode: false
  });
  ogsGame.acceptedByMe = true;
  setOgsStatus("Ваш вариант подсчёта отправлен. Ожидаем соперника.");
  refreshOgsControls();
}

function resumeOgsPlay() {
  if (!ogsGame.active || ogsGame.phase !== "stone removal" || !ogsSocketReady) return;
  wsSend("game/removed_stones/reject", { game_id: Number(ogsGame.gameId) });
  ogsGame.acceptedByMe = false;
  setOgsStatus("Запрос на продолжение игры отправлен.");
  refreshOgsControls();
}

function resignOgsGame() {
  if (!ogsGame.active || ogsGame.phase !== "play" || !ogsSocketReady) return;
  if (!window.confirm("Сдаться в этой партии OGS?")) return;
  wsSend("game/resign", { game_id: Number(ogsGame.gameId) });
  setOgsStatus("Сдача отправлена на OGS. Ожидаю окончательный результат…");
}

async function fetchOgsResult() {
  if (!ogsGame.gameId) return null;
  const token = sessionStorage.getItem("ogs_access_token");
  const response = await fetch(OGS.gameApiUrl + Number(ogsGame.gameId), {
    headers: token ? { Authorization: "Bearer " + token } : {}
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

function refreshFinishedGameResult(attempt = 0) {
  fetchOgsResult()
    .then((record) => {
      if (!record) return;
      ogsGame.resultRecord = record;
      if (record.outcome) ogsGame.outcome = record.outcome;
      if (record.winner !== undefined) ogsGame.winner = record.winner;
      if (record.score) ogsGame.score = record.score;
      renderOgsResult();

      if (!record.ended && attempt < 5) {
        setTimeout(() => refreshFinishedGameResult(attempt + 1), 1200);
      }
    })
    .catch(() => {
      if (attempt < 5) setTimeout(() => refreshFinishedGameResult(attempt + 1), 1200);
    });
}

function finishOgsGame(data = {}) {
  ogsGame.phase = "finished";
  ogsGame.awaitingMove = false;
  if (data.score) ogsGame.score = data.score;
  if (data.winner !== undefined) ogsGame.winner = data.winner;
  if (data.outcome) ogsGame.outcome = data.outcome;
  sessionStorage.removeItem("ogs_active_game_id");

  setOgsStatus("Партия завершена. Получаю официальный результат OGS…");
  refreshOgsControls();
  renderOgsResult();
  refreshFinishedGameResult(0);
}

function handleOgsGameEvent(type, data) {
  const prefix = "game/" + ogsGame.gameId + "/";
  if (!type.startsWith(prefix)) return false;
  const eventName = type.slice(prefix.length);

  if (eventName === "gamedata") {
    applyOgsGamedata(data);
  } else if (eventName === "move") {
    applyOgsMoveEvent(data);
  } else if (eventName === "clock") {
    ogsGame.clock = data ? { ...data, _received_at: Date.now() } : null;
    const clockTurn = ogsCurrentPlayerColorFromClock(data);
    if (clockTurn && ogsGame.phase === "play") {
      turn = clockTurn;
      updateTurn();
    }
    renderOgsClock();
    refreshOgsControls();
  } else if (eventName === "phase") {
    ogsGame.phase = String(data || "");
    ogsGame.awaitingMove = false;
    if (ogsGame.phase === "stone removal") {
      ogsGame.acceptedByMe = false;
      setOgsStatus("Оба игрока спасовали. Отметьте мёртвые группы.");
    } else if (ogsGame.phase === "play") {
      ogsGame.removed = new Set();
      board.removedStoneKeys = new Set();
      board.draw();
      setOgsStatus(ogsGame.color === turn ? "Ваш ход." : "Ход соперника.");
    } else if (ogsGame.phase === "finished") {
      finishOgsGame();
      return true;
    }
    refreshOgsControls();
  } else if (eventName === "removed_stones") {
    applyRemovedStonesEvent(data);
  } else if (eventName === "removed_stones_accepted") {
    if (data && Number(data.player_id) === Number(ogsGame.playerId)) {
      ogsGame.acceptedByMe = true;
    }
    if (data && data.score) ogsGame.score = data.score;
    if (data && data.winner !== undefined) ogsGame.winner = data.winner;
    if (data && data.outcome) ogsGame.outcome = data.outcome;
    if (data && data.phase === "finished") {
      finishOgsGame(data);
      return true;
    }
    refreshOgsControls();
  } else if (eventName === "error") {
    ogsGame.awaitingMove = false;
    setOgsStatus("OGS: " + (typeof data === "string" ? data : JSON.stringify(data)));
    refreshOgsControls();
  }

  return true;
}

function handleOgsSocketMessage(event) {
  let packet;
  try { packet = JSON.parse(event.data); } catch (_) { return; }
  if (!Array.isArray(packet) || packet.length < 2) return;

  const type = packet[0];
  const data = packet[1] || {};
  if (typeof type !== "string") return;

  if (
    ogsBotChallenge.active &&
    ogsBotChallenge.gameId &&
    type === "game/" + ogsBotChallenge.gameId + "/gamedata"
  ) {
    const acceptedGameId = Number(ogsBotChallenge.gameId);
    clearOgsBotChallenge({ disconnect: false });
    ogsGame.active = true;
    ogsGame.gameId = acceptedGameId;
    sessionStorage.setItem("ogs_active_game_id", String(acceptedGameId));
    setOgsStatus("Вызов принят. Партия начинается.");
    applyOgsGamedata(data);
    return;
  }

  if (
    type === "notification" &&
    ogsBotChallenge.active &&
    data &&
    data.type === "gameOfferRejected" &&
    Number(data.game_id) === Number(ogsBotChallenge.gameId)
  ) {
    const rejection =
      data.message ||
      (data.rejection_details && data.rejection_details.message) ||
      "вызов отклонён";
    clearOgsBotChallenge();
    setOgsStatus("Вызов отклонён: " + rejection);
    refreshOgsControls();
    return;
  }

  if (type === "automatch/entry") {
    activeAutomatchUuid = data.uuid || activeAutomatchUuid;
    setSearchState(true, "OGS ищет подходящего соперника…");
    return;
  }

  if (type === "automatch/cancel") {
    activeAutomatchUuid = null;
    setSearchState(false, "Поиск соперника отменён.");
    return;
  }

  if (type === "automatch/start") {
    activeAutomatchUuid = null;
    refreshOgsControls();
    if (data.game_id) beginOgsGame(data.game_id, false);
    return;
  }

  if (ogsGame.active && ogsGame.gameId) handleOgsGameEvent(type, data);
}

async function startOgsLogin() {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    authMsg.textContent = "OAuth нельзя запустить из file://. Откройте сайт через HTTPS.";
    return;
  }

  const clientId = OGS_CLIENT_ID;
  const redirectUri = OGS_REDIRECT_URI;
  if (!clientId || clientId === "PASTE_YOUR_OGS_CLIENT_ID_HERE") {
    authMsg.textContent = "В коде ещё не указан OGS Client ID.";
    return;
  }

  const verifier = randomUrlSafe(48);
  const challenge = await sha256Base64Url(verifier);
  const state = randomUrlSafe(24);
  sessionStorage.setItem("ogs_pkce_verifier", verifier);
  sessionStorage.setItem("ogs_oauth_state", state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read write",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  location.href = OGS.authUrl + "?" + params;
}

async function handleOgsCallback() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");

  if (error) {
    const description = params.get("error_description") || error;
    cleanOAuthQuery();
    setLoggedOut("OGS отказал в авторизации: " + description);
    return;
  }

  const code = params.get("code");
  if (!code) {
    const token = sessionStorage.getItem("ogs_access_token");
    if (!token) {
      setLoggedOut("Не подключено к OGS.");
      return;
    }

    try {
      setLoggedIn(await getOgsUser(token));
    } catch (_) {
      sessionStorage.removeItem("ogs_access_token");
      sessionStorage.removeItem("ogs_refresh_token");
      setLoggedOut("Сессия OGS закончилась. Подключитесь снова.");
    }
    return;
  }

  const returnedState = params.get("state");
  const expectedState = sessionStorage.getItem("ogs_oauth_state");
  const verifier = sessionStorage.getItem("ogs_pkce_verifier");

  if (!returnedState || returnedState !== expectedState) {
    cleanOAuthQuery();
    setLoggedOut("Ошибка OAuth: параметр state не совпал. Попробуйте снова.");
    return;
  }

  if (!verifier || !OGS_CLIENT_ID || !OGS_REDIRECT_URI) {
    cleanOAuthQuery();
    setLoggedOut("Ошибка OAuth: потеряны параметры PKCE. Запустите вход ещё раз.");
    return;
  }

  authMsg.textContent = "Получаю токен OGS…";

  try {
    const response = await fetch(OGS.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: OGS_REDIRECT_URI,
        client_id: OGS_CLIENT_ID,
        code_verifier: verifier
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || "HTTP " + response.status);
    }

    sessionStorage.setItem("ogs_access_token", data.access_token);
    if (data.refresh_token) sessionStorage.setItem("ogs_refresh_token", data.refresh_token);
    sessionStorage.removeItem("ogs_pkce_verifier");
    sessionStorage.removeItem("ogs_oauth_state");
    cleanOAuthQuery();

    setLoggedIn(await getOgsUser(data.access_token));
  } catch (errorObject) {
    cleanOAuthQuery();
    setLoggedOut("Не удалось войти в OGS: " + errorObject.message);
  }
}

function logoutOgs() {
  activeAutomatchUuid = null;
  clearOgsBotChallenge();
  clearOgsReconnect();

  if (ogsGame.active) disconnectOgsGame(true);

  const socket = ogsSocket;
  ogsSocket = null;
  ogsSocketReady = false;
  if (socket) {
    try { socket.close(); } catch (_) {}
  }

  sessionStorage.removeItem("ogs_access_token");
  sessionStorage.removeItem("ogs_refresh_token");
  sessionStorage.removeItem("ogs_pkce_verifier");
  sessionStorage.removeItem("ogs_oauth_state");
  sessionStorage.removeItem("ogs_active_game_id");

  setLoggedOut("Вы отключились от OGS.");
}

if (ogsChallengePlayerUrl && OGS.defaultChallengePlayerUrl) {
  ogsChallengePlayerUrl.value = OGS.defaultChallengePlayerUrl;
}

loginButton.addEventListener("click", () => {
  startOgsLogin().catch((error) => {
    authMsg.textContent = "Ошибка OAuth: " + error.message;
  });
});
logoutButton.addEventListener("click", logoutOgs);
ogsBotButton.addEventListener("click", () => {
  startOgsBotChallenge().catch((error) => {
    clearOgsBotChallenge();
    setOgsStatus("Не удалось вызвать бота: " + error.message);
    refreshOgsControls();
  });
});
ogsAcceptScoreButton.addEventListener("click", acceptOgsRemovedStones);
ogsResumePlayButton.addEventListener("click", resumeOgsPlay);
ogsPassButton.addEventListener("click", submitOgsPass);
ogsResignButton.addEventListener("click", resignOgsGame);

setInterval(() => {
  if (ogsGame.active && ogsGame.phase === "play") renderOgsClock();
}, 1000);
