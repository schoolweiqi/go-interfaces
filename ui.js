// DOM references, UI controls and user interaction wiring.

    const board = new GoBoard(document.getElementById('board'), 19);
    window.goBoardInstance = board;
    const boardCleanBtn = document.getElementById('boardClean');
    const boardFacesBtn = document.getElementById('boardFaces');
    const boardLinksBtn = document.getElementById('boardLinks');
    const boardInfluenceBtn = document.getElementById('boardInfluence');
    const boardPhantomBtn = document.getElementById('boardPhantom');
    const boardFogBtn = document.getElementById('boardFog');
    const influenceStrengthInput = document.getElementById('influenceStrength');
    const influenceThreeLibFactorInput = document.getElementById('influenceThreeLibFactor');
    const influenceIntensityInput = document.getElementById('influenceIntensity');
    const influenceRadiusMultiplierInput = document.getElementById('influenceRadiusMultiplier');
    const influenceGradientFalloffInput = document.getElementById('influenceGradientFalloff');
    const influenceStonePointClampInput = document.getElementById('influenceStonePointClamp');
    const influenceNumbersInput = document.getElementById('influenceNumbers');
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsBody = document.getElementById('settingsBody');

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
    settingsToggle.addEventListener('click', () => {
      const opening = settingsBody.hidden;
      settingsBody.hidden = !opening;
      settingsToggle.setAttribute('aria-expanded', String(opening));
      settingsToggle.classList.toggle('active', opening);
    });
    influenceStrengthInput.addEventListener('input', () => {
      board.setInfluenceStrength(influenceStrengthInput.value);
      influenceStrengthInput.value = String(board.influenceStrength);
    });
    influenceThreeLibFactorInput.addEventListener('input', () => {
      board.setInfluenceThreeLibFactor(influenceThreeLibFactorInput.value);
      influenceThreeLibFactorInput.value = String(board.influenceThreeLibFactor);
    });
    influenceIntensityInput.addEventListener('input', () => {
      board.setInfluenceIntensity(influenceIntensityInput.value);
      influenceIntensityInput.value = String(board.influenceIntensity);
    });
    influenceRadiusMultiplierInput.addEventListener('input', () => {
      board.setInfluenceRadiusMultiplier(influenceRadiusMultiplierInput.value);
      influenceRadiusMultiplierInput.value = String(board.influenceRadiusMultiplier);
    });
    influenceGradientFalloffInput.addEventListener('input', () => {
      board.setInfluenceGradientFalloff(influenceGradientFalloffInput.value);
      influenceGradientFalloffInput.value = String(board.influenceGradientFalloff);
    });
    influenceStonePointClampInput.addEventListener('input', () => {
      board.setInfluenceStonePointClamp(influenceStonePointClampInput.value);
      influenceStonePointClampInput.value = String(board.influenceStonePointClamp);
    });
    influenceNumbersInput.addEventListener('change', () => {
      board.setInfluenceNumbersVisible(influenceNumbersInput.checked);
    });
    const sizeSelect = document.getElementById('size');
    const speedSelect = document.getElementById('speed');
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

    let gameMode = 'local'; // local | bot | network
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
      // В локальном режиме номер хода определяется выбранным узлом дерева.
      if (gameMode === 'local') return gameTree.current.depth;

      // В партии с GNU Go история пока остаётся линейной.
      if (gameMode === 'bot') return board.history.length;

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

    function currentFogViewerColor() {
      if (gameMode === 'bot' && botGame.active) return botGame.humanColor;
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
    }

    function updateCaptures() {
      blackCaptures.textContent = board.captures[1] || 0;
      whiteCaptures.textContent = board.captures[2] || 0;
      updateMoveNumber();
    }

    function switchTurn() {
      turn = turn === 1 ? 2 : 1;
      updateTurn();
    }

    function updateGameTreeView() {
      renderGameTree(gameTree, gameTreeSvg, gameTreeScroller);
      deleteVariationBranchButton.disabled = gameMode !== 'local' || gameTree.current === gameTree.root;
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

    board.onIntersection = async (x, y) => {
      board.phantomHover = null;

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
    };

    sizeSelect.addEventListener('change', () => {
      if (gameMode === 'bot' && botGame.active) {
        gameMsg.textContent = 'Размер текущей партии с GNU Go менять нельзя. Настройка OGS применится к следующему поиску.';
        return;
      }
      board.setSize(Number(sizeSelect.value));
      turn = 1;
      resetGameTreeFromBoard(turn);
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
      updateTurn();
      updateCaptures();
      gameMsg.textContent = `Локальная тестовая партия: ${sizeSelect.value} × ${sizeSelect.value}. Снятие групп, запрет самоубийства и простое ко включены.`;
    });

    document.getElementById('findOpponent').addEventListener('click', startAutomatch);
    document.getElementById('cancelSearch').addEventListener('click', cancelAutomatch);


    document.getElementById('pass').addEventListener('click', async () => {
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
    });

    document.getElementById('undo').addEventListener('click', () => {
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

    sgfFileInput.addEventListener('change', async () => {
      const file = sgfFileInput.files && sgfFileInput.files[0];
      if (!file) return;

      try {
        if (botGame.active) stopBotGame();
        if (networkGame.active && typeof leaveNetworkGame === 'function') leaveNetworkGame();
        gameMode = 'local';

        const text = await file.text();
        const parsed = parseSgfGameWithVariations(text);

        // Импортируем ВСЁ дерево SGF. Текущим становится конец главной вариации.
        gameTree.importSgf(parsed);
        restoreTreePosition(gameTree.current);

        gameMsg.textContent = `SGF загружен: ${file.name}. Ходов в текущей линии: ${gameTree.current.depth}.`;
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
      if (gameMode !== 'local') return;
      event.preventDefault();

      const before = gameTree.current;
      const target = event.deltaY < 0 ? gameTree.stepBack() : gameTree.stepForward();
      if (target !== before) restoreTreePosition(target);
    }, { passive: false });

    // Клик по узлу дерева сразу переводит доску в соответствующую позицию.
    gameTreeSvg.addEventListener('click', (event) => {
      if (gameMode !== 'local') return;
      const element = event.target.closest('[data-node-id]');
      if (!element) return;
      const node = gameTree.nodes.get(Number(element.dataset.nodeId));
      if (!node) return;
      restoreTreePosition(node);
    });

    deleteVariationBranchButton.addEventListener('click', () => {
      if (gameMode !== 'local' || gameTree.current === gameTree.root) return;

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
