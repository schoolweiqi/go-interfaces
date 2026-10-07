// Standalone joseki page.
// Intentionally isolated from the main application's game/OGS/bot/network controllers.

const JOSEKI_LIBRARY_NAME = "Kogo's Joseki Dictionary";
const JOSEKI_SGF_URL = "data/joseki/Kogo%27s%20Joseki%20Dictionary.sgf?v=20261007-2";
const STUDY_ROUND_COUNT = 6;

const board = new GoBoard(document.getElementById("board"), 19);
const gameTree = new GameTree({ size: 19, komi: 0, initialTurn: 1 });
const activateButton = document.getElementById("activateJoseki");
const studyButton = document.getElementById("studyJoseki");
const finishStudyButton = document.getElementById("finishJosekiStudy");
const status = document.getElementById("josekiStatus");
const studyStatus = document.getElementById("josekiStudyStatus");

let active = false;

const study = {
  active: false,
  completed: false,
  sequence: [],
  sourceCorner: "TR",
  sourceStartColor: 1,
  rounds: [],
  roundIndex: 0,
  moveIndex: 0,
  firstHumanMoveIndex: -1,
  savedTreeNode: null
};

function extractLabels(rawNode, size) {
  if (!rawNode || !Array.isArray(rawNode.LB)) return [];

  return rawNode.LB.map(value => {
    const text = String(value || "");
    const split = text.indexOf(":");
    if (split <= 0) return null;

    try {
      const point = sgfPointToXY(text.slice(0, split), size);
      if (point.pass) return null;
      return { x: point.x, y: point.y, label: text.slice(split + 1) };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function decorateTree(rawTree) {
  const queue = [{ rawTree, treeNode: gameTree.root }];

  while (queue.length) {
    const { rawTree: rt, treeNode } = queue.shift();
    let cursor = treeNode;

    for (const rawNode of (rt.sequence || [])) {
      const move = moveFromSgfNode(rawNode, gameTree.meta.size);

      if (!move) {
        const labels = extractLabels(rawNode, gameTree.meta.size);
        if (labels.length) {
          cursor.josekiMeta = { ...(cursor.josekiMeta || {}), labels };
        }
        continue;
      }

      const child = cursor.children.find(candidate => gameTree.sameMove(candidate.move, move));
      if (!child) continue;

      cursor = child;
      const labels = extractLabels(rawNode, gameTree.meta.size);
      cursor.josekiMeta = {
        ...(cursor.josekiMeta || {}),
        labels: labels.length ? labels : ((cursor.josekiMeta && cursor.josekiMeta.labels) || [])
      };
    }

    for (const variation of (rt.variations || [])) {
      queue.push({ rawTree: variation, treeNode: cursor });
    }
  }
}

function resetBoard() {
  board.setSize(gameTree.meta.size);
  board.sgfKomi = gameTree.meta.komi;
  board.sgfSetup = {
    black: gameTree.meta.setupBlack.map(p => p.slice()),
    white: gameTree.meta.setupWhite.map(p => p.slice())
  };

  for (const [x, y] of gameTree.meta.setupBlack) board.setStone(x, y, 1);
  for (const [x, y] of gameTree.meta.setupWhite) board.setStone(x, y, 2);

  board.history = [];
  board.lastMove = null;
  board.captures = { 1: 0, 2: 0 };
  board.positionHistory = [board.positionKey()];
}

function restorePosition(node) {
  gameTree.select(node);
  resetBoard();

  for (const treeNode of gameTree.pathTo(node)) {
    const move = treeNode.move;
    if (move.pass) {
      board.playPass(move.color, false);
    } else {
      const result = board.playStone(move.x, move.y, move.color, false);
      if (!result.ok) {
        throw new Error(`Не удалось восстановить ход №${treeNode.depth}: ${result.reason}`);
      }
    }
  }

  refreshChoices();
  board.draw();
}

function currentSequence() {
  return gameTree.pathTo(gameTree.current).map(node => ({
    color: Number(node.move.color),
    pass: Boolean(node.move.pass),
    x: node.move.pass ? null : Number(node.move.x),
    y: node.move.pass ? null : Number(node.move.y)
  }));
}

function updateStudyAvailability() {
  if (!studyButton) return;
  studyButton.disabled = !active || study.active || currentSequence().length === 0;
}

function refreshChoices() {
  if (!active || study.active) {
    board.setJosekiChoices([]);
    updateStudyAvailability();
    return;
  }

  const labels = Array.isArray(gameTree.current.josekiMeta?.labels)
    ? gameTree.current.josekiMeta.labels
    : [];

  const choices = gameTree.current.children
    .filter(child => child.move && !child.move.pass)
    .map((child, index) => {
      const sourceLabel = labels.find(item =>
        item.x === child.move.x && item.y === child.move.y
      );

      return {
        x: child.move.x,
        y: child.move.y,
        label: sourceLabel?.label || String(index + 1),
        category: ""
      };
    });

  board.setJosekiChoices(choices);
  status.textContent =
    `${JOSEKI_LIBRARY_NAME} · текущий ход ${gameTree.current.depth} · вариантов: ${choices.length}.`;
  updateStudyAvailability();
}

function detectSequenceCorner(sequence, size = 19) {
  const points = sequence.filter(move => !move.pass);
  if (!points.length) return "TR";

  const avgX = points.reduce((sum, move) => sum + move.x, 0) / points.length;
  const avgY = points.reduce((sum, move) => sum + move.y, 0) / points.length;

  return (avgY < (size - 1) / 2 ? "T" : "B") +
         (avgX < (size - 1) / 2 ? "L" : "R");
}

function transformPointToCorner(x, y, fromCorner, toCorner, size = 19) {
  let tx = x;
  let ty = y;
  if (fromCorner[1] !== toCorner[1]) tx = size - 1 - tx;
  if (fromCorner[0] !== toCorner[0]) ty = size - 1 - ty;
  return { x: tx, y: ty };
}

function oppositeColor(color) {
  return Number(color) === 2 ? 1 : 2;
}

function roleForColor(color) {
  return Number(color) === 2 ? "white" : "black";
}

function randomRole() {
  return Math.random() < 0.5 ? "black" : "white";
}

function randomCorner() {
  const corners = ["TL", "TR", "BL", "BR"];
  return corners[Math.floor(Math.random() * corners.length)];
}

function shuffled(values) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function roleLabel(role) {
  if (role === "black") return "играйте чёрными";
  if (role === "white") return "играйте белыми";
  return "играйте за оба цвета";
}

function colorStartLabel(color) {
  return Number(color) === 2 ? "начинают белые" : "начинают чёрные";
}

function cornerLabel(corner) {
  return ({
    TL: "левый верхний",
    TR: "правый верхний",
    BL: "левый нижний",
    BR: "правый нижний"
  })[corner] || corner;
}

function transformStudyMove(sourceMove, round) {
  const swapColors = round.startColor !== study.sourceStartColor;
  const transformed = {
    ...sourceMove,
    color: swapColors ? oppositeColor(sourceMove.color) : sourceMove.color
  };

  if (!sourceMove.pass) {
    Object.assign(
      transformed,
      transformPointToCorner(
        sourceMove.x,
        sourceMove.y,
        study.sourceCorner,
        round.corner,
        gameTree.meta.size
      )
    );
  }

  return transformed;
}

function isHumanStudyMove(move, role) {
  if (role === "both") return true;
  return role === "black" ? move.color === 1 : move.color === 2;
}

function clearStudyBoard() {
  board.setJosekiChoices([]);
  board.setSize(gameTree.meta.size);
  board.sgfKomi = 0;
  board.sgfSetup = { black: [], white: [] };
  board.history = [];
  board.lastMove = null;
  board.captures = { 1: 0, 2: 0 };
  board.positionHistory = [board.positionKey()];
  board.draw();
}

function applyStudyMove(move) {
  if (move.pass) {
    board.playPass(move.color, false);
    return true;
  }

  const result = board.playStone(move.x, move.y, move.color, false);
  return Boolean(result && result.ok);
}

function setStudyHintForCurrentMove() {
  board.setJosekiChoices([]);
  if (!study.active || study.completed) return;
  if (study.moveIndex !== study.firstHumanMoveIndex) return;

  const round = study.rounds[study.roundIndex];
  const sourceMove = study.sequence[study.moveIndex];
  if (!round || !sourceMove) return;

  const move = transformStudyMove(sourceMove, round);
  if (move.pass) return;

  board.setJosekiChoices([{
    x: move.x,
    y: move.y,
    label: "",
    category: "STUDY_HINT"
  }]);
}

function updateStudyStatus(extra = "") {
  if (!studyStatus || !study.active) return;

  const round = study.rounds[study.roundIndex];
  studyStatus.hidden = false;

  if (!round) {
    studyStatus.textContent = extra || "Все шесть повторений выполнены.";
    return;
  }

  const prefix =
    `Повторение ${study.roundIndex + 1} из ${STUDY_ROUND_COUNT} · ` +
    `${roleLabel(round.role)} · ${cornerLabel(round.corner)} угол · ${colorStartLabel(round.startColor)}.`;
  studyStatus.textContent = extra ? `${prefix} ${extra}` : prefix;
}

function finishStudyRoundIfDone() {
  if (study.moveIndex < study.sequence.length) return false;

  study.roundIndex += 1;

  if (study.roundIndex >= study.rounds.length) {
    study.completed = true;
    study.moveIndex = study.sequence.length;
    board.setJosekiChoices([]);
    if (finishStudyButton) finishStudyButton.hidden = false;
    updateStudyStatus("Все шесть повторений пройдены успешно. Нажмите «Завершить обучение».");
    board.draw();
    return true;
  }

  startStudyRound();
  return true;
}

function advanceAutomaticStudyMoves() {
  if (!study.active || study.completed) return;

  const round = study.rounds[study.roundIndex];
  if (!round) return;

  while (study.moveIndex < study.sequence.length) {
    const sourceMove = study.sequence[study.moveIndex];
    const move = transformStudyMove(sourceMove, round);
    if (isHumanStudyMove(move, round.role)) break;

    if (!applyStudyMove(move)) {
      updateStudyStatus("Не удалось воспроизвести автоматический ход.");
      board.setJosekiChoices([]);
      board.draw();
      return;
    }

    study.moveIndex += 1;
  }

  if (finishStudyRoundIfDone()) return;

  setStudyHintForCurrentMove();
  updateStudyStatus();
  board.draw();
}

function startStudyRound() {
  if (!study.active || study.completed) return;

  study.moveIndex = 0;
  clearStudyBoard();

  const round = study.rounds[study.roundIndex];
  study.firstHumanMoveIndex = study.sequence.findIndex(sourceMove =>
    isHumanStudyMove(transformStudyMove(sourceMove, round), round.role)
  );

  updateStudyStatus();
  advanceAutomaticStudyMoves();
}

function handleStudyIntersection(x, y) {
  if (!study.active || study.completed) return;

  const round = study.rounds[study.roundIndex];
  const sourceMove = study.sequence[study.moveIndex];
  if (!round || !sourceMove) return;

  const expected = transformStudyMove(sourceMove, round);

  if (!isHumanStudyMove(expected, round.role)) {
    advanceAutomaticStudyMoves();
    return;
  }

  if (expected.pass) {
    updateStudyStatus("В этой позиции ожидается пас.");
    return;
  }

  if (x !== expected.x || y !== expected.y) {
    updateStudyStatus("Неверный ход. Попробуйте ещё раз.");
    return;
  }

  if (!applyStudyMove(expected)) {
    updateStudyStatus("Этот ход сейчас невозможно поставить.");
    return;
  }

  study.moveIndex += 1;
  setStudyHintForCurrentMove();
  board.draw();

  if (!finishStudyRoundIfDone()) {
    advanceAutomaticStudyMoves();
  }
}

function buildStudyRounds() {
  const firstRole = roleForColor(study.sourceStartColor);
  const secondRole = roleForColor(oppositeColor(study.sourceStartColor));
  const randomStarts = shuffled([
    1,
    2,
    Math.random() < 0.5 ? 1 : 2
  ]);

  return [
    { role: firstRole, corner: study.sourceCorner, startColor: study.sourceStartColor },
    { role: secondRole, corner: study.sourceCorner, startColor: study.sourceStartColor },
    { role: "both", corner: study.sourceCorner, startColor: study.sourceStartColor },
    { role: randomRole(), corner: randomCorner(), startColor: randomStarts[0] },
    { role: randomRole(), corner: randomCorner(), startColor: randomStarts[1] },
    { role: randomRole(), corner: randomCorner(), startColor: randomStarts[2] }
  ];
}

function startStudy() {
  if (!active || study.active) return;

  const sequence = currentSequence();
  if (!sequence.length) {
    if (studyStatus) {
      studyStatus.hidden = false;
      studyStatus.textContent = "Сначала разложите вариант джосеки, который хотите изучать.";
    }
    updateStudyAvailability();
    return;
  }

  const firstMove = sequence.find(Boolean);
  if (!firstMove || (firstMove.color !== 1 && firstMove.color !== 2)) return;

  study.active = true;
  study.completed = false;
  study.sequence = sequence.map(move => ({ ...move }));
  study.sourceCorner = detectSequenceCorner(sequence, gameTree.meta.size);
  study.sourceStartColor = firstMove.color;
  study.savedTreeNode = gameTree.current;
  study.roundIndex = 0;
  study.moveIndex = 0;
  study.firstHumanMoveIndex = -1;
  study.rounds = buildStudyRounds();

  if (finishStudyButton) finishStudyButton.hidden = true;
  board.setJosekiChoices([]);
  updateStudyAvailability();
  startStudyRound();
}

function finishStudy({ restore = true } = {}) {
  if (!study.active) return;

  const savedNode = study.savedTreeNode;
  study.active = false;
  study.completed = false;
  study.sequence = [];
  study.rounds = [];
  study.roundIndex = 0;
  study.moveIndex = 0;
  study.firstHumanMoveIndex = -1;
  study.savedTreeNode = null;

  board.setJosekiChoices([]);
  if (finishStudyButton) finishStudyButton.hidden = true;
  if (studyStatus) {
    studyStatus.hidden = true;
    studyStatus.textContent = "";
  }

  if (restore && savedNode) restorePosition(savedNode);
  else updateStudyAvailability();
}

async function activate() {
  activateButton.disabled = true;
  status.textContent = `Загружаю ${JOSEKI_LIBRARY_NAME}…`;

  try {
    const response = await fetch(JOSEKI_SGF_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const sgf = await response.text();
    if (!/GN\[Kogo's Joseki Dictionary\]/i.test(sgf)) {
      throw new Error("Файл не распознан как Kogo's Joseki Dictionary.");
    }

    const parsed = parseSgfGameWithVariations(sgf);
    gameTree.importSgf(parsed);
    decorateTree(parsed.rawTree);

    active = true;
    activateButton.textContent = "Деактивировать";
    restorePosition(gameTree.root);
  } catch (error) {
    active = false;
    status.textContent = `Ошибка загрузки джосеки: ${error.message}`;
    updateStudyAvailability();
  } finally {
    activateButton.disabled = false;
  }
}

function deactivate() {
  if (study.active) finishStudy({ restore: false });

  active = false;
  activateButton.textContent = "Активировать";
  board.setJosekiChoices([]);
  board.setSize(19);
  status.textContent = "Источник: Kogo's Joseki Dictionary.";
  updateStudyAvailability();
}

activateButton.addEventListener("click", () => {
  if (active) deactivate();
  else activate();
});

if (studyButton) studyButton.addEventListener("click", startStudy);
if (finishStudyButton) finishStudyButton.addEventListener("click", () => finishStudy({ restore: true }));

board.onIntersection = (x, y) => {
  if (study.active) {
    handleStudyIntersection(x, y);
    return;
  }

  if (!active) return;

  const child = gameTree.current.children.find(node =>
    node.move &&
    !node.move.pass &&
    node.move.x === x &&
    node.move.y === y
  );

  if (!child) {
    status.textContent = "Этого хода нет среди продолжений текущей позиции.";
    return;
  }

  restorePosition(child);
};

board.canvas.addEventListener("wheel", event => {
  if (!active || study.active) return;
  event.preventDefault();

  if (event.deltaY < 0) {
    if (gameTree.current.parent) restorePosition(gameTree.current.parent);
    return;
  }

  const next = gameTree.current.preferredChild || gameTree.current.children[0];
  if (next) restorePosition(next);
}, { passive: false });

updateStudyAvailability();
requestAnimationFrame(() => board.draw());
