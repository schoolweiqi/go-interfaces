// Canvas board rendering and pointer handling.

GoBoard.prototype.setCleanVisible = function(visible) {
        this.showClean = Boolean(visible);
        this.draw();
      };

GoBoard.prototype.setPhantomVisible = function(visible) {
        this.showPhantom = Boolean(visible);
        if (!this.showPhantom) this.phantomHover = null;
        this.draw();
      };

GoBoard.prototype.setPhantomColor = function(color) {
        this.phantomColor = Number(color) === 2 ? 2 : 1;
        if (this.showPhantom && this.phantomHover) this.draw();
      };

GoBoard.prototype.clearPhantomHover = function() {
        if (!this.phantomHover) return;
        this.phantomHover = null;
        if (this.showPhantom) this.draw();
      };

GoBoard.prototype.handlePhantomPointerMove = function(event) {
        if (!this.showPhantom) return;

        const { pad, step } = this.metrics();
        const rect = this.canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        const x = Math.round((localX - pad) / step);
        const y = Math.round((localY - pad) / step);

        let next = null;

        if (x >= 0 && y >= 0 && x < this.size && y < this.size) {
          const px = pad + x * step;
          const py = pad + y * step;
          const distance = Math.hypot(localX - px, localY - py);
          if (distance <= step * 0.45) next = { x, y };
        }

        const same = this.phantomHover && next &&
          this.phantomHover.x === next.x && this.phantomHover.y === next.y;

        if (same || (!this.phantomHover && !next)) return;

        this.phantomHover = next;
        this.draw();
      };

GoBoard.prototype.setJosekiChoices = function(choices) {
        this.josekiChoices = Array.isArray(choices)
          ? choices
              .map(choice => ({
                x: Number(choice.x),
                y: Number(choice.y),
                label: String(choice.label == null ? "" : choice.label),
                category: String(choice.category || ""),
                nodeId: choice.nodeId == null ? null : String(choice.nodeId)
              }))
              .filter(choice =>
                Number.isInteger(choice.x) &&
                Number.isInteger(choice.y) &&
                choice.x >= 0 &&
                choice.y >= 0 &&
                choice.x < this.size &&
                choice.y < this.size
              )
          : [];
        this.draw();
      };

GoBoard.prototype.drawJosekiChoices = function(pad, step) {
        if (!Array.isArray(this.josekiChoices) || !this.josekiChoices.length) return;

        const colors = {
          IDEAL: '#008300',
          GOOD: '#436600',
          MISTAKE: '#b3001e',
          TRICK: '#ffff00',
          QUESTION: '#00ccff'
        };

        const c = this.ctx;
        c.save();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = `700 ${Math.max(10, step * 0.34)}px Inter, system-ui, sans-serif`;

        for (const choice of this.josekiChoices) {
          const cx = pad + choice.x * step;
          const cy = pad + choice.y * step;
          const category = String(choice.category || '').toUpperCase();
          const radius = Math.max(6, step * 0.27);

          if (category === 'STUDY_HINT') {
            c.beginPath();
            c.arc(cx, cy, Math.max(7, step * 0.31), 0, Math.PI * 2);
            c.globalAlpha = 1;
            c.lineWidth = Math.max(2, step * 0.06);
            c.strokeStyle = '#2b78d0';
            c.stroke();
            continue;
          }

          const fill = colors[category] || '#355d8a';

          c.beginPath();
          c.arc(cx, cy, radius, 0, Math.PI * 2);
          c.fillStyle = fill;
          c.globalAlpha = 0.94;
          c.fill();

          c.globalAlpha = 1;
          c.lineWidth = Math.max(1, step * 0.035);
          c.strokeStyle = 'rgba(255,255,255,.88)';
          c.stroke();

          const label = choice.label && choice.label !== '_' ? choice.label : '';
          if (label) {
            c.fillStyle = category === 'TRICK' || category === 'QUESTION' ? '#111' : '#fff';
            c.fillText(label, cx, cy + 0.5);
          }
        }

        c.restore();
      };

