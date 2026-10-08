// DOM references, UI controls and user interaction wiring.

// Controller for the optional thinking pause before a move.
// It is initialized here so board interaction cannot depend on a separate script file.
window.movePause = (() => {
  let timer = null;

  return {
    enabled: false,
    delaySeconds: 5,
    lockedUntil: 0,

    setEnabled(value) {
      this.enabled = Boolean(value);
      if (!this.enabled) this.clear();
    },

    setDelay(value) {
      const numeric = Number(value);
      this.delaySeconds = Math.max(
        0,
        Math.min(3600, Number.isFinite(numeric) ? Math.round(numeric) : 5)
      );
      if (this.isLocked()) {
        this.lockedUntil = Date.now() + this.delaySeconds * 1000;
        this.scheduleUnlock();
      }
    },

    arm() {
      if (!this.enabled || this.delaySeconds <= 0) {
        this.clear();
        return;
      }
      this.lockedUntil = Date.now() + this.delaySeconds * 1000;
      this.scheduleUnlock();
    },

    clear() {
      this.lockedUntil = 0;
      if (timer) clearTimeout(timer);
      timer = null;
    },

    isLocked() {
      return this.enabled && Date.now() < this.lockedUntil;
    },

    remainingSeconds() {
      if (!this.isLocked()) return 0;
      return Math.max(1, Math.ceil((this.lockedUntil - Date.now()) / 1000));
    },

    scheduleUnlock() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.lockedUntil = 0;
      }, Math.max(0, this.lockedUntil - Date.now()) + 20);
    }
  };
})();

