// Faces, metaballs and thin-link visualization.

    const FACE_SPRITE_FRAME = 128;
    const FACE_STATE_INDEX = { calm: 0, happy: 1, sad: 2, crying: 3, dying: 4 };
    const faceSprite = new Image();
    const anxiousFaceSprite = new Image();
    let faceSpriteReady = false;
    let anxiousFaceSpriteReady = false;
    faceSprite.addEventListener('load', () => {
      faceSpriteReady = true;
      if (window.goBoardInstance) window.goBoardInstance.draw();
    });
    anxiousFaceSprite.addEventListener('load', () => {
      anxiousFaceSpriteReady = true;
      if (window.goBoardInstance) window.goBoardInstance.draw();
    });
    faceSprite.src = 'go-stone-face-sprite.png';
    anxiousFaceSprite.src = 'go-stone-face-anxious.png';


    const LINK_PARAM_DEFS = {
      diagonal: { label: 'Ход наискосок', sigmaFactor: 0.12, threshold: 0.30 },
      jump: { label: 'Прыжок через перекрёсток', sigmaFactor: 0.08, threshold: 0.30 },
      keima: { label: 'Кейма', sigmaFactor: 0.08, threshold: 0.30 },
      jump2: { label: 'Прыжок через два перекрёстка', sigmaFactor: 0.04, threshold: 0.30 },
      ogeima: { label: 'Огейма', sigmaFactor: 0.04, threshold: 0.30 }
    };
    const linkRenderSettings = JSON.parse(JSON.stringify(LINK_PARAM_DEFS));

GoBoard.prototype.setFacesVisible = function(visible) {
        this.showFaces = Boolean(visible);
        this.draw();
      };

GoBoard.prototype.setLinksVisible = function(visible) {
        this.showLinks = Boolean(visible);
        this.draw();
      };

GoBoard.prototype.setLinkThickness = function(value) {
        this.linkThickness = Math.max(0.3, Math.min(3, Number(value) || 1));
        this.draw();
      };

GoBoard.prototype.faceStateFromLiberties = function(liberties) {
        if (liberties > 4) return 'happy';
        if (liberties === 4) return 'calm';
        if (liberties === 3) return 'sad';
        if (liberties === 2) return 'crying';
        return 'dying';
      };

GoBoard.prototype.hashString = function(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
          hash ^= value.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      };

GoBoard.prototype.buildGroups = function() {
        const groups = [];
        const visited = new Set();
        for (let y = 0; y < this.size; y++) {
          for (let x = 0; x < this.size; x++) {
            const stone = this.getStone(x, y);
            if (!stone) continue;
            const key = `${x},${y}`;
            if (visited.has(key)) continue;
            const group = this.groupAt(x, y);
            const bonusLiberties = this.bonusLibertiesForGroup(group, stone);
            const liberties = group.liberties.size + bonusLiberties;
            const state = this.faceStateFromLiberties(liberties);
            const ordered = group.stones.slice().sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
            const seed = this.hashString(ordered.map(([gx, gy]) => `${gx},${gy}`).join('|'));
            const anchor = ordered[seed % ordered.length];
            const offsets = [
              [0, 0],
              [-0.12, -0.08],
              [0.12, -0.08],
              [-0.10, 0.10],
              [0.10, 0.10],
              [0.00, 0.14],
              [0.00, -0.14]
            ];
            const faceOffset = offsets[Math.floor(seed / Math.max(1, ordered.length)) % offsets.length];
            for (const [gx, gy] of group.stones) visited.add(`${gx},${gy}`);
            groups.push({
              id: groups.length,
              stones: ordered,
              color: stone,
              liberties,
              bonusLiberties,
              state,
              anchor,
              faceOffset
            });
          }
        }
        return groups;
      };

GoBoard.prototype.drawMetaballGroups = function(groups, pad, step, cssSize) {
        for (const group of groups) {
          this.drawMetaballGroup(group, pad, step, cssSize);
        }
      };