GoBoard.prototype.metrics = function() {
        const rect = this.canvas.getBoundingClientRect();
        const cssSize = Math.max(300, Math.min(rect.width || 700, rect.width || 700));
        const dpr = window.devicePixelRatio || 1;
        const pixelSize = Math.floor(cssSize * dpr);

        if (this.canvas.width !== pixelSize || this.canvas.height !== pixelSize) {
          this.canvas.width = pixelSize;
          this.canvas.height = pixelSize;
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const pad = Math.max(18, cssSize * 0.055);
        return { cssSize, pad, step: (cssSize - pad * 2) / (this.size - 1) };
      };

GoBoard.prototype.draw = function() {
        if (!this.ctx) return;

        let phantomPreview = null;
        let realStones = null;
        let realPositionHistory = null;

        if (this.showPhantom && this.phantomHover) {
          phantomPreview = this.simulateStone(
            this.phantomHover.x,
            this.phantomHover.y,
            this.phantomColor
          );

          if (phantomPreview.ok) {
            realStones = this.stones;
            realPositionHistory = this.positionHistory;
            this.stones = phantomPreview.stones;
            this.positionHistory = [...realPositionHistory, phantomPreview.afterKey];
          }
        }

        const { cssSize, pad, step } = this.metrics();
        const c = this.ctx;

        c.clearRect(0, 0, cssSize, cssSize);

        const wood = c.createLinearGradient(0, 0, cssSize, cssSize);
        wood.addColorStop(0, '#e4b76e');
        wood.addColorStop(0.5, '#d9aa63');
        wood.addColorStop(1, '#c99751');
        c.fillStyle = wood;
        c.fillRect(0, 0, cssSize, cssSize);

        this.drawInfluenceHeatmap(pad, step);

        const showGrid = !this.showClean;
        const showFaces = this.showFaces;
        const showLinks = this.showLinks;

        if (showGrid) {
          c.strokeStyle = '#2d2116';
          c.lineWidth = 1;
          for (let i = 0; i < this.size; i++) {
            const p = pad + i * step;
            c.beginPath(); c.moveTo(pad, p); c.lineTo(cssSize - pad, p); c.stroke();
            c.beginPath(); c.moveTo(p, pad); c.lineTo(p, cssSize - pad); c.stroke();
          }
        }

        for (const [x, y] of this.starPoints()) {
          c.beginPath();
          c.arc(pad + x * step, pad + y * step, Math.max(2.2, step * 0.07), 0, Math.PI * 2);
          c.fillStyle = '#2d2116';
          c.fill();
        }

        this.drawCoordinates(pad, step, cssSize);

        const groups = (showFaces || showLinks) ? this.buildGroups() : null;

        if (showLinks) {
          const links = this.buildThinLinks(groups);
          this.drawThinLinks(links, pad, step, cssSize);
          this.drawMetaballGroups(groups, pad, step, cssSize);
        } else {
          for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
              const stone = this.getStone(x, y);
              if (!stone) continue;

              const isPhantomStone = Boolean(
                phantomPreview &&
                phantomPreview.ok &&
                x === phantomPreview.x &&
                y === phantomPreview.y
              );

              if (isPhantomStone) {
                c.save();
                c.globalAlpha = 0.52;
                this.drawStone(pad + x * step, pad + y * step, step * 0.46, stone);
                c.restore();
              } else {
                this.drawStone(pad + x * step, pad + y * step, step * 0.46, stone);
              }
            }
          }
        }

        if (showFaces && faceSpriteReady) {
          const faceInfluence = this.computeInfluenceHeatmap(false);
          this.drawGroupFaces(groups, pad, step, faceInfluence);
        }

        this.drawLastMoveMarker(pad, step);
        this.drawRemovedStoneMarks(pad, step);
        this.drawInfluenceNumbers(pad, step);
        this.drawJosekiChoices(pad, step);

        if (this.showPhantom && this.phantomHover) {
          const hx = pad + this.phantomHover.x * step;
          const hy = pad + this.phantomHover.y * step;

          c.save();
          if (phantomPreview && phantomPreview.ok) {
            c.beginPath();
            c.arc(hx, hy, step * 0.43, 0, Math.PI * 2);
            c.setLineDash([Math.max(3, step * 0.12), Math.max(2, step * 0.08)]);
            c.lineWidth = Math.max(1.5, step * 0.045);
            c.strokeStyle = 'rgba(50,232,117,.95)';
            c.stroke();
          } else {
            const r = step * 0.22;
            c.lineWidth = Math.max(2, step * 0.055);
            c.strokeStyle = 'rgba(220,70,70,.9)';
            c.beginPath();
            c.moveTo(hx - r, hy - r);
            c.lineTo(hx + r, hy + r);
            c.moveTo(hx + r, hy - r);
            c.lineTo(hx - r, hy + r);
            c.stroke();
          }
          c.restore();
        }

        this.drawFogOverlay(pad, step, cssSize);

        if (realStones) {
          this.stones = realStones;
          this.positionHistory = realPositionHistory;
        }
      };

