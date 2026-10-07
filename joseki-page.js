// Standalone Josekipedia page.
// Uses a local full Josekipedia dump when available and falls back to Josekipedia's
// public node endpoint while the dump is being generated.

const JOSEKI_LIBRARY_NAME = "Josekipedia";
const JOSEKIPEDIA_DB_URL = "data/joseki/josekipedia.json?v=20261007-1";
const JOSEKIPEDIA_NODE_URL = "https://www.josekipedia.com/db/node.php";
const STUDY_ROUND_COUNT = 6;

const TYPE_NAMES = {
  0: "IDEAL",
  1: "GOOD",
  2: "MISTAKE",
  3: "TRICK",
  4: "QUESTION"
};

const board = new GoBoard(document.getElementById("board"), 19);
const activateButton = document.getElementById("activateJoseki");
const studyButton = document.getElementById("studyJoseki");
const finishStudyButton = document.getElementById("finishJosekiStudy");
const status = document.getElementById("josekiStatus");
const studyStatus = document.getElementById("josekiStudyStatus");

let active = false;
let localDb = null;
let sourceMode = "none";
const nodeCache = new Map();

const browse = {
  rootId: 1,
  currentId: 1,
  path: [],
  choices: []
};

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
  savedPath: []
};

function oppositeColor(color) {
  return Number(color) === 2 ? 1 : 2;
}

function expectedNextColor() {
  if (!browse.path.length) return 1;
  return oppositeColor(browse.path[browse.path.length - 1].move.color);
}

function normalizeMove(raw, fallbackPoint = null, fallbackColor = null) {
  if (!raw && !fallbackPoint) return null;

  let color = fallbackColor;
  let point = fallbackPoint;

  if (raw) {
    if (raw.color === 1 || raw.color === 2) color = Number(raw.color);
    if (raw.point != null) point = String(raw.point);
    if (raw.B) {
      color = 1;
      point = String(raw.B);
    } else if (raw.W) {
      color = 2;
      point = String(raw.W);
    }
  }

  if (!point) return null;

  try {
    const xy = sgfPointToXY(point, 19);
    return {
      color: color === 2 ? 2 : (color === 1 ? 1 : null),
      pass: Boolean(xy.pass),
      x: xy.pass ? null : xy.x,
      y: xy.pass ? null : xy.y,
      point
    };
  } catch (_) {
    return null;
  }
}

function normalizeStoredNode(raw) {
  if (!raw) return null;
  return {
    id: Number(raw.id),
    type: Number.isFinite(Number(raw.type)) ? Number(raw.type) : null,
    move: normalizeMove(raw.move),
    children: Array.isArray(raw.children) ? raw.children.map(edge => ({
      id: Number(edge.id),
      type: Number.isFinite(Number(edge.type)) ? Number(edge.type) : null,
      move: normalizeMove(edge.move)
    })).filter(edge => Number.isFinite(edge.id)) : [],
    ghosts: Array.isArray(raw.ghosts) ? raw.ghosts.map(edge => ({
      id: Number(edge.id),
      type: Number.isFinite(Number(edge.type)) ? Number(edge.type) : null,
      move: normalizeMove(edge.move, edge.move?.point || null, null)
    })).filter(edge => Number.isFinite(edge.id)) : []
  };
}

function normalizeLiveNode(raw) {
  if (!raw) return null;

  const children = Array.isArray(raw._children)
    ? raw._children.map(edge => ({
        id: Number(edge._id ?? edge.id),
        type: Number.isFinite(Number(edge._mtype)) ? Number(edge._mtype) : null,
        move: normalizeMove(edge)
      })).filter(edge => Number.isFinite(edge.id))
    : [];

  const ghosts = Array.isArray(raw._ghosts)
    ? raw._ghosts.map(edge => ({
        id: Number(edge.id),
        type: Number.isFinite(Number(edge.mtype)) ? Number(edge.mtype) : null,
        move: normalizeMove(null, edge.loc ? String(edge.loc) : null, null)
      })).filter(edge => Number.isFinite(edge.id))
    : [];

  return {
    id: Number(raw._id),
    type: Number.isFinite(Number(raw._mtype)) ? Number(raw._mtype) : null,
    move: normalizeMove(raw),
    children,
    ghosts
  };
}

