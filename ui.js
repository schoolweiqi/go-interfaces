// DOM references, UI controls and user interaction wiring.

    const board = new GoBoard(document.getElementById('board'), 19);
    window.goBoardInstance = board;
    const boardCleanBtn = document.getElementById('boardClean');
    const boardFacesBtn = document.getElementById('boardFaces');
    const boardLinksBtn = document.getElementById('boardLinks');
    const boardInfluenceBtn = document.getElementById('boardInfluence');
    const influenceStrengthInput = document.getElementById('influenceStrength');
    const influenceThreeLibFactorInput = document.getElementById('influenceThreeLibFactor');
    const influenceIntensityInput = document.getElementById('influenceIntensity');
    const influenceRadiusMultiplierInput = document.getElementById('influenceRadiusMultiplier');
    const influenceGradientFalloffInput = document.getElementById('influenceGradientFalloff');
    const influenceStonePointClampInput = document.getElementById('influenceStonePointClamp');
    const influenceNumbersInput = document.getElementById('influenceNumbers');
    const linkThicknessInput = document.getElementById('linkThickness');
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
    settingsToggle.addEventListener('click', () => {
      const opening = settingsBody.hidden;
      settingsBody.hidden = !opening;
      settingsToggle.setAttribute('aria-expanded', String(opening));
      settingsToggle.classList.toggle('active', opening);
    });
    linkThicknessInput.addEventListener('input', () => {
      board.setLinkThickness(linkThicknessInput.value);
      linkThicknessInput.value = String(Number(board.linkThickness.toFixed(2)));
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

    let turn = 1; // 1 = black, 2 = white
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
      // В локальной партии и партии с GNU Go вся последовательность, включая пас,
      // хранится непосредственно в board.history.
      if (gameMode !== 'network') return board.history.length;

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

    function updateTurn() {
      turnText.textContent = turn === 1 ? 'Ход чёрных' : 'Ход белых';
      turnStone.classList.toggle('white', turn === 2);
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

    board.onIntersection = async (x, y) => {
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
      updateTurn();
      updateCaptures();
      gameMsg.textContent = `Доска изменена на ${sizeSelect.value} × ${sizeSelect.value}.`;
    });

    document.getElementById('newGame').addEventListener('click', () => {
      if (botGame.active) stopBotGame();
      gameMode = 'local';
      board.setSize(Number(sizeSelect.value));
      turn = 1;
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
      const undone = board.undo();
      if (!undone) {
        gameMsg.textContent = 'Ходов для отмены нет.';
        return;
      }
      turn = undone.stone;
      updateTurn();
      updateCaptures();
      gameMsg.textContent = undone.pass
        ? 'Последний пас отменён.'
        : 'Последний ход отменён вместе со снятыми камнями.';
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
        const parsed = parseSgfGame(text);

        board.setSize(parsed.size);
        board.sgfKomi = parsed.komi;
        board.sgfSetup = {
          black: parsed.setupBlack.map(p => [p.x, p.y]),
          white: parsed.setupWhite.map(p => [p.x, p.y])
        };

        // Сначала устанавливаем handicap/setup-камни из AB/AW.
        for (const p of parsed.setupBlack) board.setStone(p.x, p.y, 1);
        for (const p of parsed.setupWhite) board.setStone(p.x, p.y, 2);

        // Setup — это исходная позиция, а не игровые ходы.
        board.history = [];
        board.lastMove = null;
        board.captures = { 1: 0, 2: 0 };
        board.positionHistory = [board.positionKey()];

        turn = parsed.initialTurn;

        // Воспроизводим основную ветку SGF и одновременно получаем корректные
        // захваты, ko-history, номер хода и возможность отмены.
        for (const move of parsed.moves) {
          if (move.pass) {
            board.playPass(move.color);
          } else {
            const result = board.playStone(move.x, move.y, move.color);
            if (!result.ok) {
              throw new Error(`Недопустимый ход №${board.history.length + 1} в SGF: ${result.reason}`);
            }
          }
          turn = move.color === 1 ? 2 : 1;
        }

        board.draw();
        updateTurn();
        updateCaptures();
        gameMsg.textContent = `SGF загружен: ${file.name}. Ходов: ${board.history.length}.`;
      } catch (error) {
        gameMsg.textContent = `Не удалось загрузить SGF: ${error.message}`;
      }
    });

    downloadSgfButton.addEventListener('click', () => {
      try {
        const sgf = buildSgfFromBoard(board);
        const name = `go-game-${new Date().toISOString().slice(0, 10)}.sgf`;
        downloadSgfFile(name, sgf);
        gameMsg.textContent = `SGF сохранён. Ходов: ${board.history.length}.`;
      } catch (error) {
        gameMsg.textContent = `Не удалось создать SGF: ${error.message}`;
      }
    });

    startBotButton.addEventListener('click', () => startBotGame().catch(error => {
      botStatus.textContent = `Ошибка запуска: ${error.message}`;
      setBotThinking(false);
    }));
    stopBotButton.addEventListener('click', stopBotGame);