GoBoard.prototype.drawCoordinates = function(pad, step, cssSize, color = '#2d2116') {
        const c = this.ctx;
        const letters = [];
        for (let x = 0; x < this.size; x++) {
          const code = 65 + x + (x >= 8 ? 1 : 0);
          letters.push(String.fromCharCode(code));
        }

        const fontSize = 14;
        const outerInset = Math.max(fontSize * 0.62, 9);
        c.save();
        c.fillStyle = color;
        c.font = `500 ${fontSize}px Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';

        const topY = outerInset;
        const bottomY = cssSize - outerInset;
        for (let x = 0; x < this.size; x++) {
          const px = pad + x * step;
          c.fillText(letters[x], px, topY);
          c.fillText(letters[x], px, bottomY);
        }

        const leftX = outerInset;
        const rightX = cssSize - outerInset;
        for (let y = 0; y < this.size; y++) {
          const label = String(this.size - y);
          const py = pad + y * step;
          c.fillText(label, leftX, py);
          c.fillText(label, rightX, py);
        }
        c.restore();
      };

GoBoard.prototype.drawRemovedStoneMarks = function(pad, step) {
        if (!this.removedStoneKeys || !this.removedStoneKeys.size) return;
        const c = this.ctx;
        c.save();
        c.strokeStyle = 'rgba(210,55,55,.95)';
        c.lineWidth = Math.max(2, step * 0.065);
        c.lineCap = 'round';
        for (const key of this.removedStoneKeys) {
          const parts = String(key).split(',').map(Number);
          const x = parts[0];
          const y = parts[1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const cx = pad + x * step;
          const cy = pad + y * step;
          const r = step * 0.22;
          c.beginPath();
          c.moveTo(cx - r, cy - r);
          c.lineTo(cx + r, cy + r);
          c.moveTo(cx + r, cy - r);
          c.lineTo(cx - r, cy + r);
          c.stroke();
        }
        c.restore();
      };

GoBoard.prototype.drawLastMoveMarker = function(pad, step) {
        if (!this.lastMove) return;
        const { x, y } = this.lastMove;
        if (!this.getStone(x, y)) return;
        const c = this.ctx;
        const cx = pad + x * step;
        const cy = pad + y * step;
        const radius = step * 0.435;
        c.save();
        c.beginPath();
        c.arc(cx, cy, radius, 0, Math.PI * 2);
        c.lineWidth = Math.max(1.5, step * 0.045);
        c.strokeStyle = '#32e875';
        c.stroke();
        c.restore();
      };

GoBoard.prototype.drawStone = function(cx, cy, radius, stone) {
        const c = this.ctx;
        c.save();
        c.shadowColor = '#0008';
        c.shadowBlur = Math.max(2, radius * 0.18);
        c.shadowOffsetY = Math.max(1, radius * 0.10);

        const gradient = c.createRadialGradient(
          cx - radius * 0.35, cy - radius * 0.4, radius * 0.08,
          cx, cy, radius
        );

        if (stone === 1) {
          gradient.addColorStop(0, '#5d5d5d');
          gradient.addColorStop(0.32, '#1c1c1c');
          gradient.addColorStop(1, '#020202');
        } else {
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(0.68, '#eeeeee');
          gradient.addColorStop(1, '#a8a8a8');
        }

        c.beginPath();
        c.arc(cx, cy, radius, 0, Math.PI * 2);
        c.fillStyle = gradient;
        c.fill();
        c.restore();

        if (stone === 2) {
          c.beginPath();
          c.arc(cx, cy, radius, 0, Math.PI * 2);
          c.strokeStyle = '#777';
          c.lineWidth = 1;
          c.stroke();
        }
      };

GoBoard.prototype.starPoints = function() {
        if (this.size === 19) return [[3,3],[9,3],[15,3],[3,9],[9,9],[15,9],[3,15],[9,15],[15,15]];
        if (this.size === 13) return [[3,3],[9,3],[6,6],[3,9],[9,9]];
        if (this.size === 9) return [[2,2],[6,2],[4,4],[2,6],[6,6]];
        return [];
      };

GoBoard.prototype.handleClick = function(event) {
        const { pad, step } = this.metrics();
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.round((event.clientX - rect.left - pad) / step);
        const y = Math.round((event.clientY - rect.top - pad) / step);
        if (x >= 0 && y >= 0 && x < this.size && y < this.size && this.onIntersection) {
          this.onIntersection(x, y);
        }
      };
