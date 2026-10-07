// Standalone joseki page.
// Intentionally isolated from the main application's game/OGS/bot/network controllers.

const JOSEKI_LIBRARY_NAME = "Kogo's Joseki Dictionary";
const JOSEKI_SGF_URL = "data/joseki/Kogo%27s%20Joseki%20Dictionary.sgf?v=20261007-2";

const board = new GoBoard(document.getElementById("board"), 19);
const gameTree = new GameTree({ size: 19, komi: 0, initialTurn: 1 });
const activateButton = document.getElementById("activateJoseki");
const status = document.getElementById("josekiStatus");

let active = false;

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

function refreshChoices() {
  if (!active) {
    board.setJosekiChoices([]);
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
  } finally {
    activateButton.disabled = false;
  }
}

function deactivate() {
  active = false;
  activateButton.textContent = "Активировать";
  board.setJosekiChoices([]);
  board.setSize(19);
  status.textContent = "Источник: Kogo's Joseki Dictionary.";
}

activateButton.addEventListener("click", () => {
  if (active) deactivate();
  else activate();
});

board.onIntersection = (x, y) => {
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
  if (!active) return;
  event.preventDefault();

  if (event.deltaY < 0) {
    if (gameTree.current.parent) restorePosition(gameTree.current.parent);
    return;
  }

  const next = gameTree.current.preferredChild || gameTree.current.children[0];
  if (next) restorePosition(next);
}, { passive: false });

requestAnimationFrame(() => board.draw());