GoBoard.prototype.drawMetaballGroup = function(group, pad, step, cssSize) {
        if (!group.stones.length) return;

        const maskScale = Math.min(2, Math.max(1.35, window.devicePixelRatio || 1));
        const sigma = step * 0.33;
        const threshold = 0.36;
        const cutoff = sigma * 3.15;
        const margin = step * 0.72;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const centers = group.stones.map(([x, y]) => {
          const cx = pad + x * step;
          const cy = pad + y * step;
          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);
          return [cx, cy];
        });

        const left = Math.max(0, Math.floor(minX - margin));
        const top = Math.max(0, Math.floor(minY - margin));
        const right = Math.min(cssSize, Math.ceil(maxX + margin));
        const bottom = Math.min(cssSize, Math.ceil(maxY + margin));
        const widthCss = Math.max(1, right - left);
        const heightCss = Math.max(1, bottom - top);
        const mw = Math.max(1, Math.ceil(widthCss * maskScale));
        const mh = Math.max(1, Math.ceil(heightCss * maskScale));

        const field = new Float32Array(mw * mh);
        const invTwoSigma2 = 1 / (2 * sigma * sigma);
        const cutoff2 = cutoff * cutoff;

        // Добавляем каждый камень локально: это быстрее, чем для каждого пикселя
        // обходить всю цепочку, и масштабируется даже на большие группы.
        for (const [cx, cy] of centers) {
          const localCx = (cx - left) * maskScale;
          const localCy = (cy - top) * maskScale;
          const radiusPx = cutoff * maskScale;
          const x0 = Math.max(0, Math.floor(localCx - radiusPx));
          const x1 = Math.min(mw - 1, Math.ceil(localCx + radiusPx));
          const y0 = Math.max(0, Math.floor(localCy - radiusPx));
          const y1 = Math.min(mh - 1, Math.ceil(localCy + radiusPx));

          for (let py = y0; py <= y1; py++) {
            const yCss = py / maskScale + top;
            const dy = yCss - cy;
            const dy2 = dy * dy;
            for (let px = x0; px <= x1; px++) {
              const xCss = px / maskScale + left;
              const dx = xCss - cx;
              const d2 = dx * dx + dy2;
              if (d2 > cutoff2) continue;
              field[py * mw + px] += Math.exp(-d2 * invTwoSigma2);
            }
          }
        }

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = mw;
        maskCanvas.height = mh;
        const maskCtx = maskCanvas.getContext('2d');
        const image = maskCtx.createImageData(mw, mh);
        const data = image.data;

        // Небольшая зона feather вокруг контура даёт аккуратное сглаживание.
        const feather = 0.055;
        for (let i = 0; i < field.length; i++) {
          const v = field[i];
          let a = (v - (threshold - feather)) / (feather * 2);
          a = Math.max(0, Math.min(1, a));
          // smoothstep
          a = a * a * (3 - 2 * a);
          data[i * 4] = 255;
          data[i * 4 + 1] = 255;
          data[i * 4 + 2] = 255;
          data[i * 4 + 3] = Math.round(a * 255);
        }
        maskCtx.putImageData(image, 0, 0);

        const blobCanvas = document.createElement('canvas');
        blobCanvas.width = mw;
        blobCanvas.height = mh;
        const b = blobCanvas.getContext('2d');
        b.scale(maskScale, maskScale);

        // Один общий градиент на всю цепочку: больше нет границ отдельных камней.
        const gx = widthCss * 0.32;
        const gy = heightCss * 0.26;
        const radius = Math.max(widthCss, heightCss) * 0.72;
        const gradient = b.createRadialGradient(gx, gy, step * 0.08, widthCss * 0.52, heightCss * 0.52, radius);
        if (group.color === 1) {
          gradient.addColorStop(0, '#555');
          gradient.addColorStop(0.28, '#191919');
          gradient.addColorStop(1, '#020202');
        } else {
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(0.62, '#eeeeee');
          gradient.addColorStop(1, '#a9a9a9');
        }
        b.fillStyle = gradient;
        b.fillRect(0, 0, widthCss, heightCss);

        // Мягкий общий блик для всей сущности.
        const shine = b.createRadialGradient(
          widthCss * 0.28, heightCss * 0.18, 0,
          widthCss * 0.28, heightCss * 0.18, Math.max(step * 0.7, widthCss * 0.46)
        );
        shine.addColorStop(0, group.color === 1 ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.52)');
        shine.addColorStop(1, 'rgba(255,255,255,0)');
        b.fillStyle = shine;
        b.fillRect(0, 0, widthCss, heightCss);

        // Маска применяется последней.
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.globalCompositeOperation = 'destination-in';
        b.drawImage(maskCanvas, 0, 0);
        b.globalCompositeOperation = 'source-over';

        const c = this.ctx;
        c.save();
        c.shadowColor = '#0007';
        c.shadowBlur = Math.max(2, step * 0.08);
        c.shadowOffsetY = Math.max(1, step * 0.055);
        c.drawImage(blobCanvas, left, top, widthCss, heightCss);
        c.restore();

        if (group.color === 2) {
          c.save();
          c.globalAlpha = 0.32;
          c.drawImage(maskCanvas, left, top, widthCss, heightCss);
          c.globalCompositeOperation = 'source-atop';
          c.strokeStyle = '#666';
          c.restore();
        }
      };

