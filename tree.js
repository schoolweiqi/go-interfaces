// Game-tree model, SGF variation structure and tree rendering.

class GameTreeNode {
  constructor(id, parent = null, move = null) {
    this.id = id;
    this.parent = parent;
    this.move = move;
    this.children = [];
    this.preferredChild = null;
    this.depth = parent ? parent.depth + 1 : 0;
  }
}

class GameTree {
  constructor(meta = {}) {
    this.nextId = 1;
    this.nodes = new Map();
    this.reset(meta);
  }

  normalizeMeta(meta = {}) {
    return {
      size: Number(meta.size) || 19,
      komi: Number.isFinite(Number(meta.komi)) ? Number(meta.komi) : 6.5,
      initialTurn: Number(meta.initialTurn) === 2 ? 2 : 1,
      setupBlack: Array.isArray(meta.setupBlack) ? meta.setupBlack.map(p => [Number(p[0]), Number(p[1])]) : [],
      setupWhite: Array.isArray(meta.setupWhite) ? meta.setupWhite.map(p => [Number(p[0]), Number(p[1])]) : []
    };
  }

  reset(meta = {}) {
    this.meta = this.normalizeMeta(meta);
    this.nextId = 1;
    this.nodes = new Map();
    this.root = new GameTreeNode(0, null, null);
    this.nodes.set(0, this.root);
    this.current = this.root;
  }

  sameMove(a, b) {
    if (!a || !b) return false;
    return a.color === b.color &&
      Boolean(a.pass) === Boolean(b.pass) &&
      (a.pass || (a.x === b.x && a.y === b.y));
  }

  addChild(parent, move) {
    const existing = parent.children.find(child => this.sameMove(child.move, move));
    if (existing) return existing;

    const node = new GameTreeNode(this.nextId++, parent, {
      color: Number(move.color),
      pass: Boolean(move.pass),
      x: move.pass ? null : Number(move.x),
      y: move.pass ? null : Number(move.y)
    });
    parent.children.push(node);
    if (!parent.preferredChild) parent.preferredChild = node;
    this.nodes.set(node.id, node);
    return node;
  }

  addMove(move) {
    const node = this.addChild(this.current, move);
    this.current.preferredChild = node;
    this.current = node;
    return node;
  }

  select(node) {
    if (!node) return this.current;
    if (node.parent) node.parent.preferredChild = node;
    this.current = node;
    return node;
  }

  stepBack() {
    if (!this.current.parent) return this.current;
    return this.select(this.current.parent);
  }

  stepForward() {
    if (!this.current.children.length) return this.current;
    const preferred = this.current.preferredChild && this.current.children.includes(this.current.preferredChild)
      ? this.current.preferredChild
      : this.current.children[0];
    return this.select(preferred);
  }

  pathTo(node = this.current) {
    const path = [];
    let cursor = node;
    while (cursor && cursor.parent) {
      path.push(cursor);
      cursor = cursor.parent;
    }
    return path.reverse();
  }

  deepestPreferred(start = this.root) {
    let node = start;
    while (node.children.length) {
      node = node.preferredChild && node.children.includes(node.preferredChild)
        ? node.preferredChild
        : node.children[0];
    }
    return node;
  }

  deleteCurrentBranch() {
    const node = this.current;
    if (!node || !node.parent) return false;

    const parent = node.parent;
    parent.children = parent.children.filter(child => child !== node);
    if (parent.preferredChild === node) parent.preferredChild = parent.children[0] || null;

    const removeRecursively = (item) => {
      for (const child of item.children) removeRecursively(child);
      this.nodes.delete(item.id);
    };
    removeRecursively(node);
    this.current = parent;
    return true;
  }

