// OGS Joseki Explorer importer.
// Downloads the subtree that starts at OGS OJE node 15081, converts it to
// a single SGF with variations and keeps the SGF in browser memory.

const OGS_JOSEKI_ROOT_ID = "15081";
const OGS_JOSEKI_MAX_NODES = 30000;
const OGS_JOSEKI_CONCURRENCY = 2;
const OGS_JOSEKI_REQUEST_DELAY_MS = 120;

const ogsJosekiNodeCache = new Map();
let ogsJosekiTransport = "unknown"; // unknown | direct | proxy
let cachedJosekiImport = null;

function josekiSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeSgfValue(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, "\\n");
}

function normalizeOjeMoveToken(value) {
  const token = String(value == null ? "" : value).trim().toLowerCase();
  if (!token || token === "pass") return "";
  if (!/^[a-s]{2}$/.test(token)) {
    throw new Error(`Неизвестная координата OGS Joseki: ${value}`);
  }
  return token;
}

function parseOjePlay(play) {
  const parts = String(play || "")
    .split(".")
    .map(part => part.trim())
    .filter(Boolean);

  const rootIndex = parts.indexOf("root");
  const moves = rootIndex >= 0 ? parts.slice(rootIndex + 1) : parts;
  return moves.map(normalizeOjeMoveToken);
}

function prettyOgsCoordinateToSgf(value, size = 19) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || text === "PASS") return "";

  const match = text.match(/^([A-HJ-T])(\d{1,2})$/);
  if (!match) throw new Error(`Не удалось преобразовать координату OGS: ${value}`);

  const columns = "ABCDEFGHJKLMNOPQRST";
  const x = columns.indexOf(match[1]);
  const row = Number(match[2]);
  const y = size - row;

  if (x < 0 || y < 0 || x >= size || y >= size) {
    throw new Error(`Координата OGS вне доски: ${value}`);
  }

  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

function getOjeChildren(dto) {
  return Array.isArray(dto && dto.next_moves)
    ? dto.next_moves.filter(move => move && move.node_id !== undefined && move.node_id !== null)
    : [];
}

function normalizeOjeNodeId(id) {
  const value = String(id == null ? "" : id).trim();
  if (!/^(?:root|\d+)$/.test(value)) throw new Error(`Некорректный OGS Joseki node id: ${id}`);
  return value;
}

async function fetchOjeNodeDirect(id) {
  const url = new URL("https://online-go.com/oje/position");
  url.searchParams.set("id", id);
  url.searchParams.set("mode", "0");

  const response = await fetch(url.href, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) throw new Error(`OGS OJE: HTTP ${response.status}`);
  return response.json();
}