GoBoard.prototype.detectLinkType = function(dx, dy) {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx === 1 && ady === 1) return 'diagonal';
        if ((adx === 2 && ady === 0) || (adx === 0 && ady === 2)) return 'jump';
        if ((adx === 2 && ady === 1) || (adx === 1 && ady === 2)) return 'keima';
        if ((adx === 3 && ady === 0) || (adx === 0 && ady === 3)) return 'jump2';
        if ((adx === 3 && ady === 1) || (adx === 1 && ady === 3)) return 'ogeima';
        return null;
      };

GoBoard.prototype.linkId = function(groupA, groupB) {
        const a = Math.min(groupA, groupB);
        const b = Math.max(groupA, groupB);
        return `${a}:${b}`;
      };

GoBoard.prototype.distancePointToSegment = function(point, a, b) {
        const vx = b[0] - a[0];
        const vy = b[1] - a[1];
        const len2 = vx * vx + vy * vy || 1;
        let t = ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = a[0] + vx * t;
        const qy = a[1] + vy * t;
        return { distance: Math.hypot(point[0] - qx, point[1] - qy), t };
      };

GoBoard.prototype.linkCorridorWidth = function(type) {
        if (type === 'diagonal') return 0.16;
        if (type === 'jump' || type === 'jump2') return 0.18;
        if (type === 'keima' || type === 'ogeima') return 0.62;
        return 0.22;
      };

GoBoard.prototype.isStoneBlockingLink = function(link, x, y, stoneColor) {
        const [ax, ay] = link.from;
        const [bx, by] = link.to;
        if ((x === ax && y === ay) || (x === bx && y === by)) return false;

        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        const { distance, t } = this.distancePointToSegment([x, y], [ax, ay], [bx, by]);
        if (t <= 0.03 || t >= 0.97) return false;

        // Общее правило: если на пути связи стоит камень/цепочка, связь исчезает.
        if (distance <= this.linkCorridorWidth(link.type)) return true;

        // Дополнительное правило для кеймы и огеймы:
        // если внутри прямоугольника пути находятся камни другого цвета,
        // связь не рисуем, даже если центр камня не попал точно на ось сегмента.
        if ((link.type === 'keima' || link.type === 'ogeima') && stoneColor !== link.color) {
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
        }

        return false;
      };

GoBoard.prototype.linkBlockedByStone = function(link) {
        for (let y = 0; y < this.size; y++) {
          for (let x = 0; x < this.size; x++) {
            const stone = this.getStone(x, y);
            if (!stone) continue;
            if (this.isStoneBlockingLink(link, x, y, stone)) return true;
          }
        }
        return false;
      };

GoBoard.prototype.buildThinLinks = function(groups) {
        const stoneEntries = [];
        for (const group of groups) {
          for (const [x, y] of group.stones) {
            stoneEntries.push({ x, y, color: group.color, groupId: group.id });
          }
        }

        const bestByPair = new Map();
        for (let i = 0; i < stoneEntries.length; i++) {
          for (let j = i + 1; j < stoneEntries.length; j++) {
            const a = stoneEntries[i];
            const b = stoneEntries[j];
            if (a.color !== b.color) continue;
            if (a.groupId === b.groupId) continue;
            const type = this.detectLinkType(b.x - a.x, b.y - a.y);
            if (!type) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const link = {
              type,
              color: a.color,
              from: [a.x, a.y],
              to: [b.x, b.y],
              fromGroupId: a.groupId,
              toGroupId: b.groupId,
              length: Math.hypot(dx, dy)
            };
            if (this.linkBlockedByStone(link)) continue;
            const pairKey = this.linkId(a.groupId, b.groupId);
            const prev = bestByPair.get(pairKey);
            if (!prev || link.length < prev.length - 1e-6 || (Math.abs(link.length - prev.length) <= 1e-6 && `${link.from[0]},${link.from[1]}:${link.to[0]},${link.to[1]}` < `${prev.from[0]},${prev.from[1]}:${prev.to[0]},${prev.to[1]}`)) {
              bestByPair.set(pairKey, link);
            }
          }
        }

        return this.resolveLinkConflicts(Array.from(bestByPair.values()));
      };

GoBoard.prototype.orientation = function(a, b, c) {
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      };

