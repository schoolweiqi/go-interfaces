// Canvas board rendering and pointer handling.

GoBoard.prototype.setCleanVisible = function(visible) {
        this.showClean = Boolean(visible);
        this.draw();
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
        const { cssSize, pad, step } = this.metrics();
        const c = this.ctx;

        c.clearRect(0, 0, cssSize, cssSize);

        const wood = c.createLinearGradient(0, 0, cssSize, cssSize);
        wood.addColorStop(0, '#e4b76e');
        wood.addColorStop(0.5, '#d9aa63');
        wood.addColorStop(1, '#c99751');
        c.fillStyle = wood;
        c.fillRect(0, 0, cssSize, cssSize);

        // В оригинальном Influencie heatmap рисуется поверх доски,
        // но под линиями и камнями.
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
              this.drawStone(pad + x * step, pad + y * step, step * 0.46, stone);
            }
          }
        }

        if (showFaces && faceSpriteReady) {
          const faceInfluence = this.computeInfluenceHeatmap(false);
          this.drawGroupFaces(groups, pad, step, faceInfluence);
        }

        this.drawLastMoveMarker(pad, step);
        this.drawInfluenceNumbers(pad, step);
      };

GoBoard.prototype.drawCoordinates = function(pad, step, cssSize) {
        const c = this.ctx;
        const letters = [];
        for (let x = 0; x < this.size; x++) {
          const code = 65 + x + (x >= 8 ? 1 : 0); // В координатах Го буква I пропускается.
          letters.push(String.fromCharCode(code));
        }

        const fontSize = 14;
        const outerInset = Math.max(fontSize * 0.62, 9);
        c.save();
        c.fillStyle = '#2d2116';
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

GoBoard.prototype.drawLastMoveMarker = function(pad, step) {
        if (!this.lastMove) return;
        const { x, y } = this.lastMove;
        if (!this.getStone(x, y)) return;
        const c = this.ctx;
        const cx = pad + x * step;
        const cy = pad + y * step;
        // Тонкое зелёное кольцо идёт почти по внешней границе обычного камня.
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
