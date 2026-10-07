// Local joseki library loader.
// Uses a static SGF snapshot derived from OGS Joseki Explorer node 15081.
// No live requests to OGS are made during normal activation.

const OGS_JOSEKI_ROOT_ID = "15081";
const LOCAL_JOSEKI_SGF_URL = "data/joseki/ogs-15081.sgf";

function parseOgsNodeIdFromComment(comment) {
  const text = String(comment || "");
  const match = text.match(/(?:OGS Joseki node:\s*|OGS position\s*|OGS Joseki Explorer position\s*)(\d+)/i);
  return match ? match[1] : null;
}

function extractSgfComment(rawNode) {
  if (!rawNode || !rawNode.C || !rawNode.C.length) return "";
  return rawNode.C.join("\n");
}

function decorateTreeFromSgf(rawTree, gameTree) {
  const queue = [{ rawTree, treeNode: gameTree.root }];
  while (queue.length) {
    const { rawTree: rt, treeNode } = queue.shift();
    const sequence = Array.isArray(rt.sequence) ? rt.sequence : [];
    let cursor = treeNode;

    for (const rawNode of sequence) {
      const move = moveFromSgfNode(rawNode, gameTree.meta.size);
      if (!move) {
        const nodeId = parseOgsNodeIdFromComment(extractSgfComment(rawNode));
        if (nodeId) cursor.josekiMeta = { ...(cursor.josekiMeta || {}), nodeId };
        continue;
      }

      const child = cursor.children.find(candidate => gameTree.sameMove(candidate.move, move));
      if (!child) continue;

      const comment = extractSgfComment(rawNode);
      const nodeId = parseOgsNodeIdFromComment(comment);
      child.josekiMeta = {
        ...(child.josekiMeta || {}),
        nodeId,
        comment
      };
      cursor = child;
    }

    const variations = Array.isArray(rt.variations) ? rt.variations : [];
    for (const variation of variations) queue.push({ rawTree: variation, treeNode: cursor });
  }
}

async function loadLocalJosekiSgf() {
  const response = await fetch(LOCAL_JOSEKI_SGF_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Локальный SGF не загружен: HTTP ${response.status}`);
  return response.text();
}

(function setupJosekiPanel() {
  const activateButton = document.getElementById("activateJoseki");
  const status = document.getElementById("josekiStatus");
  if (!activateButton || !status) return;

  activateButton.addEventListener("click", async () => {
    if (activateButton.disabled) return;
    activateButton.disabled = true;

    try {
      status.textContent = "Загружаю локальную библиотеку джосеки…";

      const sgf = await loadLocalJosekiSgf();

      if (typeof window.loadSgfTextIntoGame !== "function") {
        throw new Error("Модуль загрузки SGF ещё не инициализирован.");
      }

      const result = window.loadSgfTextIntoGame(sgf, {
        sourceName: `Локальная библиотека OGS Joseki ${OGS_JOSEKI_ROOT_ID}`,
        focusDepth: 0,
        josekiMode: true
      });

      const parsed = parseSgfGameWithVariations(sgf);
      decorateTreeFromSgf(parsed.rawTree, window.goGameTree);
      window.josekiModeActive = true;
      window.currentJosekiSgf = sgf;
      window.currentJosekiRootId = OGS_JOSEKI_ROOT_ID;

      if (typeof window.refreshJosekiChoices === "function") {
        window.refreshJosekiChoices();
      }

      const variants = window.goGameTree?.current?.children?.length || 0;
      status.textContent =
        `Джосеки активировано локально. OGS #${OGS_JOSEKI_ROOT_ID}: ` +
        `в дереве ${result.nodeCount} узлов. В текущей позиции вариантов: ${variants}.`;
    } catch (error) {
      console.error("Local joseki load failed:", error);
      status.textContent = `Ошибка загрузки джосеки: ${error.message}`;
    } finally {
      activateButton.disabled = false;
    }
  });
})();