GoBoard.prototype.pointOnSegment = function(p, a, b, eps = 1e-9) {
        return p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps &&
               p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps &&
               Math.abs(this.orientation(a, b, p)) <= eps;
      };

GoBoard.prototype.linksIntersect = function(a, b) {
        const p1 = a.from, p2 = a.to, q1 = b.from, q2 = b.to;
        const eps = 1e-9;

        // Общий камень не считаем пересечением: от одного камня могут законно
        // отходить несколько связей разных типов и направлений.
        const samePoint = (u, v) => Math.abs(u[0] - v[0]) <= eps && Math.abs(u[1] - v[1]) <= eps;
        if (samePoint(p1, q1) || samePoint(p1, q2) || samePoint(p2, q1) || samePoint(p2, q2)) return false;

        const o1 = this.orientation(p1, p2, q1);
        const o2 = this.orientation(p1, p2, q2);
        const o3 = this.orientation(q1, q2, p1);
        const o4 = this.orientation(q1, q2, p2);

        const proper = ((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) &&
                       ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps));
        if (proper) return true;

        if (Math.abs(o1) <= eps && this.pointOnSegment(q1, p1, p2, eps)) return true;
        if (Math.abs(o2) <= eps && this.pointOnSegment(q2, p1, p2, eps)) return true;
        if (Math.abs(o3) <= eps && this.pointOnSegment(p1, q1, q2, eps)) return true;
        if (Math.abs(o4) <= eps && this.pointOnSegment(p2, q1, q2, eps)) return true;
        return false;
      };

GoBoard.prototype.resolveLinkConflicts = function(links) {
        // Правила приоритетов:
        // 1) разный цвет + одинаковая длина -> обе связи исчезают;
        // 2) разный цвет + разная длина -> остаётся более короткая;
        // 3) одинаковый цвет + пересечение -> остаётся более короткая;
        // Если длины одинаковы у связей одного цвета, оставляем одну детерминированно.
        const remove = new Set();
        const eps = 1e-6;

        for (let i = 0; i < links.length; i++) {
          for (let j = i + 1; j < links.length; j++) {
            if (remove.has(i) && remove.has(j)) continue;
            const a = links[i];
            const b = links[j];
            if (!this.linksIntersect(a, b)) continue;

            const sameLength = Math.abs(a.length - b.length) <= eps;
            if (a.color !== b.color) {
              if (sameLength) {
                remove.add(i);
                remove.add(j);
              } else if (a.length < b.length) {
                remove.add(j);
              } else {
                remove.add(i);
              }
            } else {
              if (sameLength) {
                // Детерминированно оставляем более раннюю связь.
                remove.add(j);
              } else if (a.length < b.length) {
                remove.add(j);
              } else {
                remove.add(i);
              }
            }
          }
        }

        return links.filter((_, index) => !remove.has(index));
      };

GoBoard.prototype.drawThinLinks = function(links, pad, step, cssSize) {
        for (const link of links) this.drawThinLink(link, pad, step, cssSize);
      };