async function fetchOjeNodeProxy(id) {
  if (!NETWORK_SERVER_URL) {
    throw new Error("Cloudflare Worker не настроен: отсутствует NETWORK_SERVER_URL.");
  }

  const url = new URL(NETWORK_SERVER_URL + "/api/ogs-joseki/node");
  url.searchParams.set("id", id);

  const response = await fetch(url.href, {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    throw new Error(data && data.error ? data.error : `Прокси OGS Joseki: HTTP ${response.status}`);
  }
  return data;
}

async function fetchOjeNode(rawId) {
  const id = normalizeOjeNodeId(rawId);
  if (ogsJosekiNodeCache.has(id)) return ogsJosekiNodeCache.get(id);

  let dto;

  if (ogsJosekiTransport !== "proxy") {
    try {
      dto = await fetchOjeNodeDirect(id);
      ogsJosekiTransport = "direct";
    } catch (directError) {
      ogsJosekiTransport = "proxy";
    }
  }

  if (!dto) dto = await fetchOjeNodeProxy(id);

  if (!dto || typeof dto !== "object") {
    throw new Error(`OGS вернул пустой узел Joseki ${id}.`);
  }

  const returnedId = String(dto.node_id == null ? "" : dto.node_id);
  if (id !== "root" && returnedId && returnedId !== id) {
    throw new Error(`OGS вернул узел ${returnedId} вместо ${id}.`);
  }

  ogsJosekiNodeCache.set(id, dto);
  if (returnedId && returnedId !== id) ogsJosekiNodeCache.set(returnedId, dto);
  return dto;
}

async function collectOjeSubtree(rootId, onProgress) {
  const normalizedRoot = normalizeOjeNodeId(rootId);
  const nodes = new Map();
  const queued = new Set([normalizedRoot]);
  const queue = [normalizedRoot];
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= queue.length) return;

      const id = queue[index];
      const dto = await fetchOjeNode(id);
      nodes.set(id, dto);

      for (const child of getOjeChildren(dto)) {
        const childId = normalizeOjeNodeId(child.node_id);
        if (queued.has(childId)) continue;
        queued.add(childId);
        queue.push(childId);

        if (queued.size > OGS_JOSEKI_MAX_NODES) {
          throw new Error(`Дерево OGS Joseki больше лимита ${OGS_JOSEKI_MAX_NODES} узлов.`);
        }
      }

      if (typeof onProgress === "function") {
        onProgress({ loaded: nodes.size, queued: queue.length, transport: ogsJosekiTransport });
      }

      await josekiSleep(OGS_JOSEKI_REQUEST_DELAY_MS);
    }
  }

  const workers = Array.from(
    { length: Math.min(OGS_JOSEKI_CONCURRENCY, queue.length || 1) },
    () => worker()
  );
  await Promise.all(workers);

  // A worker that was fetching the first item can append work after the other
  // workers have already exited. Finish any tail that remains.
  while (cursor < queue.length) {
    const id = queue[cursor++];
    if (nodes.has(id)) continue;
    const dto = await fetchOjeNode(id);
    nodes.set(id, dto);

    for (const child of getOjeChildren(dto)) {
      const childId = normalizeOjeNodeId(child.node_id);
      if (!queued.has(childId)) {
        queued.add(childId);
        queue.push(childId);
      }
    }

    if (typeof onProgress === "function") {
      onProgress({ loaded: nodes.size, queued: queue.length, transport: ogsJosekiTransport });
    }
    await josekiSleep(OGS_JOSEKI_REQUEST_DELAY_MS);
  }

  return nodes;
}

function ojeMoveTokenBetween(parentDto, childDto, relation) {
  const parentMoves = parseOjePlay(parentDto && parentDto.play);
  const childMoves = parseOjePlay(childDto && childDto.play);

  if (
    childMoves.length === parentMoves.length + 1 &&
    parentMoves.every((move, index) => move === childMoves[index])
  ) {
    return childMoves[childMoves.length - 1];
  }

  return prettyOgsCoordinateToSgf(relation && relation.placement, 19);
}

function ojeMoveColorFromDto(childDto, parentDto) {
  const childMoves = parseOjePlay(childDto && childDto.play);
  if (childMoves.length) return childMoves.length % 2 === 1 ? 1 : 2;

  const parentMoves = parseOjePlay(parentDto && parentDto.play);
  return (parentMoves.length + 1) % 2 === 1 ? 1 : 2;
}

function buildOjeNodeComment(dto, relation) {
  const lines = [];
  if (dto && dto.node_id !== undefined) lines.push(`OGS Joseki node: ${dto.node_id}`);
  if (relation && relation.category) lines.push(`Category: ${relation.category}`);
  if (relation && relation.variation_label) lines.push(`Variation: ${relation.variation_label}`);
  if (dto && dto.description) lines.push(String(dto.description));
  return lines.join("\n");
}

