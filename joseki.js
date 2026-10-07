// Local joseki library loader.
// Primary source: Kogo's Joseki Dictionary stored in this repository.
// No live requests to OGS are made during activation.

const JOSEKI_LIBRARY_NAME = "Kogo's Joseki Dictionary";
const LOCAL_JOSEKI_SGF_URL = "data/joseki/Kogo%27s%20Joseki%20Dictionary.sgf?v=20261007-1";

function extractSgfComment(rawNode) {
  if (!rawNode || !rawNode.C || !rawNode.C.length) return "";
  return rawNode.C.join("\n");
}

function extractSgfLabels(rawNode, size) {
  if (!rawNode || !Array.isArray(rawNode.LB)) return [];

  return rawNode.LB.map(value => {
    const text = String(value || "");
    const separator = text.indexOf(":");
    if (separator <= 0) return null;

    const pointText = text.slice(0, separator);
    const label = text.slice(separator + 1);
    if (!label) return null;

    try {
      const point = sgfPointToXY(pointText, size);
      if (point.pass) return null;
      return { x: point.x, y: point.y, label };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function applyKogoNodeMetadata(treeNode, rawNode, size) {
  if (!treeNode || !rawNode) return;

  const labels = extractSgfLabels(rawNode, size);
  const comment = extractSgfComment(rawNode);
  const hasContextSetup = Boolean(
    (rawNode.AB && rawNode.AB.length) ||
    (rawNode.AW && rawNode.AW.length) ||
    (rawNode.AE && rawNode.AE.length)
  );

  treeNode.josekiMeta = {
    ...(treeNode.josekiMeta || {}),
    comment: comment || (treeNode.josekiMeta && treeNode.josekiMeta.comment) || "",
    labels: labels.length ? labels : ((treeNode.josekiMeta && treeNode.josekiMeta.labels) || []),
    hasContextSetup
  };
}

/*
 * GameTree stores only move nodes, while Kogo also has informational nodes
 * containing labels/comments without a move. Attach such metadata to the
 * current GameTree position, so the original A/B/C... choice labels remain
 * available on our board.
 */
function decorateTreeFromKogoSgf(rawTree, gameTree) {
  const queue = [{ rawTree, treeNode: gameTree.root }];

  while (queue.length) {
    const { rawTree: rt, treeNode } = queue.shift();
    const sequence = Array.isArray(rt.sequence) ? rt.sequence : [];
    let cursor = treeNode;

    for (const rawNode of sequence) {
      const move = moveFromSgfNode(rawNode, gameTree.meta.size);

      if (!move) {
        applyKogoNodeMetadata(cursor, rawNode, gameTree.meta.size);
        continue;
      }

      const child = cursor.children.find(candidate => gameTree.sameMove(candidate.move, move));
      if (!child) continue;

      cursor = child;
      applyKogoNodeMetadata(cursor, rawNode, gameTree.meta.size);
    }

    const variations = Array.isArray(rt.variations) ? rt.variations : [];
    for (const variation of variations) {
      queue.push({ rawTree: variation, treeNode: cursor });
    }
  }
}

async function loadLocalJosekiSgf() {
  const response = await fetch(LOCAL_JOSEKI_SGF_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Локальный SGF не загружен: HTTP ${response.status}`);
  }

  const sgf = await response.text();

  // Защита от старого закэшированного OGS-файла. Раньше он содержал
  // координаты вроде "ot", которые не являются точками доски 19×19.
  if (!/GN\[Kogo's Joseki Dictionary\]/i.test(sgf)) {
    throw new Error("Загружена не Kogo's Joseki Dictionary. Обновите страницу без кэша.");
  }

  return sgf;
}

(function setupJosekiPanel() {
  const activateButton = document.getElementById("activateJoseki");
  const status = document.getElementById("josekiStatus");
  if (!activateButton || !status) return;

  activateButton.addEventListener("click", async () => {
    if (activateButton.disabled) return;
    activateButton.disabled = true;

    try {
      status.textContent = `Загружаю ${JOSEKI_LIBRARY_NAME}…`;

      const sgf = await loadLocalJosekiSgf();

      if (typeof window.loadSgfTextIntoGame !== "function") {
        throw new Error("Модуль загрузки SGF ещё не инициализирован.");
      }

      const result = window.loadSgfTextIntoGame(sgf, {
        sourceName: JOSEKI_LIBRARY_NAME,
        focusDepth: 0,
        josekiMode: true
      });

      const parsed = parseSgfGameWithVariations(sgf);
      decorateTreeFromKogoSgf(parsed.rawTree, window.goGameTree);

      window.josekiModeActive = true;
      window.currentJosekiSgf = sgf;
      window.currentJosekiLibraryName = JOSEKI_LIBRARY_NAME;

      if (typeof window.refreshJosekiChoices === "function") {
        window.refreshJosekiChoices();
      }

      const variants = window.goGameTree?.current?.children?.length || 0;
      status.textContent =
        `${JOSEKI_LIBRARY_NAME} активирован. В дереве ${result.nodeCount} узлов. ` +
        `В текущей позиции вариантов: ${variants}.`;
    } catch (error) {
      console.error("Local joseki load failed:", error);
      status.textContent = `Ошибка загрузки джосеки: ${error.message}`;
    } finally {
      activateButton.disabled = false;
    }
  });
})();