async function fetchLiveNode(id) {
  const url = `${JOSEKIPEDIA_NODE_URL}?id=${encodeURIComponent(id)}&pid=0`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Josekipedia API: HTTP ${response.status}`);
  return normalizeLiveNode(await response.json());
}

async function getNode(id) {
  const key = String(id);

  if (nodeCache.has(key)) return nodeCache.get(key);

  if (localDb?.nodes?.[key]) {
    const node = normalizeStoredNode(localDb.nodes[key]);
    nodeCache.set(key, node);
    return node;
  }

  return null;
}

async function loadJosekipediaSource() {
  localDb = null;
  nodeCache.clear();

  const response = await fetch(JOSEKIPEDIA_DB_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Локальная база Josekipedia недоступна: HTTP ${response.status}`);
  }

  const db = await response.json();
  if (!db?.nodes?.["1"]) {
    throw new Error("В локальной базе Josekipedia нет корневого узла.");
  }

  localDb = db;
  sourceMode = "local";
}

function resetBoard() {
  board.setSize(19);
  board.sgfKomi = 0;
  board.sgfSetup = { black: [], white: [] };
  board.history = [];
  board.lastMove = null;
  board.captures = { 1: 0, 2: 0 };
  board.positionHistory = [board.positionKey()];
}

function playMoveOnBoard(move) {
  if (!move) return false;
  if (move.pass) {
    board.playPass(move.color, false);
    return true;
  }
  const result = board.playStone(move.x, move.y, move.color, false);
  return Boolean(result?.ok);
}

async function restoreBrowsePosition() {
  resetBoard();

  for (let i = 0; i < browse.path.length; i += 1) {
    const item = browse.path[i];
    if (!playMoveOnBoard(item.move)) {
      throw new Error(`Не удалось восстановить ход №${i + 1}`);
    }
  }

  browse.currentId = browse.path.length
    ? browse.path[browse.path.length - 1].childId
    : browse.rootId;

  await refreshChoices();
  board.draw();
}

function currentSequence() {
  return browse.path.map(item => ({ ...item.move }));
}

function updateStudyAvailability() {
  if (!studyButton) return;
  studyButton.disabled = !active || study.active || browse.path.length === 0;
}

function categoryForType(type) {
  return TYPE_NAMES[Number(type)] || "";
}

async function buildChoicesForNode(node) {
  if (!node) return [];

  const nextColor = expectedNextColor();
  const rawEdges = [...(node.children || [])];
  const byPoint = new Map();

  for (const edge of rawEdges) {
    if (localDb && !localDb.nodes?.[String(edge.id)]) continue;

    let move = edge.move ? { ...edge.move } : null;

    if (!move && localDb?.nodes?.[String(edge.id)]) {
      move = normalizeMove(localDb.nodes[String(edge.id)]?.move);
    }

    if (!move && nodeCache.has(String(edge.id))) {
      move = nodeCache.get(String(edge.id))?.move || null;
    }

    if (!move) continue;
    if (move.color !== 1 && move.color !== 2) move.color = nextColor;
    if (move.pass) continue;

    const key = `${move.x},${move.y}`;
    const existing = byPoint.get(key);

    const normalized = {
      childId: edge.id,
      type: edge.type,
      move: {
        color: move.color || nextColor,
        pass: false,
        x: move.x,
        y: move.y,
        point: move.point
      },
      x: move.x,
      y: move.y,
      label: "",
      category: categoryForType(edge.type)
    };

    if (!existing || (existing.type !== 0 && normalized.type === 0)) {
      byPoint.set(key, normalized);
    }
  }

  return [...byPoint.values()];
}

async function refreshChoices() {
  if (!active || study.active) {
    browse.choices = [];
    board.setJosekiChoices([]);
    updateStudyAvailability();
    return;
  }

  const node = await getNode(browse.currentId);

  if (!node) {
    browse.choices = [];
    board.setJosekiChoices([]);
    status.textContent = "Для этой ветки пока нет локальных данных Josekipedia.";
    updateStudyAvailability();
    return;
  }

  browse.choices = await buildChoicesForNode(node);

  board.setJosekiChoices(
    browse.choices.map(choice => ({
      x: choice.x,
      y: choice.y,
      label: choice.label,
      category: choice.category
    }))
  );

  const sourceText = sourceMode === "local"
    ? `локальная база · ${localDb.nodeCount || Object.keys(localDb.nodes || {}).length} узлов`
    : "Josekipedia API";

  status.textContent =
    `${JOSEKI_LIBRARY_NAME} · ${sourceText} · текущий ход ${browse.path.length} · вариантов: ${browse.choices.length}.`;

  updateStudyAvailability();
}