  importSgf(parsed) {
    this.reset({
      size: parsed.size,
      komi: parsed.komi,
      initialTurn: parsed.initialTurn,
      setupBlack: parsed.setupBlack.map(p => [p.x, p.y]),
      setupWhite: parsed.setupWhite.map(p => [p.x, p.y])
    });

    const processTree = (rawTree, parentNode, isRootTree = false) => {
      let cursor = parentNode;
      const sequence = rawTree.sequence || [];

      for (let i = 0; i < sequence.length; i++) {
        // Первый узел корневого дерева содержит свойства партии, но он также
        // теоретически может содержать ход, поэтому не пропускаем его безусловно.
        const move = moveFromSgfNode(sequence[i], this.meta.size);
        if (!move) continue;
        const child = this.addChild(cursor, move);
        if (!cursor.preferredChild) cursor.preferredChild = child;
        cursor = child;
      }

      for (const variation of (rawTree.variations || [])) {
        processTree(variation, cursor, false);
      }
      return cursor;
    };

    processTree(parsed.rawTree, this.root, true);
    this.current = this.deepestPreferred(this.root);
    return this.current;
  }
}

function renderGameTree(gameTree, svg, scroller) {
  if (!gameTree || !svg || !scroller) return;

  const positions = new Map();
  let nextLane = 1;
  let maxDepth = 0;
  let maxLane = 0;

  /*
   * Главная (preferred/первая) ветка продолжает текущую строку.
   * Каждая дополнительная вариация получает новую горизонтальную строку.
   * Это делает длинную партию естественно горизонтальной — прокрутка находится
   * под деревом, как и требуется для просмотра длинных партий.
   */
  function layout(node, lane) {
    positions.set(node.id, { depth: node.depth, lane });
    maxDepth = Math.max(maxDepth, node.depth);
    maxLane = Math.max(maxLane, lane);

    if (!node.children.length) return;

    const ordered = node.children.slice();
    const preferred = node.preferredChild && ordered.includes(node.preferredChild)
      ? node.preferredChild
      : ordered[0];

    layout(preferred, lane);
    for (const child of ordered) {
      if (child === preferred) continue;
      const childLane = nextLane++;
      layout(child, childLane);
    }
  }

  layout(gameTree.root, 0);

  const xStep = 42;
  const yStep = 31;
  const marginX = 20;
  const marginY = 18;
  const width = Math.max(scroller.clientWidth || 300, marginX * 2 + maxDepth * xStep + 28);
  const height = Math.max(72, marginY * 2 + maxLane * yStep + 20);

  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const parts = [];

  // Сначала линии, чтобы кружки узлов были поверх соединений.
  for (const node of gameTree.nodes.values()) {
    if (!node.parent) continue;
    const a = positions.get(node.parent.id);
    const b = positions.get(node.id);
    if (!a || !b) continue;
    const x1 = marginX + a.depth * xStep;
    const y1 = marginY + a.lane * yStep;
    const x2 = marginX + b.depth * xStep;
    const y2 = marginY + b.lane * yStep;
    parts.push(`<path class="treeEdge" d="M ${x1} ${y1} C ${x1 + xStep * .45} ${y1}, ${x2 - xStep * .45} ${y2}, ${x2} ${y2}"/>`);
  }

  for (const node of gameTree.nodes.values()) {
    const p = positions.get(node.id);
    if (!p) continue;
    const x = marginX + p.depth * xStep;
    const y = marginY + p.lane * yStep;
    const isRoot = node === gameTree.root;
    const current = node === gameTree.current;
    const colorClass = isRoot ? 'root' : (node.move.color === 1 ? 'black' : 'white');
    const label = isRoot ? '0' : (node.move.pass ? 'P' : String(node.depth));

    parts.push(
      `<g class="treeNode ${colorClass}${current ? ' current' : ''}" data-node-id="${node.id}" transform="translate(${x} ${y})">` +
      `<circle r="10"></circle><text y=".5">${label}</text></g>`
    );

    if (node.children.length > 1) {
      parts.push(`<text class="treeBranchMark" x="${x + 13}" y="${y - 10}">×${node.children.length}</text>`);
    }
  }

  svg.innerHTML = parts.join('');

  // Автоматически держим текущий ход в видимой горизонтальной области.
  const cp = positions.get(gameTree.current.id);
  if (cp) {
    const currentX = marginX + cp.depth * xStep;
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    if (currentX < left + 28) scroller.scrollLeft = Math.max(0, currentX - 28);
    else if (currentX > right - 28) scroller.scrollLeft = Math.max(0, currentX - scroller.clientWidth + 28);
  }
}
