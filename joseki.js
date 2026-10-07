// Local joseki library loader and study mode.
// Primary source: Kogo's Joseki Dictionary stored in this repository.

const JOSEKI_LIBRARY_NAME = "Kogo's Joseki Dictionary";
const LOCAL_JOSEKI_SGF_URL = "data/joseki/Kogo%27s%20Joseki%20Dictionary.sgf?v=20261007-2";

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
  if (!/GN\[Kogo's Joseki Dictionary\]/i.test(sgf)) {
    throw new Error("Загружена не Kogo's Joseki Dictionary. Обновите страницу без кэша.");
  }
  return sgf;
}

function getCurrentJosekiSequence() {
  const gameTree = window.goGameTree;
  if (!gameTree || gameTree.current === gameTree.root) return [];

  return gameTree.pathTo(gameTree.current).map(node => ({
    color: Number(node.move.color),
    pass: Boolean(node.move.pass),
    x: node.move.pass ? null : Number(node.move.x),
    y: node.move.pass ? null : Number(node.move.y)
  }));
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

function transformSequenceToCorner(sequence, fromCorner, toCorner, size = 19) {
  return sequence.map(move => {
    if (move.pass) return { ...move };
    const point = transformPointToCorner(move.x, move.y, fromCorner, toCorner, size);
    return { ...move, ...point };
  });
}

function randomStudyRole() {
  const roles = ["black", "white", "both"];
  return roles[Math.floor(Math.random() * roles.length)];
}

function randomCorner() {
  const corners = ["TL", "TR", "BL", "BR"];
  return corners[Math.floor(Math.random() * corners.length)];
}

function roleLabel(role) {
  if (role === "black") return "играйте чёрными";
  if (role === "white") return "играйте белыми";
  return "играйте за оба цвета";
}

function cornerLabel(corner) {
  return ({ TL: "левый верхний", TR: "правый верхний", BL: "левый нижний", BR: "правый нижний" })[corner] || corner;
}

const josekiStudy = {
  active: false,
  sequence: [],
  sourceCorner: "TR",
  rounds: [],
  roundIndex: 0,
  moveIndex: 0,
  savedTreeNode: null,
  originalBoardClick: null
};

function isHumanStudyMove(move, role) {
  if (role === "both") return true;
  return role === "black" ? move.color === 1 : move.color === 2;
}

function clearStudyBoard() {
  const board = window.goBoardInstance;
  if (!board) return;
  board.setSize(19);
  board.sgfKomi = 0;
  board.sgfSetup = { black: [], white: [] };
  board.setJosekiChoices([]);
  board.draw();
}

function applyStudyMove(move) {
  const board = window.goBoardInstance;
  if (!board) return false;

  if (move.pass) {
    board.playPass(move.color, false);
    return true;
  }

  const result = board.playStone(move.x, move.y, move.color, false);
  return Boolean(result && result.ok);
}

function updateStudyStatus(extra = "") {
  const status = document.getElementById("josekiStudyStatus");
  if (!status || !josekiStudy.active) return;

  const round = josekiStudy.rounds[josekiStudy.roundIndex];
  if (!round) {
    status.textContent = extra || "Все шесть повторений выполнены.";
    return;
  }

  const prefix =
    `Повторение ${josekiStudy.roundIndex + 1} из 6 · ${roleLabel(round.role)} · ${cornerLabel(round.corner)} угол.`;
  status.textContent = extra ? `${prefix} ${extra}` : prefix;
}

function finishStudyRoundIfDone() {
  if (josekiStudy.moveIndex < josekiStudy.sequence.length) return false;

  josekiStudy.roundIndex += 1;

  if (josekiStudy.roundIndex >= josekiStudy.rounds.length) {
    josekiStudy.moveIndex = josekiStudy.sequence.length;
    updateStudyStatus("Все шесть повторений пройдены успешно. Нажмите «Завершить обучение».");
    return true;
  }

  startStudyRound();
  return true;
}

function advanceAutomaticStudyMoves() {
  if (!josekiStudy.active) return;

  const round = josekiStudy.rounds[josekiStudy.roundIndex];
  if (!round) return;

  while (josekiStudy.moveIndex < josekiStudy.sequence.length) {
    const sourceMove = josekiStudy.sequence[josekiStudy.moveIndex];
    if (isHumanStudyMove(sourceMove, round.role)) break;

    const transformed = sourceMove.pass
      ? { ...sourceMove }
      : {
          ...sourceMove,
          ...transformPointToCorner(
            sourceMove.x,
            sourceMove.y,
            josekiStudy.sourceCorner,
            round.corner,
            19
          )
        };

    if (!applyStudyMove(transformed)) {
      updateStudyStatus("Не удалось воспроизвести автоматический ход.");
      return;
    }

    josekiStudy.moveIndex += 1;
  }

  if (!finishStudyRoundIfDone()) {
    updateStudyStatus();
    window.goBoardInstance.draw();
  }
}

function startStudyRound() {
  if (!josekiStudy.active) return;

  josekiStudy.moveIndex = 0;
  clearStudyBoard();
  updateStudyStatus();
  advanceAutomaticStudyMoves();
}

function handleStudyIntersection(x, y) {
  if (!josekiStudy.active) return false;

  const round = josekiStudy.rounds[josekiStudy.roundIndex];
  if (!round) return true;

  const expectedSource = josekiStudy.sequence[josekiStudy.moveIndex];
  if (!expectedSource) return true;

  if (!isHumanStudyMove(expectedSource, round.role)) {
    advanceAutomaticStudyMoves();
    return true;
  }

  if (expectedSource.pass) {
    updateStudyStatus("В этой позиции ожидается пас.");
    return true;
  }

  const expected = transformPointToCorner(
    expectedSource.x,
    expectedSource.y,
    josekiStudy.sourceCorner,
    round.corner,
    19
  );

  if (x !== expected.x || y !== expected.y) {
    updateStudyStatus("Неверный ход. Попробуйте ещё раз.");
    return true;
  }

  const move = { ...expectedSource, x, y };
  if (!applyStudyMove(move)) {
    updateStudyStatus("Этот ход сейчас невозможно поставить.");
    return true;
  }

  josekiStudy.moveIndex += 1;
  window.goBoardInstance.draw();

  if (!finishStudyRoundIfDone()) {
    advanceAutomaticStudyMoves();
  }

  return true;
}

function startJosekiStudy() {
  if (!window.josekiModeActive) return;

  const sequence = getCurrentJosekiSequence();
  if (!sequence.length) {
    const status = document.getElementById("josekiStudyStatus");
    if (status) {
      status.hidden = false;
      status.textContent = "Сначала выберите в дереве позицию джосеки, которую хотите изучать.";
    }
    return;
  }

  const current = window.goGameTree.current;
  josekiStudy.savedTreeNode = current;
  josekiStudy.sequence = sequence;
  josekiStudy.sourceCorner = detectSequenceCorner(sequence, 19);
  josekiStudy.roundIndex = 0;
  josekiStudy.moveIndex = 0;
  josekiStudy.rounds = [
    { role: "black", corner: josekiStudy.sourceCorner },
    { role: "white", corner: josekiStudy.sourceCorner },
    { role: "both", corner: josekiStudy.sourceCorner },
    { role: randomStudyRole(), corner: randomCorner() },
    { role: randomStudyRole(), corner: randomCorner() },
    { role: randomStudyRole(), corner: randomCorner() }
  ];
  josekiStudy.active = true;

  window.josekiStudyActive = true;
  window.goBoardInstance.setJosekiChoices([]);

  const finishButton = document.getElementById("finishJosekiStudy");
  const studyButton = document.getElementById("studyJoseki");
  const studyStatus = document.getElementById("josekiStudyStatus");
  if (finishButton) finishButton.hidden = false;
  if (studyButton) studyButton.disabled = true;
  if (studyStatus) studyStatus.hidden = false;

  startStudyRound();
}

function finishJosekiStudy() {
  if (!josekiStudy.active) return;

  josekiStudy.active = false;
  window.josekiStudyActive = false;

  const finishButton = document.getElementById("finishJosekiStudy");
  const studyButton = document.getElementById("studyJoseki");
  const studyStatus = document.getElementById("josekiStudyStatus");

  if (finishButton) finishButton.hidden = true;
  if (studyButton) studyButton.disabled = !window.josekiModeActive;
  if (studyStatus) {
    studyStatus.hidden = true;
    studyStatus.textContent = "";
  }

  if (
    josekiStudy.savedTreeNode &&
    typeof window.restoreJosekiTreePosition === "function"
  ) {
    window.restoreJosekiTreePosition(josekiStudy.savedTreeNode);
  }

  if (typeof window.refreshJosekiChoices === "function") {
    window.refreshJosekiChoices();
  }
}

function deactivateJoseki() {
  if (josekiStudy.active) finishJosekiStudy();

  window.josekiModeActive = false;
  window.currentJosekiSgf = null;
  window.currentJosekiLibraryName = null;

  const board = window.goBoardInstance;
  if (board && typeof board.setJosekiChoices === "function") board.setJosekiChoices([]);

  const activateButton = document.getElementById("activateJoseki");
  const studyButton = document.getElementById("studyJoseki");
  const status = document.getElementById("josekiStatus");

  if (activateButton) activateButton.textContent = "Активировать";
  if (studyButton) studyButton.disabled = true;
  if (status) status.textContent = "Источник: Kogo's Joseki Dictionary.";
}

(function setupJosekiPanel() {
  const activateButton = document.getElementById("activateJoseki");
  const studyButton = document.getElementById("studyJoseki");
  const finishButton = document.getElementById("finishJosekiStudy");
  const status = document.getElementById("josekiStatus");

  if (!activateButton || !status) return;

  activateButton.addEventListener("click", async () => {
    if (activateButton.disabled) return;

    if (window.josekiModeActive) {
      deactivateJoseki();
      return;
    }

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
      activateButton.textContent = "Деактивировать";
      if (studyButton) studyButton.disabled = false;

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

  if (studyButton) studyButton.addEventListener("click", startJosekiStudy);
  if (finishButton) finishButton.addEventListener("click", finishJosekiStudy);
})();

window.handleJosekiStudyIntersection = handleStudyIntersection;
window.finishJosekiStudy = finishJosekiStudy;