async function chooseAt(x, y) {
  const choice = browse.choices.find(item => item.x === x && item.y === y);

  if (!choice) {
    status.textContent = "Этого хода нет среди вариантов текущей позиции Josekipedia.";
    return;
  }

  let move = { ...choice.move };

  if (move.color !== 1 && move.color !== 2) {
    const target = await getNode(choice.childId);
    if (target?.move?.color === 1 || target?.move?.color === 2) {
      move.color = target.move.color;
    } else {
      move.color = expectedNextColor();
    }
  }

  browse.path.push({
    parentId: browse.currentId,
    childId: choice.childId,
    type: choice.type,
    move
  });

  await restoreBrowsePosition();
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
        19
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
  resetBoard();
  board.draw();
}

function applyStudyMove(move) {
  return playMoveOnBoard(move);
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
    const move = transformStudyMove(study.sequence[study.moveIndex], round);
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

  const firstMove = sequence[0];
  if (!firstMove || (firstMove.color !== 1 && firstMove.color !== 2)) return;

  study.active = true;
  study.completed = false;
  study.sequence = sequence.map(move => ({ ...move }));
  study.sourceCorner = detectSequenceCorner(sequence, 19);
  study.sourceStartColor = firstMove.color;
  study.savedPath = browse.path.map(item => ({
    ...item,
    move: { ...item.move }
  }));
  study.roundIndex = 0;
  study.moveIndex = 0;
  study.firstHumanMoveIndex = -1;
  study.rounds = buildStudyRounds();

  if (finishStudyButton) finishStudyButton.hidden = true;
  board.setJosekiChoices([]);
  updateStudyAvailability();
  startStudyRound();
}

async function finishStudy({ restore = true } = {}) {
  if (!study.active) return;

  const savedPath = study.savedPath.map(item => ({
    ...item,
    move: { ...item.move }
  }));

  study.active = false;
  study.completed = false;
  study.sequence = [];
  study.rounds = [];
  study.roundIndex = 0;
  study.moveIndex = 0;
  study.firstHumanMoveIndex = -1;
  study.savedPath = [];

  board.setJosekiChoices([]);

  if (finishStudyButton) finishStudyButton.hidden = true;
  if (studyStatus) {
    studyStatus.hidden = true;
    studyStatus.textContent = "";
  }

  if (restore) {
    browse.path = savedPath;
    await restoreBrowsePosition();
  } else {
    updateStudyAvailability();
  }
}

async function activate() {
  activateButton.disabled = true;
  status.textContent = "Загружаю Josekipedia…";

  try {
    await loadJosekipediaSource();

    browse.rootId = Number(localDb?.rootId || 1);
    browse.currentId = browse.rootId;
    browse.path = [];

    active = true;
    activateButton.textContent = "Деактивировать";

    await restoreBrowsePosition();
  } catch (error) {
    active = false;
    status.textContent = `Ошибка загрузки Josekipedia: ${error.message}`;
    updateStudyAvailability();
  } finally {
    activateButton.disabled = false;
  }
}

async function deactivate() {
  if (study.active) await finishStudy({ restore: false });

  active = false;
  browse.path = [];
  browse.currentId = browse.rootId;
  browse.choices = [];
  board.setJosekiChoices([]);
  board.setSize(19);
  activateButton.textContent = "Активировать";
  status.textContent = "Источник: Josekipedia.";
  updateStudyAvailability();
}

activateButton.addEventListener("click", async () => {
  if (active) await deactivate();
  else await activate();
});

if (studyButton) studyButton.addEventListener("click", startStudy);
if (finishStudyButton) {
  finishStudyButton.addEventListener("click", () => {
    finishStudy({ restore: true }).catch(error => {
      status.textContent = `Ошибка восстановления позиции: ${error.message}`;
    });
  });
}

board.onIntersection = (x, y) => {
  if (study.active) {
    handleStudyIntersection(x, y);
    return;
  }

  if (!active) return;

  chooseAt(x, y).catch(error => {
    status.textContent = `Ошибка Josekipedia: ${error.message}`;
  });
};

board.canvas.addEventListener("wheel", event => {
  if (!active || study.active) return;

  event.preventDefault();

  if (event.deltaY < 0) {
    if (!browse.path.length) return;
    browse.path.pop();
    restoreBrowsePosition().catch(error => {
      status.textContent = `Ошибка восстановления позиции: ${error.message}`;
    });
    return;
  }

  const next = browse.choices
    .slice()
    .sort((a, b) => {
      const aa = a.type === 0 ? -1 : Number(a.type ?? 99);
      const bb = b.type === 0 ? -1 : Number(b.type ?? 99);
      return aa - bb;
    })[0];

  if (next) {
    chooseAt(next.x, next.y).catch(error => {
      status.textContent = `Ошибка Josekipedia: ${error.message}`;
    });
  }
}, { passive: false });

updateStudyAvailability();
requestAnimationFrame(() => board.draw());
