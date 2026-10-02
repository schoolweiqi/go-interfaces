// Core Go rules and mutable board state.

class GoBoard {
  constructor(canvas, size = 19) {
          this.canvas = canvas;
          this.ctx = canvas.getContext('2d');
          this.size = size;
          this.stones = [];
          this.history = [];
          this.lastMove = null;
          this.removedStoneKeys = new Set();
          this.onIntersection = null;
          this.showClean = false;
          this.showFaces = false;
          this.showLinks = false;
          this.showInfluence = false;
          this.showInfluenceNumbers = false;
          this.showFog = false;
          this.fogViewerColor = 1;
          this.fogExplored = { 1: new Uint8Array(0), 2: new Uint8Array(0) };

          // Режим "фантом" показывает результат предполагаемого следующего хода
          // при наведении мыши. Эти поля не входят в игровую историю.
          this.showPhantom = false;
          this.phantomHover = null;
          this.phantomColor = 1;
          this.influenceStrength = 4;
          this.influenceThreeLibFactor = 0.8;
          this.influenceIntensity = 180;
          // В новой визуализации Radius multiplier задаёт силу дополнительного
          // сглаживания уже единого поля. Отдельных радиальных пятен больше нет.
          this.influenceRadiusMultiplier = 2;
  
          // Gradient falloff управляет нелинейностью прозрачности:
          // чем меньше значение, тем быстрее слабое влияние становится заметным.
          this.influenceGradientFalloff = 0.8;
          this.influenceStonePointClamp = 0.5;
          this.linkThickness = 1;
          this.setSize(size);
  
          canvas.addEventListener('click', (event) => this.handleClick(event));
          canvas.addEventListener('mousemove', (event) => this.handlePhantomPointerMove(event));
          canvas.addEventListener('mouseleave', () => this.clearPhantomHover());
          window.addEventListener('resize', () => this.draw());
        }

  setSize(size) {
          this.size = Number(size);
          this.stones = Array(this.size * this.size).fill(0);
          this.history = [];
          this.lastMove = null;
          this.removedStoneKeys = new Set();
          this.positionHistory = [this.positionKey()];
          this.captures = { 1: 0, 2: 0 };
          this.sgfSetup = { black: [], white: [] };
          this.sgfKomi = 6.5;
          this.phantomHover = null;
          this.fogExplored = {
            1: new Uint8Array(this.size * this.size),
            2: new Uint8Array(this.size * this.size)
          };
          this.draw();
        }

  index(x, y) { return y * this.size + x; }

  getStone(x, y) { return this.stones[this.index(x, y)]; }

  setStone(x, y, stone) { this.stones[this.index(x, y)] = stone; }

  positionKey() { return this.stones.join(''); }

  neighbors(x, y) {
          const out = [];
          if (x > 0) out.push([x - 1, y]);
          if (x + 1 < this.size) out.push([x + 1, y]);
          if (y > 0) out.push([x, y - 1]);
          if (y + 1 < this.size) out.push([x, y + 1]);
          return out;
        }

