// AI engines and GNU Go integration. Extension point for KataGo/remote analysis.

    const GNU_GO_WORKER_URL = 'gnugo-worker.js';

    class GnuGoBotEngine {
      constructor(workerUrl = GNU_GO_WORKER_URL) {
        this.workerUrl = workerUrl;
        this.worker = null;
        this.seq = 1;
        this.pending = new Map();
        this.readyInfo = null;
      }

      async init() {
        if (this.readyInfo) return this.readyInfo;
        if (!this.worker) {
          this.worker = new Worker(this.workerUrl);
          this.worker.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.type === 'ready') this.readyInfo = message;
            if (!message.id) return;
            const item = this.pending.get(message.id);
            if (!item) return;
            this.pending.delete(message.id);
            if (message.ok === false) item.reject(new Error(message.error || 'GNU Go error'));
            else item.resolve(message);
          });
          this.worker.addEventListener('error', (event) => {
            for (const item of this.pending.values()) item.reject(new Error(event.message || 'GNU Go worker error'));
            this.pending.clear();
          });
        }
        const response = await this.request('init', {});
        this.readyInfo = response;
        return response;
      }

      request(type, payload = {}) {
        return new Promise((resolve, reject) => {
          if (!this.worker) return reject(new Error('GNU Go worker not started'));
          const id = this.seq++;
          this.pending.set(id, { resolve, reject });
          this.worker.postMessage({ id, type, ...payload });
        });
      }

      async generateMove(sgf, seed = 0, level = 10) {
        await this.init();
        const response = await this.request('play', { sgf, seed, level });
        return response;
      }

      async score(sgf, seed = 0) {
        await this.init();
        return this.request('score', { sgf, seed });
      }

      terminate() {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.readyInfo = null;
        this.pending.clear();
      }
    }

    function sgfCoord(x, y) {
      return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
    }

    function parseSgfMove(coord, size) {
      if (!coord || (coord.toLowerCase() === 'tt' && size <= 19)) return { pass: true };
      if (!/^[a-z]{2}$/i.test(coord)) throw new Error(`Некорректная SGF-координата GNU Go: ${coord}`);
      const x = coord.toLowerCase().charCodeAt(0) - 97;
      const y = coord.toLowerCase().charCodeAt(1) - 97;
      if (x < 0 || y < 0 || x >= size || y >= size) throw new Error(`GNU Go вернул ход вне доски: ${coord}`);
      return { pass: false, x, y };
    }

    function getLastSgfMove(sgf) {
      const matches = [...String(sgf).matchAll(/;([BW])\[([^\]]*)\]/g)];
      if (!matches.length) return null;
      const last = matches[matches.length - 1];
      return { color: last[1] === 'B' ? 1 : 2, coord: last[2] };
    }


    function colorName(color) { return color === 1 ? 'чёрные' : 'белые'; }

    function createBotSeed() {
      // Наша WASM-обёртка принимает seed как C int, поэтому используем
      // положительный 31-битный диапазон: 1..2147483647.
      // crypto.getRandomValues даёт качественную случайность; fallback нужен
      // только для старых окружений без Web Crypto.
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        const value = new Uint32Array(1);
        globalThis.crypto.getRandomValues(value);
        return (value[0] & 0x7fffffff) || 1;
      }
      return Math.floor(Math.random() * 0x7fffffff) + 1;
    }

    function buildBotSgf() {
      const header = `(;GM[1]FF[4]CA[UTF-8]AP[SchoolWeiqi-GoInterfaces]SZ[${board.size}]KM[${botGame.komi}]RU[Japanese]`;
      const moves = botGame.moves.map(move => `;${move.color === 1 ? 'B' : 'W'}[${move.pass ? '' : sgfCoord(move.x, move.y)}]`).join('');
      return header + moves + ')';
    }

    function setBotThinking(value, message = '') {
      botGame.thinking = value;
      startBotButton.disabled = value;
      document.getElementById('pass').disabled = value;
      if (message) botStatus.textContent = message;
      document.body.classList.toggle('botThinking', value);
    }

    function formatGnuGoScore(value) {
      const score = Number(value);
      if (!Number.isFinite(score) || Math.abs(score) < 0.05) return '0 — дзёго';
      // В GNU Go положительный float означает преимущество белых, отрицательный — чёрных.
      return score > 0 ? `W+${score.toFixed(1)}` : `B+${Math.abs(score).toFixed(1)}`;
    }

    async function finishBotGame(reason = 'Два последовательных паса.') {
      if (!botGame.active || botGame.ended) return;
      botGame.ended = true;
      setBotThinking(true, `${reason} GNU Go считает результат…`);
      try {
        const result = await botEngine.score(buildBotSgf(), botGame.seed);
        const label = formatGnuGoScore(result.score);
        botScore.hidden = false;
        botScore.innerHTML = `<b>Результат GNU Go: ${label}</b><br>${result.exact ? 'Финальный подсчёт GNU Go.' : 'Подсчёт выполнен экспортированной функцией score() браузерной сборки GNU Go.'}`;
        botStatus.textContent = `Партия закончена. ${label}`;
        gameMsg.textContent = `Партия с GNU Go закончена: ${label}.`;
      } catch (error) {
        botStatus.textContent = `Не удалось посчитать результат: ${error.message}`;
      } finally {
        setBotThinking(false);
      }
    }

    function applyBotPass(color) {
      botGame.moves.push({ color, pass: true });
      botGame.consecutivePasses += 1;
      gameMsg.textContent = `${colorName(color)} пасуют.`;
    }

    function applyBotBoardMove(color, x, y) {
      const result = board.playStone(x, y, color);
      if (!result.ok) throw new Error(`Расхождение правил: GNU Go выбрал недопустимый ход ${sgfCoord(x, y)} (${result.reason})`);
      botGame.moves.push({ color, x, y, pass: false });
      botGame.consecutivePasses = 0;
      updateCaptures();
      return result;
    }

    async function requestGnuGoMove() {
      if (!botGame.active || botGame.ended || turn !== botGame.botColor) return;
      setBotThinking(true, 'GNU Go думает…');
      try {
        const beforeCount = botGame.moves.length;
        const moveResponse = await botEngine.generateMove(buildBotSgf(), botGame.seed, botGame.level);
        const outputSgf = moveResponse.sgf;
        botGame.levelApplied = moveResponse.levelApplied === true;
        botGame.appliedLevel = Number.isFinite(Number(moveResponse.appliedLevel))
          ? Number(moveResponse.appliedLevel)
          : 10;
        const last = getLastSgfMove(outputSgf);
        if (!last) throw new Error('GNU Go не вернул ход');
        if (last.color !== botGame.botColor) throw new Error('GNU Go вернул ход не того цвета');
        // play() возвращает исходную SGF + один новый ход. Проверяем хотя бы последний ход.
        const parsed = parseSgfMove(last.coord, board.size);
        if (parsed.pass) {
          applyBotPass(botGame.botColor);
        } else {
          applyBotBoardMove(botGame.botColor, parsed.x, parsed.y);
          gameMsg.textContent = `GNU Go сыграл ${sgfCoord(parsed.x, parsed.y)}.`;
        }
        if (botGame.moves.length !== beforeCount + 1) throw new Error('Не удалось синхронизировать историю ходов GNU Go');

        if (botGame.consecutivePasses >= 2) {
          await finishBotGame();
          return;
        }
        turn = botGame.humanColor;
        updateTurn();
        movePause.arm();
        botStatus.textContent = botGame.levelApplied
          ? `Ваш ход (${colorName(botGame.humanColor)}). GNU Go реально играет на уровне ${botGame.appliedLevel}.`
          : `Ваш ход (${colorName(botGame.humanColor)}). Запрошен уровень ${botGame.level}, фактически ${botGame.appliedLevel}.`;
      } catch (error) {
        botStatus.textContent = `Ошибка GNU Go: ${error.message}`;
        gameMsg.textContent = `Ошибка GNU Go: ${error.message}`;
      } finally {
        setBotThinking(false);
      }
    }

    async function startBotGame() {
      gameMode = 'bot';
      botGame.active = true;
      botGame.ended = false;
      botGame.thinking = false;
      botGame.moves = [];
      botGame.consecutivePasses = 0;
      botGame.humanColor = Number(botColorSelect.value);
      botGame.botColor = botGame.humanColor === 1 ? 2 : 1;
      botGame.komi = Number(botKomiInput.value);
      if (!Number.isFinite(botGame.komi)) botGame.komi = 6.5;
      botGame.level = Math.max(0, Math.min(10, Number(botLevelSelect.value) || 0));
      botGame.seed = createBotSeed();
      botGame.levelApplied = false;
      botGame.appliedLevel = 10;
      board.setSize(Number(botSizeSelect.value));
      turn = 1;
      updateTurn();
      updateCaptures();
      botScore.hidden = true;
      stopBotButton.hidden = false;
      startBotButton.hidden = true;
      document.getElementById('undo').disabled = true;
      setBotThinking(true, 'Загружаю GNU Go WebAssembly…');
      try {
        const info = await botEngine.init();
        const levelText = info.levelSupported ? `уровень ${botGame.level}` : 'уровень 10 (ограничение текущей web-сборки)';
        botStatus.textContent = `GNU Go ${info.version || ''} готов · ${levelText}. ${botGame.humanColor === 1 ? 'Ваш ход.' : 'GNU Go делает первый ход…'}`;
        gameMsg.textContent = `Партия с GNU Go: вы играете ${colorName(botGame.humanColor)}, коми ${botGame.komi}, выбран уровень ${botGame.level}.`;
      } catch (error) {
        botGame.active = false;
        gameMode = 'local';
        startBotButton.hidden = false;
        stopBotButton.hidden = true;
        document.getElementById('undo').disabled = false;
        botStatus.textContent = `Не удалось загрузить GNU Go: ${error.message}`;
        setBotThinking(false);
        return;
      }
      setBotThinking(false);
      if (botGame.botColor === 1) await requestGnuGoMove();
    }

    function stopBotGame() {
      botGame.active = false;
      botGame.ended = true;
      botGame.thinking = false;
      gameMode = 'local';
      startBotButton.hidden = false;
      stopBotButton.hidden = true;
      startBotButton.disabled = false;
      document.getElementById('undo').disabled = false;
      document.getElementById('pass').disabled = false;
      botStatus.textContent = 'Игра с GNU Go остановлена.';
    }