GoBoard.prototype.drawThinLink = function(link, pad, step, cssSize) {
        const params = linkRenderSettings[link.type] || LINK_PARAM_DEFS.diagonal;
        const sigmaFactor = Math.max(0.01, Number(params.sigmaFactor) || 0.1);
        const threshold = Math.max(0.01, Math.min(0.99, Number(params.threshold) || 0.3));
        const sigma = step * sigmaFactor * this.linkThickness;
        const [x1, y1] = link.from;
        const [x2, y2] = link.to;
        const ax = pad + x1 * step;
        const ay = pad + y1 * step;
        const bx = pad + x2 * step;
        const by = pad + y2 * step;

        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        const margin = step * 0.75;
        const left = Math.max(0, Math.floor(minX - margin));
        const top = Math.max(0, Math.floor(minY - margin));
        const right = Math.min(cssSize, Math.ceil(maxX + margin));
        const bottom = Math.min(cssSize, Math.ceil(maxY + margin));
        const widthCss = Math.max(1, right - left);
        const heightCss = Math.max(1, bottom - top);

        const scale = Math.min(2, Math.max(1.25, window.devicePixelRatio || 1));
        const mw = Math.max(1, Math.ceil(widthCss * scale));
        const mh = Math.max(1, Math.ceil(heightCss * scale));
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = mw;
        maskCanvas.height = mh;
        const maskCtx = maskCanvas.getContext('2d');
        const image = maskCtx.createImageData(mw, mh);
        const data = image.data;

        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy || 1;
        const feather = 0.055;

        for (let py = 0; py < mh; py++) {
          const y = top + py / scale;
          for (let px = 0; px < mw; px++) {
            const x = left + px / scale;
            const wx = x - ax;
            const wy = y - ay;
            let t = (wx * vx + wy * vy) / len2;
            t = Math.max(0, Math.min(1, t));
            const qx = ax + vx * t;
            const qy = ay + vy * t;
            const dx = x - qx;
            const dy = y - qy;
            const d2 = dx * dx + dy * dy;

            // Связь расширяется возле камней и плавно сужается к середине.
            // t=0/1 -> около 2x sigma, t=0.5 -> около 46% от sigma.
            const edge = Math.abs(2 * t - 1);
            const taper = 0.46 + 1.54 * Math.pow(edge, 1.55);
            const localSigma = Math.max(step * 0.012, sigma * taper);
            const localInvTwoSigma2 = 1 / (2 * localSigma * localSigma);
            let a = (Math.exp(-d2 * localInvTwoSigma2) - (threshold - feather)) / (feather * 2);
            a = Math.max(0, Math.min(1, a));
            a = a * a * (3 - 2 * a);
            const idx = (py * mw + px) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
            data[idx + 3] = Math.round(a * 255);
          }
        }
        maskCtx.putImageData(image, 0, 0);

        const linkCanvas = document.createElement('canvas');
        linkCanvas.width = mw;
        linkCanvas.height = mh;
        const lc = linkCanvas.getContext('2d');
        lc.scale(scale, scale);

        const gradient = lc.createRadialGradient(widthCss * 0.34, heightCss * 0.30, step * 0.04, widthCss * 0.52, heightCss * 0.52, Math.max(widthCss, heightCss) * 0.86);
        if (link.color === 1) {
          gradient.addColorStop(0, '#565656');
          gradient.addColorStop(0.35, '#1a1a1a');
          gradient.addColorStop(1, '#030303');
        } else {
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(0.70, '#efefef');
          gradient.addColorStop(1, '#b4b4b4');
        }
        lc.fillStyle = gradient;
        lc.fillRect(0, 0, widthCss, heightCss);

        const shine = lc.createLinearGradient(0, 0, 0, heightCss);
        shine.addColorStop(0, link.color === 1 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.38)');
        shine.addColorStop(0.55, 'rgba(255,255,255,0)');
        shine.addColorStop(1, 'rgba(0,0,0,.06)');
        lc.fillStyle = shine;
        lc.fillRect(0, 0, widthCss, heightCss);

        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(maskCanvas, 0, 0);
        lc.globalCompositeOperation = 'source-over';

        const c = this.ctx;
        c.save();
        c.shadowColor = '#0005';
        c.shadowBlur = Math.max(1, step * 0.035);
        c.shadowOffsetY = Math.max(0.5, step * 0.018);
        c.drawImage(linkCanvas, left, top, widthCss, heightCss);
        c.restore();
      };

GoBoard.prototype.drawGroupFaces = function(groups, pad, step, heatmap) {
        for (const group of groups) {
          const [ax, ay] = group.anchor;
          const [ox, oy] = group.faceOffset;
          const cx = pad + ax * step + ox * step;
          const cy = pad + ay * step + oy * step;
          const faceState = this.groupFullyInOpponentInfluence(group, heatmap) ? 'anxious' : group.state;
          this.drawFaceOverlay(cx, cy, step * 0.38, group.color, faceState);
        }
      };

GoBoard.prototype.drawFaceOverlay = function(cx, cy, radius, stone, faceState) {
        const c = this.ctx;
        const frameSize = FACE_SPRITE_FRAME;
        const scale = 0.94;
        const size = radius * 2 * scale;
        const dx = cx - size / 2;
        const dy = cy - size / 2;

        c.save();
        c.imageSmoothingEnabled = true;
        c.filter = stone === 1 ? 'invert(1)' : 'none';
        c.globalAlpha = 0.97;

        if (faceState === 'anxious') {
          if (anxiousFaceSpriteReady) {
            c.drawImage(anxiousFaceSprite, 0, 0, frameSize, frameSize, dx, dy, size, size);
          }
        } else {
          const frame = FACE_STATE_INDEX[faceState];
          if (frame !== undefined) {
            const sx = frame * frameSize;
            const sy = 0;
            const sw = frameSize;
            const sh = faceSprite.naturalHeight || frameSize;
            c.drawImage(faceSprite, sx, sy, sw, sh, dx, dy, size, size);
          }
        }
        c.restore();
      };