  groupAt(x, y) {
          const color = this.getStone(x, y);
          if (!color) return { stones: [], liberties: new Set() };
          const todo = [[x, y]];
          const seen = new Set([`${x},${y}`]);
          const stones = [];
          const liberties = new Set();
  
          while (todo.length) {
            const [cx, cy] = todo.pop();
            stones.push([cx, cy]);
            for (const [nx, ny] of this.neighbors(cx, cy)) {
              const value = this.getStone(nx, ny);
              if (value === 0) {
                liberties.add(`${nx},${ny}`);
              } else if (value === color) {
                const key = `${nx},${ny}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  todo.push([nx, ny]);
                }
              }
            }
          }
          return { stones, liberties };
        }

  getStoneFromBoard(board, x, y) {
          return board[y * this.size + x];
        }

  setStoneOnBoard(board, x, y, stone) {
          board[y * this.size + x] = stone;
        }

  groupAtOnBoard(board, x, y) {
          const color = this.getStoneFromBoard(board, x, y);
          if (!color) return { stones: [], liberties: new Set() };
          const todo = [[x, y]];
          const seen = new Set([`${x},${y}`]);
          const stones = [];
          const liberties = new Set();
          while (todo.length) {
            const [cx, cy] = todo.pop();
            stones.push([cx, cy]);
            for (const [nx, ny] of this.neighbors(cx, cy)) {
              const value = this.getStoneFromBoard(board, nx, ny);
              if (value === 0) {
                liberties.add(`${nx},${ny}`);
              } else if (value === color) {
                const key = `${nx},${ny}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  todo.push([nx, ny]);
                }
              }
            }
          }
          return { stones, liberties };
        }

  canPlayLegally(x, y, stone) {
          if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
          if (this.getStone(x, y) !== 0) return false;
  
          const board = this.stones.slice();
          this.setStoneOnBoard(board, x, y, stone);
          const opponent = stone === 1 ? 2 : 1;
          const checked = new Set();
          for (const [nx, ny] of this.neighbors(x, y)) {
            if (this.getStoneFromBoard(board, nx, ny) !== opponent) continue;
            const key = `${nx},${ny}`;
            if (checked.has(key)) continue;
            const group = this.groupAtOnBoard(board, nx, ny);
            for (const [gx, gy] of group.stones) checked.add(`${gx},${gy}`);
            if (group.liberties.size === 0) {
              for (const [gx, gy] of group.stones) this.setStoneOnBoard(board, gx, gy, 0);
            }
          }
  
          if (this.groupAtOnBoard(board, x, y).liberties.size === 0) return false;
          const afterKey = board.join('');
          if (this.positionHistory.length >= 2 && afterKey === this.positionHistory[this.positionHistory.length - 2]) return false;
          return true;
        }

  /*
   * Рассчитывает результат предполагаемого хода, не изменяя реальную партию.
   *
   * Возвращает:
   *   { ok: true, stones, captured, afterKey }
   * либо
   *   { ok: false, reason }
   *
   * Алгоритм повторяет playStone(): занятость, захват, самоубийство и простое ko.
   * Он нужен режиму "фантом", чтобы предпросмотр был идентичен настоящему ходу.
   */
  simulateStone(x, y, stone) {
          if (x < 0 || y < 0 || x >= this.size || y >= this.size) {
            return { ok: false, reason: 'outside' };
          }
          if (this.getStone(x, y) !== 0) {
            return { ok: false, reason: 'occupied' };
          }

          const simulated = this.stones.slice();
          this.setStoneOnBoard(simulated, x, y, stone);

          const opponent = stone === 1 ? 2 : 1;
          const checked = new Set();
          let captured = 0;

          for (const [nx, ny] of this.neighbors(x, y)) {
            if (this.getStoneFromBoard(simulated, nx, ny) !== opponent) continue;

            const key = `${nx},${ny}`;
            if (checked.has(key)) continue;

            const group = this.groupAtOnBoard(simulated, nx, ny);
            for (const [gx, gy] of group.stones) checked.add(`${gx},${gy}`);

            if (group.liberties.size === 0) {
              captured += group.stones.length;
              for (const [gx, gy] of group.stones) {
                this.setStoneOnBoard(simulated, gx, gy, 0);
              }
            }
          }

          // Самоубийственный ход недопустим.
          if (this.groupAtOnBoard(simulated, x, y).liberties.size === 0) {
            return { ok: false, reason: 'suicide' };
          }

          const afterKey = simulated.join('');

          // Используем то же правило простого ko, что и в playStone().
          if (
            this.positionHistory.length >= 2 &&
            afterKey === this.positionHistory[this.positionHistory.length - 2]
          ) {
            return { ok: false, reason: 'ko' };
          }

          return {
            ok: true,
            stones: simulated,
            captured,
            afterKey,
            x,
            y,
            stone
          };
        }

  bonusLibertiesForGroup(group, color) {
          const opponent = color === 1 ? 2 : 1;
          let bonus = 0;
          for (const key of group.liberties) {
            const [x, y] = key.split(',').map(Number);
            if (!this.canPlayLegally(x, y, opponent)) bonus += 1;
          }
          return bonus;
        }

  removeGroup(group) {
          for (const [x, y] of group.stones) this.setStone(x, y, 0);
          return group.stones.length;
        }

  playStone(x, y, stone, draw = true) {
          if (x < 0 || y < 0 || x >= this.size || y >= this.size) return { ok: false, reason: 'outside' };
          if (this.getStone(x, y) !== 0) return { ok: false, reason: 'occupied' };
  
          const before = this.stones.slice();
          const capturesBefore = { ...this.captures };
          const previousLastMove = this.lastMove ? { ...this.lastMove } : null;
          const fogBefore = {
            1: this.fogExplored[1].slice(),
            2: this.fogExplored[2].slice()
          };
          this.setStone(x, y, stone);
  
          const opponent = stone === 1 ? 2 : 1;
          let captured = 0;
          const checked = new Set();
          for (const [nx, ny] of this.neighbors(x, y)) {
            if (this.getStone(nx, ny) !== opponent) continue;
            const key = `${nx},${ny}`;
            if (checked.has(key)) continue;
            const group = this.groupAt(nx, ny);
            for (const [gx, gy] of group.stones) checked.add(`${gx},${gy}`);
            if (group.liberties.size === 0) captured += this.removeGroup(group);
          }
  
          // Suicide is illegal under the Japanese rules used by our local test board.
          if (this.groupAt(x, y).liberties.size === 0) {
            this.stones = before;
            return { ok: false, reason: 'suicide' };
          }
  
          // Simple ko: disallow immediate recreation of the position from two plies ago.
          const afterKey = this.positionKey();
          if (this.positionHistory.length >= 2 && afterKey === this.positionHistory[this.positionHistory.length - 2]) {
            this.stones = before;
            return { ok: false, reason: 'ko' };
          }
  
          this.captures[stone] += captured;
          this.history.push({ pass: false, x, y, stone, before, capturesBefore, captured, previousLastMove, fogBefore });
          this.lastMove = { x, y, stone };
          this.positionHistory.push(afterKey);
          if (typeof this.updateFogExploration === 'function') this.updateFogExploration();
          if (draw) this.draw();
          return { ok: true, captured };
        }

  /*
   * Пас хранится в той же истории, что и обычный ход.
   * Это нужно сразу для трёх вещей:
   *  - корректного номера хода;
   *  - отмены паса;
   *  - экспорта полной последовательности в SGF.
   *
   * Позиция после паса физически не меняется, но добавляется в positionHistory.
   * Поэтому простой ko после паса работает корректно: пас разрывает немедленное
   * повторение позиции.
   */
  playPass(stone, draw = true) {
          const before = this.stones.slice();
          const capturesBefore = { ...this.captures };
          const previousLastMove = this.lastMove ? { ...this.lastMove } : null;
          const fogBefore = {
            1: this.fogExplored[1].slice(),
            2: this.fogExplored[2].slice()
          };

          this.history.push({
            pass: true,
            x: null,
            y: null,
            stone,
            before,
            capturesBefore,
            captured: 0,
            previousLastMove,
            fogBefore
          });

          this.lastMove = null;
          this.positionHistory.push(this.positionKey());
          if (typeof this.updateFogExploration === 'function') this.updateFogExploration();
          if (draw) this.draw();
          return { ok: true, pass: true };
        }

  undo() {
          const move = this.history.pop();
          if (!move) return null;
          this.stones = move.before.slice();
          this.captures = { ...move.capturesBefore };
          this.lastMove = move.previousLastMove ? { ...move.previousLastMove } : null;
          this.positionHistory.pop();
          if (move.fogBefore) {
            this.fogExplored = {
              1: move.fogBefore[1].slice(),
              2: move.fogBefore[2].slice()
            };
          }
          this.draw();
          return move;
        }

  reset() {
          this.stones.fill(0);
          this.history = [];
          this.lastMove = null;
          this.positionHistory = [this.positionKey()];
          this.captures = { 1: 0, 2: 0 };
          this.fogExplored = {
            1: new Uint8Array(this.size * this.size),
            2: new Uint8Array(this.size * this.size)
          };
          this.draw();
        }
}
