// Influence calculation and continuous-field rendering.

GoBoard.prototype.setInfluenceVisible = function(visible) {
        this.showInfluence = Boolean(visible);
        this.draw();
      };

GoBoard.prototype.setInfluenceNumbersVisible = function(visible) {
        this.showInfluenceNumbers = Boolean(visible);
        this.draw();
      };

GoBoard.prototype.setInfluenceStrength = function(value) {
        this.influenceStrength = Math.max(1, Math.min(20, Math.round(Number(value) || 4)));
        this.draw();
      };

GoBoard.prototype.setInfluenceThreeLibFactor = function(value) {
        const numeric = Number(value);
        this.influenceThreeLibFactor = Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : 0.8));
        this.draw();
      };

GoBoard.prototype.setInfluenceIntensity = function(value) {
        this.influenceIntensity = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
        this.draw();
      };

GoBoard.prototype.setInfluenceRadiusMultiplier = function(value) {
        const numeric = Number(value);
        this.influenceRadiusMultiplier = Math.max(0.1, Math.min(6, Number.isFinite(numeric) ? numeric : 2));
        this.draw();
      };

GoBoard.prototype.setInfluenceGradientFalloff = function(value) {
        const numeric = Number(value);
        this.influenceGradientFalloff = Math.max(0.05, Math.min(5, Number.isFinite(numeric) ? numeric : 0.8));
        this.draw();
      };

GoBoard.prototype.setInfluenceStonePointClamp = function(value) {
        const numeric = Number(value);
        this.influenceStonePointClamp = Math.max(0, Math.min(1, Number.isFinite(numeric) ? numeric : 0.5));
        this.draw();
      };

GoBoard.prototype.computeInfluenceHeatmap = function(clampStonePoints = true) {
        /*
         * МАТЕМАТИЧЕСКИЙ РАСЧЁТ ВЛИЯНИЯ
         * --------------------------------
         * Эта функция рассчитывает влияние только в узлах сетки (на перекрёстках).
         * Визуальное сглаживание и цвет здесь НЕ выполняются.
         *
         * Алгоритм специально симметричен для чёрных и белых:
         *
         * 1. Чёрное поле считается отдельно.
         *    Все вклады чёрных камней суммируются и насыщаются максимумом +1.
         *
         * 2. Белое поле считается отдельно.
         *    Все вклады белых камней суммируются и насыщаются минимумом -1.
         *
         * 3. После насыщения двух независимых полей они складываются:
         *       result = blackField + whiteField
         *
         * Благодаря этому равные по модулю влияния двух цветов взаимно уничтожаются.
         * Например: +0.75 + (-0.75) = 0 — нейтральный перекрёсток.
         *
         * Параметр clampStonePoints:
         *   true  — применяем визуальную коррекцию значения непосредственно под камнем;
         *   false — используем "честный" итоговый баланс. Это нужно, например,
         *           для определения тревожного лица под чужим влиянием.
         */
        const blackField = new Float64Array(this.size * this.size);
        const whiteField = new Float64Array(this.size * this.size);
        const degrade = 1.0 / this.influenceStrength;
        const groups = this.buildGroups();

        for (const group of groups) {
          const [gx, gy] = group.stones[0];
          const liberties = this.groupAt(gx, gy).liberties.size;

          let influenceFactor = 1;
          if (liberties <= 2) influenceFactor = 0;
          else if (liberties === 3) influenceFactor = this.influenceThreeLibFactor;
          if (influenceFactor === 0) continue;

          const targetField = group.color === 1 ? blackField : whiteField;

          for (const [x, y] of group.stones) {
            this.floodAddInfluenceSeparated(
              targetField,
              new Uint8Array(this.size * this.size),
              x, y, x, y,
              influenceFactor,
              degrade,
              group.color
            );
          }
        }

        const heatmap = new Float64Array(this.size * this.size);
        for (let i = 0; i < heatmap.length; i++) {
          heatmap[i] = blackField[i] + whiteField[i];
        }

        // Для отображения корректируем значение непосредственно под камнями.
        // Для анализа тревожного лица clampStonePoints=false, чтобы использовать
        // реальный итоговый баланс влияния под цепочкой.
        if (clampStonePoints) {
          for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
              const i = this.index(x, y);
              const stone = this.getStone(x, y);
              if (stone === 1) {
                heatmap[i] = Math.max(0, Math.min(heatmap[i], this.influenceStonePointClamp));
              } else if (stone === 2) {
                heatmap[i] = Math.min(0, Math.max(heatmap[i], -this.influenceStonePointClamp));
              }
            }
          }
        }

        // Переводим итоговое поле из [-1, +1] в [0, 1].
        const normalized = new Float64Array(heatmap.length);
        for (let i = 0; i < heatmap.length; i++) {
          normalized[i] = Math.max(0, Math.min(1, (heatmap[i] + 1) / 2));
        }
        return normalized;
      };

