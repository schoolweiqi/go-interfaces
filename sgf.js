// SGF import/export helpers.
// Supports the main variation, board size, komi, setup stones (AB/AW), PL and B/W moves.

function parseSgfCollection(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  let pos = 0;

  function skipSpace() {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  }

  function readValue() {
    if (source[pos] !== '[') throw new Error('Ожидалось значение SGF в квадратных скобках.');
    pos++;
    let out = '';

    while (pos < source.length) {
      const ch = source[pos++];
      if (ch === ']') return out;

      if (ch === '\\') {
        if (pos >= source.length) break;
        const next = source[pos++];

        // В SGF escaped line break удаляется целиком.
        if (next === '\r') {
          if (source[pos] === '\n') pos++;
          continue;
        }
        if (next === '\n') continue;

        out += next;
      } else {
        out += ch;
      }
    }

    throw new Error('Незакрытое значение SGF.');
  }

  function readNode() {
    if (source[pos] !== ';') throw new Error('Ожидался узел SGF.');
    pos++;
    const props = {};

    while (pos < source.length) {
      skipSpace();
      const start = pos;
      while (pos < source.length && /[A-Za-z]/.test(source[pos])) pos++;
      if (pos === start) break;

      const ident = source.slice(start, pos).toUpperCase();
      skipSpace();
      const values = [];
      while (source[pos] === '[') {
        values.push(readValue());
        skipSpace();
      }
      if (!values.length) throw new Error(`У свойства ${ident} нет значения.`);
      props[ident] = (props[ident] || []).concat(values);
    }

    return props;
  }

  function readTree() {
    skipSpace();
    if (source[pos] !== '(') throw new Error('SGF должен содержать игровое дерево ().');
    pos++;

    const sequence = [];
    skipSpace();
    while (source[pos] === ';') {
      sequence.push(readNode());
      skipSpace();
    }

    const variations = [];
    while (source[pos] === '(') {
      variations.push(readTree());
      skipSpace();
    }

    if (source[pos] !== ')') throw new Error('Незакрытое игровое дерево SGF.');
    pos++;
    return { sequence, variations };
  }

  skipSpace();
  const trees = [];
  while (pos < source.length) {
    trees.push(readTree());
    skipSpace();
  }
  if (!trees.length) throw new Error('SGF не содержит партии.');
  return trees;
}

function sgfPointToXY(value, size) {
  const v = String(value || '').toLowerCase();

  // Пустое значение — стандартный pass.
  // "tt" также исторически используется как pass на досках <= 19.
  if (!v || (v === 'tt' && size <= 19)) return { pass: true, x: null, y: null };
  if (!/^[a-z]{2}$/.test(v)) throw new Error(`Некорректная SGF-координата: ${value}`);

  const x = v.charCodeAt(0) - 97;
  const y = v.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x >= size || y >= size) {
    throw new Error(`SGF-координата вне доски: ${value}`);
  }
  return { pass: false, x, y };
}

function flattenMainVariation(tree) {
  const nodes = tree.sequence.slice();
  if (tree.variations && tree.variations.length) {
    nodes.push(...flattenMainVariation(tree.variations[0]));
  }
  return nodes;
}

function parseSgfGame(text) {
  const tree = parseSgfCollection(text)[0];
  const nodes = flattenMainVariation(tree);
  if (!nodes.length) throw new Error('SGF не содержит узлов.');

  const root = nodes[0];
  const size = Number(root.SZ && root.SZ[0] ? root.SZ[0] : 19);
  if (![9, 13, 19].includes(size)) {
    throw new Error(`Сейчас поддерживаются доски 9×9, 13×13 и 19×19; в SGF указано SZ[${size}].`);
  }

  const komiRaw = root.KM && root.KM[0];
  const komi = Number.isFinite(Number(komiRaw)) ? Number(komiRaw) : 6.5;

  const setupBlack = (root.AB || []).map(v => sgfPointToXY(v, size)).filter(p => !p.pass);
  const setupWhite = (root.AW || []).map(v => sgfPointToXY(v, size)).filter(p => !p.pass);

  let initialTurn = root.PL && String(root.PL[0]).toUpperCase() === 'W' ? 2 : 1;
  if (!root.PL && setupBlack.length >= 2 && setupWhite.length === 0) initialTurn = 2;

  const moves = [];
  for (const node of nodes) {
    if (node.B && node.B.length) {
      const point = sgfPointToXY(node.B[0], size);
      moves.push({ color: 1, ...point });
    } else if (node.W && node.W.length) {
      const point = sgfPointToXY(node.W[0], size);
      moves.push({ color: 2, ...point });
    }
  }

  return { size, komi, setupBlack, setupWhite, initialTurn, moves };
}

function xyToSgfPoint(x, y) {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

function escapeSgfValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function buildSgfFromBoard(board) {
  const size = board.size;
  const komi = Number.isFinite(Number(board.sgfKomi)) ? Number(board.sgfKomi) : 6.5;
  const setup = board.sgfSetup || { black: [], white: [] };

  let sgf = `(;GM[1]FF[4]CA[UTF-8]AP[SchoolWeiqi-GoInterfaces]SZ[${size}]KM[${komi}]`;

  if (setup.black && setup.black.length) {
    sgf += 'AB' + setup.black.map(([x, y]) => `[${xyToSgfPoint(x, y)}]`).join('');
  }
  if (setup.white && setup.white.length) {
    sgf += 'AW' + setup.white.map(([x, y]) => `[${xyToSgfPoint(x, y)}]`).join('');
  }

  for (const move of board.history) {
    const color = move.stone === 1 ? 'B' : 'W';
    const coord = move.pass ? '' : xyToSgfPoint(move.x, move.y);
    sgf += `;${color}[${coord}]`;
  }

  return sgf + ')';
}

function downloadSgfFile(filename, sgf) {
  const blob = new Blob([sgf], { type: 'application/x-go-sgf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