function buildOjeSgf(rootId, nodes) {
  const rootKey = normalizeOjeNodeId(rootId);
  const rootDto = nodes.get(rootKey);
  if (!rootDto) throw new Error(`Корневой OGS Joseki node ${rootKey} не загружен.`);

  const baseMoves = parseOjePlay(rootDto.play);

  function serializeDescendants(parentId) {
    const parentDto = nodes.get(String(parentId));
    if (!parentDto) return "";

    const relations = getOjeChildren(parentDto).filter(relation =>
      nodes.has(String(relation.node_id))
    );
    if (!relations.length) return "";

    const serializeChild = relation => {
      const childId = String(relation.node_id);
      const childDto = nodes.get(childId);
      const token = ojeMoveTokenBetween(parentDto, childDto, relation);
      const color = ojeMoveColorFromDto(childDto, parentDto) === 1 ? "B" : "W";
      const comment = buildOjeNodeComment(childDto, relation);
      let text = `;${color}[${token}]`;
      if (comment) text += `C[${escapeSgfValue(comment)}]`;
      return text + serializeDescendants(childId);
    };

    if (relations.length === 1) return serializeChild(relations[0]);
    return relations.map(relation => `(${serializeChild(relation)})`).join("");
  }

  let sgf =
    `(;GM[1]FF[4]CA[UTF-8]AP[SchoolWeiqi-GoInterfaces:OGS-Joseki]SZ[19]KM[6.5]` +
    `GN[OGS Joseki ${escapeSgfValue(rootKey)}]` +
    `SO[${escapeSgfValue(`https://online-go.com/joseki/${rootKey}`)}]`;

  if (!baseMoves.length) {
    const rootComment = buildOjeNodeComment(rootDto, null);
    if (rootComment) sgf += `C[${escapeSgfValue(rootComment)}]`;
  }

  baseMoves.forEach((token, index) => {
    const color = index % 2 === 0 ? "B" : "W";
    sgf += `;${color}[${token}]`;
    if (index === baseMoves.length - 1) {
      const rootComment = buildOjeNodeComment(rootDto, null);
      if (rootComment) sgf += `C[${escapeSgfValue(rootComment)}]`;
    }
  });

  sgf += serializeDescendants(rootKey);
  sgf += ")";

  return {
    sgf,
    focusDepth: baseMoves.length,
    nodeCount: nodes.size,
    rootId: rootKey
  };
}

async function importOgsJoseki(rootId = OGS_JOSEKI_ROOT_ID, onProgress) {
  const normalizedRoot = normalizeOjeNodeId(rootId);

  if (cachedJosekiImport && cachedJosekiImport.rootId === normalizedRoot) {
    if (typeof onProgress === "function") {
      onProgress({
        loaded: cachedJosekiImport.nodeCount,
        queued: cachedJosekiImport.nodeCount,
        transport: "memory"
      });
    }
    return cachedJosekiImport;
  }

  const nodes = await collectOjeSubtree(normalizedRoot, onProgress);
  cachedJosekiImport = buildOjeSgf(normalizedRoot, nodes);
  window.currentJosekiSgf = cachedJosekiImport.sgf;
  window.currentJosekiRootId = normalizedRoot;
  return cachedJosekiImport;
}

(function setupJosekiPanel() {
  const activateButton = document.getElementById("activateJoseki");
  const status = document.getElementById("josekiStatus");
  if (!activateButton || !status) return;

  activateButton.addEventListener("click", async () => {
    if (activateButton.disabled) return;
    activateButton.disabled = true;

    try {
      status.textContent = "Подключаюсь к OGS Joseki Explorer…";

      const imported = await importOgsJoseki(OGS_JOSEKI_ROOT_ID, progress => {
        const transport =
          progress.transport === "direct"
            ? "OGS"
            : progress.transport === "proxy"
              ? "OGS через Cloudflare"
              : "память";
        status.textContent =
          `Загрузка: ${progress.loaded} из найденных ${progress.queued} позиций · ${transport}.`;
      });

      if (typeof window.loadSgfTextIntoGame !== "function") {
        throw new Error("Модуль загрузки SGF ещё не инициализирован.");
      }

      const result = window.loadSgfTextIntoGame(imported.sgf, {
        sourceName: `OGS Joseki ${imported.rootId}`,
        focusDepth: imported.focusDepth
      });

      status.textContent =
        `Джосеки активировано. OGS #${imported.rootId}: ${imported.nodeCount} позиций, ` +
        `SGF загружен в память, в дереве ${result.nodeCount} узлов.`;
    } catch (error) {
      console.error("OGS Joseki import failed:", error);
      status.textContent = `Ошибка загрузки джосеки: ${error.message}`;
    } finally {
      activateButton.disabled = false;
    }
  });
})();

window.importOgsJoseki = importOgsJoseki;