GoBoard.prototype.floodAddInfluenceSeparated = function(field, seen, originalX, originalY, x, y, initial, degrade, color) {
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
        const index = this.index(x, y);
        if (seen[index]) return;

        seen[index] = 1;

        if (color === 1) {
          field[index] = Math.min(1, field[index] + initial);
          // Чёрное влияние не распространяется дальше через белый камень.
          if (this.getStone(x, y) === 2) return;
        } else {
          field[index] = Math.max(-1, field[index] - initial);
          // Белое влияние не распространяется дальше через чёрный камень.
          if (this.getStone(x, y) === 1) return;
        }

        const next = Math.max(0, initial - degrade);
        if (next === 0) return;

        // Сохраняем ту же направленную flood-fill геометрию.
        if (originalX - x >= 0) this.floodAddInfluenceSeparated(field, seen, originalX, originalY, x - 1, y, next, degrade, color);
        if (originalX - x <= 0) this.floodAddInfluenceSeparated(field, seen, originalX, originalY, x + 1, y, next, degrade, color);
        if (originalY - y >= 0) this.floodAddInfluenceSeparated(field, seen, originalX, originalY, x, y - 1, next, degrade, color);
        if (originalY - y <= 0) this.floodAddInfluenceSeparated(field, seen, originalX, originalY, x, y + 1, next, degrade, color);
      };

GoBoard.prototype.sampleInfluenceBilinear = function(signedMap, gx, gy) {
        /*
         * БИЛИНЕЙНАЯ ИНТЕРПОЛЯЦИЯ
         * -----------------------
         * Математическая карта влияния существует только в перекрёстках доски.
         * Чтобы получить непрерывное поле между ними, для каждого пикселя берём
         * четыре ближайших перекрёстка и плавно интерполируем их значения.
         *
         * Это принципиально отличается от старой версии, где каждый перекрёсток
         * рисовал собственный полупрозрачный круг поверх уже нарисованных кругов.
         * Теперь у каждого пикселя есть ОДНО итоговое числовое значение, поэтому
         * порядок обхода доски больше не может дать преимущество одному цвету.
         */
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        const x = clamp(gx, 0, this.size - 1);
        const y = clamp(gy, 0, this.size - 1);

        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(this.size - 1, x0 + 1);
        const y1 = Math.min(this.size - 1, y0 + 1);

        const tx = x - x0;
        const ty = y - y0;

        const v00 = signedMap[this.index(x0, y0)];
        const v10 = signedMap[this.index(x1, y0)];
        const v01 = signedMap[this.index(x0, y1)];
        const v11 = signedMap[this.index(x1, y1)];

        const top = v00 * (1 - tx) + v10 * tx;
        const bottom = v01 * (1 - tx) + v11 * tx;

        return top * (1 - ty) + bottom * ty;
      };