// Sound of placing a Go stone. Synthesized locally with Web Audio so the
// project does not depend on an external audio asset.
window.stoneSound = (() => {
  let context = null;
  let volume = 5;

  function getContext() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
    }
    return context;
  }

  function setVolume(value) {
    const numeric = Number(value);
    volume = Math.max(0, Math.min(10, Number.isFinite(numeric) ? Math.round(numeric) : 5));
    return volume;
  }

  function play() {
    if (volume <= 0) return;

    const ctx = getContext();
    if (!ctx) return;

    const start = () => {
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      const master = Math.pow(volume / 10, 1.35);

      // Short low wooden impact.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(235, now);
      osc.frequency.exponentialRampToValueAtTime(115, now + 0.045);

      const impactGain = ctx.createGain();
      impactGain.gain.setValueAtTime(0.0001, now);
      impactGain.gain.exponentialRampToValueAtTime(0.42 * master, now + 0.002);
      impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

      // A tiny filtered noise transient gives the stone a dry "click".
      const length = Math.max(1, Math.floor(ctx.sampleRate * 0.035));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const envelope = 1 - i / length;
        data[i] = (Math.random() * 2 - 1) * envelope;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1450;
      filter.Q.value = 0.7;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.24 * master, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

      gain.gain.value = 0.9;
      osc.connect(impactGain).connect(gain);
      noise.connect(filter).connect(noiseGain).connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
      noise.start(now);
      noise.stop(now + 0.04);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(start).catch(() => {});
    } else {
      start();
    }
  }

  // Resume audio as soon as the browser receives a genuine user gesture.
  document.addEventListener('pointerdown', () => {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, { once: true, passive: true });

  return {
    get volume() { return volume; },
    setVolume,
    play
  };
})();

    const board = new GoBoard(document.getElementById('board'), 19);
    window.goBoardInstance = board;
    const boardCleanBtn = document.getElementById('boardClean');
    const boardFacesBtn = document.getElementById('boardFaces');
    const boardLinksBtn = document.getElementById('boardLinks');
    const boardInfluenceBtn = document.getElementById('boardInfluence');
    const boardPhantomBtn = document.getElementById('boardPhantom');
    const boardFogBtn = document.getElementById('boardFog');
    const boardPauseBtn = document.getElementById('boardPause');
    const influenceStrengthInput = document.getElementById('influenceStrength');
    const influenceThreeLibFactorInput = document.getElementById('influenceThreeLibFactor');
    const influenceStonePointClampInput = document.getElementById('influenceStonePointClamp');
    const influenceNumbersInput = document.getElementById('influenceNumbers');
    const movePauseSecondsInput = document.getElementById('movePauseSeconds');
    const stoneSoundVolumeInput = document.getElementById('stoneSoundVolume');
    const gameInfoElapsed = document.getElementById('gameInfoElapsed');
    const gameInfoBlack = document.getElementById('gameInfoBlack');
    const gameInfoWhite = document.getElementById('gameInfoWhite');
    const gameInfoBlackName = document.getElementById('gameInfoBlackName');
    const gameInfoWhiteName = document.getElementById('gameInfoWhiteName');
    const gameInfoBlackClock = document.getElementById('gameInfoBlackClock');
    const gameInfoWhiteClock = document.getElementById('gameInfoWhiteClock');
    const gameInfoStatus = document.getElementById('gameInfoStatus');

    boardCleanBtn.addEventListener('click', () => {
      board.setCleanVisible(!board.showClean);
      boardCleanBtn.classList.toggle('active', board.showClean);
    });
    boardFacesBtn.addEventListener('click', () => {
      board.setFacesVisible(!board.showFaces);
      boardFacesBtn.classList.toggle('active', board.showFaces);
    });
    boardLinksBtn.addEventListener('click', () => {
      board.setLinksVisible(!board.showLinks);
      boardLinksBtn.classList.toggle('active', board.showLinks);
    });
    boardInfluenceBtn.addEventListener('click', () => {
      board.setInfluenceVisible(!board.showInfluence);
      boardInfluenceBtn.classList.toggle('active', board.showInfluence);
    });
    boardPhantomBtn.addEventListener('click', () => {
      board.setPhantomVisible(!board.showPhantom);
      boardPhantomBtn.classList.toggle('active', board.showPhantom);
    });
    boardFogBtn.addEventListener('click', () => {
      board.setFogVisible(!board.showFog);
      boardFogBtn.classList.toggle('active', board.showFog);
    });
    boardPauseBtn.addEventListener('click', () => {
      window.movePause.setEnabled(!window.movePause.enabled);
      boardPauseBtn.classList.toggle('active', window.movePause.enabled);
    });
    influenceStrengthInput.addEventListener('input', () => {
      board.setInfluenceStrength(influenceStrengthInput.value);
      influenceStrengthInput.value = String(board.influenceStrength);
    });
    influenceThreeLibFactorInput.addEventListener('input', () => {
      board.setInfluenceThreeLibFactor(influenceThreeLibFactorInput.value);
      influenceThreeLibFactorInput.value = String(board.influenceThreeLibFactor);
    });
    influenceStonePointClampInput.addEventListener('input', () => {
      board.setInfluenceStonePointClamp(influenceStonePointClampInput.value);
      influenceStonePointClampInput.value = String(board.influenceStonePointClamp);
    });
    influenceNumbersInput.addEventListener('change', () => {
      board.setInfluenceNumbersVisible(influenceNumbersInput.checked);
    });
    window.movePause.setDelay(movePauseSecondsInput.value);
    boardPauseBtn.classList.toggle('active', window.movePause.enabled);

    movePauseSecondsInput.addEventListener('input', () => {
      window.movePause.setDelay(movePauseSecondsInput.value);
      movePauseSecondsInput.value = String(window.movePause.delaySeconds);
    });

    window.stoneSound.setVolume(stoneSoundVolumeInput.value);
    stoneSoundVolumeInput.addEventListener('input', () => {
      stoneSoundVolumeInput.value = String(window.stoneSound.setVolume(stoneSoundVolumeInput.value));
    });
    const sizeSelect = document.getElementById('size');
    const gameMsg = document.getElementById('gameMsg');
    const blackCaptures = document.getElementById('blackCaptures');
    const whiteCaptures = document.getElementById('whiteCaptures');
    const turnText = document.getElementById('turnText');
    const turnStone = document.getElementById('turnStone');
    const moveNumber = document.getElementById('moveNumber');
    const loadSgfButton = document.getElementById('loadSgf');
    const downloadSgfButton = document.getElementById('downloadSgf');
    const sgfFileInput = document.getElementById('sgfFileInput');
    const gameTreeSvg = document.getElementById('gameTreeSvg');
    const gameTreeScroller = document.getElementById('gameTreeScroller');
    const deleteVariationBranchButton = document.getElementById('deleteVariationBranch');

    let turn = 1; // 1 = black, 2 = white

    // Дерево вариантов живёт отдельно от линейной board.history.
    // board.history всегда отражает путь от корня до ТЕКУЩЕГО выбранного узла.
    const gameTree = new GameTree({ size: board.size, komi: 6.5, initialTurn: 1 });
    window.goGameTree = gameTree;
    const botEngine = new GnuGoBotEngine();
    const botSizeSelect = document.getElementById('botSize');
    const botLevelSelect = document.getElementById('botLevel');
    const botColorSelect = document.getElementById('botColor');
    const botKomiInput = document.getElementById('botKomi');
    const startBotButton = document.getElementById('startBotGame');
    const stopBotButton = document.getElementById('stopBotGame');
    const botStatus = document.getElementById('botStatus');
    const botScore = document.getElementById('botScore');

    let gameMode = 'local'; // local | bot | network | ogs

    function reviewSessionActive() {
      return Boolean(window.goReview?.state?.roomId);
    }

    function treeNavigationAllowed() {
      return gameMode === 'local' || reviewSessionActive();
    }

    const botGame = {
      active: false,
      ended: false,
      thinking: false,
      humanColor: 1,
      botColor: 2,
      komi: 6.5,
      level: 10,
      seed: 1,
      levelApplied: false,
      moves: [],
      consecutivePasses: 0
    };

    const networkSizeSelect = document.getElementById('networkSize');
    const createNetworkButton = document.getElementById('createNetworkGame');
    const leaveNetworkButton = document.getElementById('leaveNetworkGame');
    const networkStatus = document.getElementById('networkStatus');
    const networkLinkBox = document.getElementById('networkLinkBox');
    const networkGameLink = document.getElementById('networkGameLink');
    const copyNetworkLinkButton = document.getElementById('copyNetworkLink');

    const networkGame = {
      active: false,
      roomId: null,
      token: null,
      color: null,
      socket: null,
      reconnectTimer: null,
      reconnectStartedAt: null,
      manualClose: false,
      connected: false,
      lastState: null
    };

    function currentMoveNumber() {
      // Во время совместного разбора дерево остаётся основным навигатором,
      // даже если до входа в разбор был активен другой игровой режим.
      if (reviewSessionActive()) return gameTree.current.depth;

      // В локальном режиме номер хода определяется выбранным узлом дерева.
      if (gameMode === 'local') return gameTree.current.depth;

      // В партии с GNU Go история пока остаётся линейной.
      if (gameMode === 'bot') return board.history.length;

      // Для OGS номер приходит из подтверждённой сервером последовательности.
      if (gameMode === 'ogs') return Number(ogsGame.moveNumber || board.history.length || 0);

      // Сетевой сервер может прислать готовый счётчик. Если в старом состоянии
      // его нет, показываем доступную длину массива ходов либо 0.
      const state = networkGame.lastState || {};
      if (Number.isFinite(Number(state.moveNumber))) return Number(state.moveNumber);
      if (Array.isArray(state.moves)) return state.moves.length;
      return 0;
    }

    function updateMoveNumber() {
      moveNumber.textContent = String(currentMoveNumber());
    }

    let gameInfoSessionKey = null;
    let gameInfoStartedAt = null;
    let gameInfoStoppedAt = null;

    function gameInfoCurrentSessionKey() {
      if (gameMode === 'bot' && botGame.active) return `bot:${botGame.seed}`;
      if (gameMode === 'ogs' && ogsGame.active) return `ogs:${ogsGame.gameId || 'active'}`;
      if (gameMode === 'network' && networkGame.active) return `network:${networkGame.roomId || 'active'}`;
      return 'local';
    }

    function formatGameElapsed(milliseconds) {
      const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      }
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function renderGameInfo() {
      const sessionKey = gameInfoCurrentSessionKey();
      if (sessionKey !== gameInfoSessionKey) {
        gameInfoSessionKey = sessionKey;
        gameInfoStartedAt = null;
        gameInfoStoppedAt = null;
      }

      const liveGameActive =
        (gameMode === 'bot' && botGame.active) ||
        (gameMode === 'ogs' && ogsGame.active) ||
        (gameMode === 'network' && networkGame.active);
      const localGameHasMoves = gameMode === 'local' && currentMoveNumber() > 0;
      const liveGameFinished =
        (gameMode === 'bot' && botGame.ended) ||
        (gameMode === 'ogs' && ogsGame.phase === 'finished') ||
        (gameMode === 'network' && networkGame.lastState?.status === 'ended');

      if (!gameInfoStartedAt && (liveGameActive || localGameHasMoves)) {
        gameInfoStartedAt = Date.now();
      }
      if (gameInfoStartedAt && liveGameFinished && !gameInfoStoppedAt) {
        gameInfoStoppedAt = Date.now();
      }
      const elapsedEnd = gameInfoStoppedAt || Date.now();
      gameInfoElapsed.textContent = formatGameElapsed(
        gameInfoStartedAt ? elapsedEnd - gameInfoStartedAt : 0
      );

      let blackName = 'Чёрные';
      let whiteName = 'Белые';
      let blackClockText = '';
      let whiteClockText = '';
      let clocksVisible = false;
      let status = turn === 1 ? 'Ход чёрных' : 'Ход белых';

      if (gameMode === 'bot' && botGame.active) {
        blackName = botGame.humanColor === 1 ? 'Вы' : 'GNU Go';
        whiteName = botGame.humanColor === 2 ? 'Вы' : 'GNU Go';
        status = botGame.ended
          ? 'Партия завершена'
          : botGame.thinking
            ? 'GNU Go думает…'
            : turn === botGame.humanColor ? 'Ваш ход' : 'Ход GNU Go';
      } else if (gameMode === 'ogs' && ogsGame.active) {
        blackName = ogsPlayerName(ogsGame.players.black, 'Чёрные');
        whiteName = ogsPlayerName(ogsGame.players.white, 'Белые');
        status = ogsGame.phase === 'stone removal'
          ? 'Подсчёт результата'
          : ogsGame.phase === 'finished'
            ? 'Партия завершена'
            : turn === ogsGame.color ? 'Ваш ход' : 'Ход соперника';

        if (
          ogsGame.clock &&
          typeof currentOgsDisplayClock === 'function' &&
          typeof formatClockPart === 'function'
        ) {
          const display = currentOgsDisplayClock();
          if (display) {
            blackClockText = formatClockPart(display.black);
            whiteClockText = formatClockPart(display.white);
            clocksVisible = true;
          }
        }
      } else if (gameMode === 'network' && networkGame.active) {
        blackName = networkGame.color === 1 ? 'Вы' : networkGame.color === 2 ? 'Соперник' : 'Чёрные';
        whiteName = networkGame.color === 2 ? 'Вы' : networkGame.color === 1 ? 'Соперник' : 'Белые';
        const state = networkGame.lastState;
        status = state?.status === 'ended'
          ? 'Партия завершена'
          : !state
            ? 'Подключение…'
            : turn === networkGame.color ? 'Ваш ход' : 'Ход соперника';
      }

      gameInfoBlackName.textContent = blackName;
      gameInfoWhiteName.textContent = whiteName;
      gameInfoBlackClock.textContent = blackClockText;
      gameInfoWhiteClock.textContent = whiteClockText;
      gameInfoBlackClock.hidden = !clocksVisible;
      gameInfoWhiteClock.hidden = !clocksVisible;
      gameInfoBlack.classList.toggle('is-active', turn === 1);
      gameInfoWhite.classList.toggle('is-active', turn === 2);
      gameInfoStatus.textContent = status;
    }

    function resetGameInfoTimer() {
      gameInfoStartedAt = null;
      gameInfoStoppedAt = null;
      gameInfoSessionKey = gameInfoCurrentSessionKey();
      renderGameInfo();
    }

    window.updateGameInfo = renderGameInfo;
    window.resetGameInfoTimer = resetGameInfoTimer;
    setInterval(renderGameInfo, 1000);

    function currentFogViewerColor() {
      if (gameMode === 'bot' && botGame.active) return botGame.humanColor;
      if (gameMode === 'ogs' && ogsGame.active && (ogsGame.color === 1 || ogsGame.color === 2)) return ogsGame.color;
      if (gameMode === 'network' && networkGame.active && (networkGame.color === 1 || networkGame.color === 2)) {
        return networkGame.color;
      }
      return turn;
    }

    function updateTurn() {
      turnText.textContent = turn === 1 ? 'Ход чёрных' : 'Ход белых';
      turnStone.classList.toggle('white', turn === 2);

      // Фантом всегда показывает предполагаемый ход той стороны,
      // которой принадлежит текущая очередь хода.
      board.setPhantomColor(turn);
      board.setFogViewerColor(currentFogViewerColor());

      updateMoveNumber();
      renderGameInfo();
    }

    function updateCaptures() {
      blackCaptures.textContent = board.captures[1] || 0;
      whiteCaptures.textContent = board.captures[2] || 0;
      updateMoveNumber();
      renderGameInfo();
    }

    function pauseBlocksMove(messageTarget = gameMsg) {
      if (!window.movePause.isLocked()) return false;
      const seconds = window.movePause.remainingSeconds();
      if (messageTarget) messageTarget.textContent = `Пауза перед ходом: подождите ещё ${seconds} сек.`;
      return true;
    }

    function switchTurn() {
      turn = turn === 1 ? 2 : 1;
      updateTurn();
    }

    function refreshJosekiChoices() {
      if (typeof board.setJosekiChoices !== 'function') return;

      if (!window.josekiModeActive || gameMode !== 'local') {
        board.setJosekiChoices([]);
        return;
      }

      const currentMeta = gameTree.current.josekiMeta || {};
      const kogoLabels = Array.isArray(currentMeta.labels) ? currentMeta.labels : [];

      const choices = gameTree.current.children
        .filter(child => child.move && !child.move.pass)
        .map((child, index) => {
          const meta = child.josekiMeta || {};
          const pointLabel = kogoLabels.find(entry =>
            Number(entry.x) === Number(child.move.x) &&
            Number(entry.y) === Number(child.move.y)
          );
          const rawLabel = pointLabel
            ? String(pointLabel.label || '')
            : String(meta.label == null ? '' : meta.label);
          const label = rawLabel && rawLabel !== '_'
            ? rawLabel
            : String(index + 1);

          return {
            x: child.move.x,
            y: child.move.y,
            label,
            category: meta.category || '',
            nodeId: meta.nodeId || null
          };
        });

      board.setJosekiChoices(choices);
    }

    window.refreshJosekiChoices = refreshJosekiChoices;

    function updateGameTreeView() {
      renderGameTree(gameTree, gameTreeSvg, gameTreeScroller);
      deleteVariationBranchButton.disabled = !treeNavigationAllowed() || gameTree.current === gameTree.root;
      refreshJosekiChoices();
    }

    /*
     * Полностью восстанавливаем позицию выбранного узла.
     * Это надёжнее, чем пытаться вручную откатывать захваты между произвольными
     * вариациями: правила Го заново воспроизводят ровно путь root -> current.
     */
    function restoreTreePosition(node) {
      gameTree.select(node);
      const meta = gameTree.meta;

      board.setSize(meta.size);
      board.sgfKomi = meta.komi;
      board.sgfSetup = {
        black: meta.setupBlack.map(p => p.slice()),
        white: meta.setupWhite.map(p => p.slice())
      };

      for (const [x, y] of meta.setupBlack) board.setStone(x, y, 1);
      for (const [x, y] of meta.setupWhite) board.setStone(x, y, 2);
      board.updateFogExploration();

      board.history = [];
      board.lastMove = null;
      board.captures = { 1: 0, 2: 0 };
      board.positionHistory = [board.positionKey()];

      turn = meta.initialTurn;
      const path = gameTree.pathTo(node);

      for (const treeNode of path) {
        const move = treeNode.move;
        if (move.pass) {
          board.playPass(move.color, false);
        } else {
          const result = board.playStone(move.x, move.y, move.color, false);
          if (!result.ok) {
            throw new Error(`Невозможно восстановить ход №${treeNode.depth}: ${result.reason}`);
          }
        }
        turn = move.color === 1 ? 2 : 1;
      }

      board.draw();
      updateTurn();
      updateCaptures();
      updateGameTreeView();
    }

    function resetGameTreeFromBoard(initialTurn = 1) {
      gameTree.reset({
        size: board.size,
        komi: board.sgfKomi,
        initialTurn,
        setupBlack: (board.sgfSetup?.black || []).map(p => p.slice()),
        setupWhite: (board.sgfSetup?.white || []).map(p => p.slice())
      });
      updateGameTreeView();
    }

    function recordLocalTreeMove(move) {
      gameTree.addMove(move);
      updateGameTreeView();
    }

    function normalizeTreeMove(move, fallbackColor = 1) {
      const color = Number(move && move.color) === 2 ? 2 : Number(move && move.color) === 1 ? 1 : fallbackColor;
      const x = Number(move && move.x);
      const y = Number(move && move.y);
      const pass = Boolean(move && move.pass) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0;
      return {
        color,
        pass,
        x: pass ? null : x,
        y: pass ? null : y
      };
    }

    window.resetLiveGameTree = function(meta = {}, moves = []) {
      gameTree.reset({
        size: Number(meta.size) || board.size,
        komi: Number.isFinite(Number(meta.komi)) ? Number(meta.komi) : board.sgfKomi,
        initialTurn: Number(meta.initialTurn) === 2 ? 2 : 1,
        setupBlack: Array.isArray(meta.setupBlack) ? meta.setupBlack : [],
        setupWhite: Array.isArray(meta.setupWhite) ? meta.setupWhite : []
      });

      let nextColor = gameTree.meta.initialTurn;
      for (const rawMove of moves) {
        const move = normalizeTreeMove(rawMove, nextColor);
        gameTree.addMove(move);
        nextColor = move.color === 1 ? 2 : 1;
      }
      updateGameTreeView();
    };

    window.appendLiveGameTreeMove = function(move, fallbackColor = 1) {
      gameTree.addMove(normalizeTreeMove(move, fallbackColor));
      updateGameTreeView();
    };

    board.onIntersection = async (x, y) => {
      board.phantomHover = null;

      if (gameMode === 'ogs') {
        handleOgsBoardClick(x, y);
        return;
      }

      if (pauseBlocksMove(gameMode === 'network' ? networkStatus : gameMsg)) return;

      if (gameMode === 'network') {
        const state = networkGame.lastState;
        if (!networkGame.active || !state || state.status !== 'playing') return;
        if (turn !== networkGame.color) { networkStatus.textContent = 'Сейчас ход соперника.'; return; }
        sendNetworkAction({ type: 'move', x, y });
        return;
      }
      if (gameMode === 'bot') {
        if (!botGame.active || botGame.ended) return;
        if (botGame.thinking) return;
        if (turn !== botGame.humanColor) {
          gameMsg.textContent = 'Сейчас ход GNU Go.';
          return;
        }
        const result = board.playStone(x, y, botGame.humanColor);
        if (!result.ok) {
          const messages = { occupied: 'Пересечение занято.', suicide: 'Самоубийственный ход запрещён.', ko: 'Нельзя немедленно повторить позицию ко.' };
          gameMsg.textContent = messages[result.reason] || 'Этот ход невозможен.';
          return;
        }
        botGame.moves.push({ color: botGame.humanColor, x, y, pass: false });
        window.appendLiveGameTreeMove({ color: botGame.humanColor, x, y, pass: false }, botGame.humanColor);
        botGame.consecutivePasses = 0;
        updateCaptures();
        turn = botGame.botColor;
        updateTurn();
        await requestGnuGoMove();
        return;
      }

      const result = board.playStone(x, y, turn);
      if (!result.ok) {
        const messages = { occupied: 'Пересечение занято.', suicide: 'Самоубийственный ход запрещён.', ko: 'Нельзя немедленно повторить позицию ко.' };
        gameMsg.textContent = messages[result.reason] || 'Этот ход невозможен.';
        return;
      }
      if (result.captured) gameMsg.textContent = `Снято камней: ${result.captured}.`;
      recordLocalTreeMove({ color: turn, pass: false, x, y });
      updateCaptures();
      switchTurn();
      window.movePause.arm();
    };

    sizeSelect.addEventListener('change', () => {
      if (gameMode === 'bot' && botGame.active) {
        gameMsg.textContent = 'Размер текущей партии с GNU Go менять нельзя. Настройка OGS применится к следующему поиску.';
        return;
      }
      board.setSize(Number(sizeSelect.value));
      turn = 1;
      resetGameTreeFromBoard(turn);
      resetGameInfoTimer();
      updateTurn();
      updateCaptures();
      gameMsg.textContent = `Доска изменена на ${sizeSelect.value} × ${sizeSelect.value}.`;
    });

    document.getElementById('newGame').addEventListener('click', () => {
      if (botGame.active) stopBotGame();
      gameMode = 'local';
      board.setSize(Number(sizeSelect.value));
      turn = 1;
      resetGameTreeFromBoard(turn);
      resetGameInfoTimer();
      updateTurn();
      updateCaptures();
      gameMsg.textContent = `Локальная тестовая партия: ${sizeSelect.value} × ${sizeSelect.value}. Снятие групп, запрет самоубийства и простое ко включены.`;
    });

    document.getElementById('findOpponent').addEventListener('click', startAutomatch);
    document.getElementById('cancelSearch').addEventListener('click', cancelAutomatch);


    document.getElementById('pass').addEventListener('click', async () => {
      if (gameMode !== 'ogs' && pauseBlocksMove(gameMode === 'network' ? networkStatus : gameMsg)) return;

      if (gameMode === 'ogs') {
        submitOgsPass();
        return;
      }
      if (gameMode === 'network') {
        const state = networkGame.lastState;
        if (!networkGame.active || !state || state.status !== 'playing') return;
        if (turn !== networkGame.color) { networkStatus.textContent = 'Сейчас ход соперника.'; return; }
        sendNetworkAction({ type: 'pass' });
        return;
      }
      if (gameMode === 'bot') {
        if (!botGame.active || botGame.ended || botGame.thinking) return;
        if (turn !== botGame.humanColor) return;
        applyBotPass(botGame.humanColor);
        window.appendLiveGameTreeMove({ color: botGame.humanColor, pass: true }, botGame.humanColor);
        if (botGame.consecutivePasses >= 2) {
          await finishBotGame();
          return;
        }
        turn = botGame.botColor;
        updateTurn();
        await requestGnuGoMove();
        return;
      }
      const passingColor = turn;
      board.playPass(passingColor);
      recordLocalTreeMove({ color: passingColor, pass: true, x: null, y: null });
      gameMsg.textContent = passingColor === 1 ? 'Чёрные пасуют.' : 'Белые пасуют.';
      switchTurn();
      window.movePause.arm();
    });

    document.getElementById('undo').addEventListener('click', () => {
      if (gameMode === 'ogs') {
        gameMsg.textContent = 'Отмена хода в OGS-партии пока отключена.';
        return;
      }
      if (gameMode === 'network') {
        networkStatus.textContent = 'Отмена хода в сетевой партии отключена.';
        return;
      }
      if (gameMode === 'bot') {
        gameMsg.textContent = 'Отмена хода в партии с GNU Go пока отключена.';
        return;
      }
      if (gameTree.current === gameTree.root) {
        gameMsg.textContent = 'Ходов для отмены нет.';
        return;
      }
      const previous = gameTree.current.parent;
      restoreTreePosition(previous);
      gameMsg.textContent = 'Переход на один ход назад. Ветка сохранена в дереве.';
    });

    /*
     * Загрузка SGF переводит приложение в локальный режим и воспроизводит
     * главную последовательность ходов на нашей игровой модели.
     */
    loadSgfButton.addEventListener('click', () => {
      sgfFileInput.value = '';
      sgfFileInput.click();
    });

    function loadSgfTextIntoGame(text, options = {}) {
      if (botGame.active) stopBotGame();
      if (networkGame.active && typeof leaveNetworkGame === 'function') leaveNetworkGame();
      if (typeof ogsGame !== 'undefined' && ogsGame.active && typeof disconnectOgsGame === 'function') {
        disconnectOgsGame(false);
      }
      gameMode = 'local';
      window.josekiModeActive = Boolean(options.josekiMode);
      if (!window.josekiModeActive && typeof board.setJosekiChoices === 'function') {
        board.setJosekiChoices([]);
      }

      const parsed = parseSgfGameWithVariations(text);
      gameTree.importSgf(parsed);

      // Обычный файл открывается в конце главной вариации. Импортёр джосеки
      // может попросить остановиться на исходной позиции выбранного поддерева.
      let target = gameTree.current;
      if (Number.isFinite(Number(options.focusDepth))) {
        const wantedDepth = Math.max(0, Math.floor(Number(options.focusDepth)));
        target = gameTree.root;
        while (target.depth < wantedDepth && target.children.length) {
          target = target.preferredChild && target.children.includes(target.preferredChild)
            ? target.preferredChild
            : target.children[0];
        }
      }

      restoreTreePosition(target);
      resetGameInfoTimer();

      const sourceName = options.sourceName || 'SGF';
      gameMsg.textContent =
        `${sourceName} загружен. Текущий ход: ${gameTree.current.depth}. Узлов в дереве: ${gameTree.nodes.size}.`;

      return {
        nodeCount: gameTree.nodes.size,
        currentDepth: gameTree.current.depth,
        size: gameTree.meta.size
      };
    }

    window.loadSgfTextIntoGame = loadSgfTextIntoGame;

    sgfFileInput.addEventListener('change', async () => {
      const file = sgfFileInput.files && sgfFileInput.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        loadSgfTextIntoGame(text, { sourceName: `SGF ${file.name}` });
      } catch (error) {
        gameMsg.textContent = `Не удалось загрузить SGF: ${error.message}`;
      }
    });

    downloadSgfButton.addEventListener('click', () => {
      try {
        const sgf = gameMode === 'local'
          ? buildSgfFromGameTree(gameTree)
          : buildSgfFromBoard(board);
        const name = `go-game-${new Date().toISOString().slice(0, 10)}.sgf`;
        downloadSgfFile(name, sgf);
        gameMsg.textContent = gameMode === 'local'
          ? `SGF сохранён вместе с вариациями. Текущий ход: ${gameTree.current.depth}.`
          : `SGF сохранён. Ходов: ${board.history.length}.`;
      } catch (error) {
        gameMsg.textContent = `Не удалось создать SGF: ${error.message}`;
      }
    });

    /*
     * Колесо над доской:
     * вверх — один ход назад;
     * вниз — один ход вперёд по выбранной (preferred) вариации.
     */
    board.canvas.addEventListener('wheel', (event) => {
      if (!treeNavigationAllowed()) return;
      event.preventDefault();

      const before = gameTree.current;
      const target = event.deltaY < 0 ? gameTree.stepBack() : gameTree.stepForward();
      if (target !== before) restoreTreePosition(target);
    }, { passive: false });

    // Клик по узлу дерева сразу переводит доску в соответствующую позицию.
    gameTreeSvg.addEventListener('click', (event) => {
      if (!treeNavigationAllowed()) return;
      const element = event.target.closest('[data-node-id]');
      if (!element) return;
      const node = gameTree.nodes.get(Number(element.dataset.nodeId));
      if (!node) return;
      restoreTreePosition(node);
    });

    deleteVariationBranchButton.addEventListener('click', () => {
      if (!treeNavigationAllowed() || gameTree.current === gameTree.root) return;

      const moveNo = gameTree.current.depth;
      const childCount = gameTree.current.children.length;
      const suffix = childCount ? ' вместе со всеми последующими ходами этой ветки' : '';
      const ok = window.confirm(`Удалить ветку начиная с хода №${moveNo}${suffix}? Это действие нельзя отменить.`);
      if (!ok) return;

      if (gameTree.deleteCurrentBranch()) {
        restoreTreePosition(gameTree.current);
        gameMsg.textContent = `Ветка от хода №${moveNo} удалена.`;
      }
    });

    // Первичное дерево: только корневая позиция.
    updateGameTreeView();

    startBotButton.addEventListener('click', () => startBotGame().catch(error => {
      botStatus.textContent = `Ошибка запуска: ${error.message}`;
      setBotThinking(false);
    }));
    stopBotButton.addEventListener('click', stopBotGame);