GoBoard.prototype.drawInfluenceHeatmap = function(pad, step) {
        /*
         * ОТРИСОВКА ВЛИЯНИЯ ЕДИНЫМ ПОЛЕМ
         * --------------------------------
         * 1. Получаем итоговые значения влияния на перекрёстках.
         * 2. Переводим их обратно из нормализованной шкалы [0..1]
         *    в удобную знаковую шкалу [-1..+1]:
         *       +1 = максимально чёрное влияние
         *        0 = нейтраль
         *       -1 = максимально белое влияние
         * 3. Для каждого пикселя доски билинейно интерполируем ОДНО значение.
         * 4. По знаку этого значения выбираем ОДИН цвет:
         *       value > 0 -> малиновый
         *       value < 0 -> голубой
         *       value = 0 -> полностью прозрачно
         * 5. Прозрачность определяется модулем влияния.
         *
         * Важный результат: малиновый и голубой больше не накладываются друг на друга
         * как независимые Canvas-слои. Поэтому не возникает "фиолетового" артефакта
         * и один цвет не может визуально передавить другой из-за порядка рисования.
         */
        if (!this.showInfluence || this.influenceIntensity <= 0) return;

        const normalized = this.computeInfluenceHeatmap();
        const signedMap = new Float64Array(normalized.length);

        for (let i = 0; i < normalized.length; i++) {
          signedMap[i] = (normalized[i] - 0.5) * 2;
        }

        const c = this.ctx;

        // influenceIntensity хранится в привычной шкале 0..255.
        // Для пиксельной альфы переводим её в диапазон 0..1.
        const alphaConst = Math.min(255, this.influenceIntensity) / 255;

        /*
         * Поле строим во вспомогательном canvas только на области самой сетки:
         * от первого до последнего перекрёстка.
         *
         * Затем готовое изображение одной операцией переносится на основную доску.
         */
        const fieldSize = Math.max(1, Math.round(step * (this.size - 1)));
        const offscreen = document.createElement('canvas');
        offscreen.width = fieldSize + 1;
        offscreen.height = fieldSize + 1;

        const offCtx = offscreen.getContext('2d');
        const image = offCtx.createImageData(offscreen.width, offscreen.height);
        const data = image.data;

        // Фиксированные цвета нашей визуализации.
        const blackInfluenceRgb = [191, 0, 79];   // малиновый
        const whiteInfluenceRgb = [0, 128, 255];  // голубой

        /*
         * Проходим по каждому пикселю единого поля.
         * px/py — координаты в пикселях;
         * gx/gy — те же координаты в единицах расстояния между линиями доски.
         */
        for (let py = 0; py < offscreen.height; py++) {
          for (let px = 0; px < offscreen.width; px++) {
            const gx = px / step;
            const gy = py / step;

            const value = this.sampleInfluenceBilinear(signedMap, gx, gy);
            const magnitude = Math.min(1, Math.abs(value));

            /*
             * Gradient falloff теперь отвечает не за размер отдельного круга,
             * а за нелинейность прозрачности всего поля.
             *
             * При falloff = 1 прозрачность линейна:
             *    |0.5| -> 50% от заданной интенсивности.
             *
             * При falloff < 1 слабое влияние становится визуально заметнее.
             * При falloff > 1 слабое влияние становится более прозрачным.
             */
            let alpha01 = Math.pow(magnitude, this.influenceGradientFalloff) * alphaConst;
            alpha01 = Math.max(0, Math.min(1, alpha01));

            const idx = (py * offscreen.width + px) * 4;

            // Около нуля оставляем фон полностью прозрачным.
            if (alpha01 <= 0.002 || magnitude <= 1e-9) {
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
              data[idx + 3] = 0;
              continue;
            }

            const rgb = value > 0 ? blackInfluenceRgb : whiteInfluenceRgb;

            data[idx] = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = Math.round(alpha01 * 255);
          }
        }

        offCtx.putImageData(image, 0, 0);

        c.save();

        /*
         * Жёстко ограничиваем цвет областью игровой сетки.
         * Координаты на деревянной рамке и внешний край остаются незакрашенными.
         */
        c.beginPath();
        c.rect(pad, pad, step * (this.size - 1), step * (this.size - 1));
        c.clip();

        /*
         * Radius multiplier сохранён как экспериментальный параметр.
         * Теперь он НЕ определяет радиус отдельных пятен.
         *
         * Его новый смысл — дополнительное симметричное размытие уже построенного
         * единого поля. При 1 размытие отсутствует. При больших значениях границы
         * влияния становятся визуально мягче.
         *
         * Коэффициент 0.18 переводит multiplier в умеренный blur относительно
         * расстояния между линиями доски. Он влияет только на визуализацию,
         * но не меняет числовые значения влияния и режим "Число".
         */
        const blurPx = Math.max(0, (this.influenceRadiusMultiplier - 1) * step * 0.18);
        if (blurPx > 0.01) {
          c.filter = `blur(${blurPx}px)`;
        }

        c.drawImage(offscreen, pad, pad);
        c.restore();
      };

GoBoard.prototype.drawInfluenceNumbers = function(pad, step) {
        if (!this.showInfluenceNumbers) return;

        const heatmap = this.computeInfluenceHeatmap();
        const c = this.ctx;
        const fontSize = Math.max(7, Math.min(11, step * 0.30));

        c.save();
        c.font = `700 ${fontSize}px Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineJoin = 'round';
        c.lineWidth = Math.max(2, fontSize * 0.28);
        c.strokeStyle = 'rgba(0,0,0,.82)';
        c.fillStyle = '#ffffff';

        for (let y = 0; y < this.size; y++) {
          for (let x = 0; x < this.size; x++) {
            const normalized = heatmap[this.index(x, y)];
            let signed = (normalized - 0.5) * 2;
            if (Math.abs(signed) < 0.005) signed = 0;

            const label = signed === 0
              ? '0.00'
              : `${signed > 0 ? '+' : ''}${signed.toFixed(2)}`;

            const cx = pad + x * step;
            const cy = pad + y * step;
            c.strokeText(label, cx, cy);
            c.fillText(label, cx, cy);
          }
        }
        c.restore();
      };

GoBoard.prototype.groupFullyInOpponentInfluence = function(group, heatmap) {
        if (!heatmap || !group.stones.length) return false;
        const [gx, gy] = group.stones[0];
        const actualLiberties = this.groupAt(gx, gy).liberties.size;
        if (actualLiberties < 4) return false;
        return group.stones.every(([x, y]) => {
          const value = heatmap[this.index(x, y)];
          return group.color === 1 ? value < 0.5 : value > 0.5;
        });
      };
