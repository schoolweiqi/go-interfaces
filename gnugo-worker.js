/* GNU Go browser worker for SchoolWeiqi Go Interfaces.
 * Runtime files are loaded from the upstream wasm-gnugo pages build.
 * GNU Go is GPL-3.0-or-later. See GNU_GO_NOTICE.md.
 */
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/TristanCacqueray/wasm-gnugo@pages/';
let moduleInstance = null;
let modulePromise = null;

async function initEngine() {
  if (moduleInstance) return moduleInstance;
  if (modulePromise) return modulePromise;
  modulePromise = new Promise((resolve, reject) => {
    try {
      self.exports = {};
      importScripts(CDN_BASE + 'gnugo.js');
      if (!self.exports || typeof self.exports.init !== 'function') throw new Error('Не найден exports.init в gnugo.js');
      const Module = {
        locateFile(path) { return CDN_BASE + path; },
        print() {},
        printErr(message) { if (message) console.warn('[GNU Go]', message); },
        onAbort(reason) { reject(new Error(String(reason || 'GNU Go aborted'))); },
        onRuntimeInitialized() {
          moduleInstance = Module;
          resolve(Module);
        }
      };
      self.exports.init(Module);
      // Старые Emscripten-сборки иногда завершают init синхронно до callback.
      if (!moduleInstance && Module.ccall && Module.asm) {
        moduleInstance = Module;
        resolve(Module);
      }
    } catch (error) {
      reject(error);
    }
  });
  return modulePromise;
}

function versionOf(Module) {
  try { return Module.ccall('get_version', 'string', [], []); } catch (_) { return '3.9.1'; }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const id = msg.id;
  try {
    const Module = await initEngine();
    if (msg.type === 'init') {
      self.postMessage({ id, type: 'ready', ok: true, version: versionOf(Module), exactFinalScore: !!Module._score_final, levelSupported: !!Module._play_level });
      return;
    }
    if (msg.type === 'play') {
      const level = Math.max(0, Math.min(10, Number(msg.level ?? 10)));
      let sgf;
      let levelApplied = false;
      if (Module._play_level) {
        sgf = Module.ccall('play_level', 'string', ['number', 'number', 'string'], [Number(msg.seed || 0), level, String(msg.sgf || '')]);
        levelApplied = true;
      } else {
        sgf = Module.ccall('play', 'string', ['number', 'string'], [Number(msg.seed || 0), String(msg.sgf || '')]);
      }
      self.postMessage({ id, type: 'play', ok: true, sgf, requestedLevel: level, levelApplied });
      return;
    }
    if (msg.type === 'score') {
      // The public wasm-gnugo build exports score(), which calls GNU Go's
      // load_and_score_sgf_file() in its default ESTIMATE mode. If a future
      // custom build exports score_final, this worker automatically prefers it.
      let score;
      let exact = false;
      if (Module._score_final) {
        score = Module.ccall('score_final', 'number', ['number', 'string'], [Number(msg.seed || 0), String(msg.sgf || '')]);
        exact = true;
      } else {
        score = Module.ccall('score', 'number', ['number', 'string'], [Number(msg.seed || 0), String(msg.sgf || '')]);
      }
      self.postMessage({ id, type: 'score', ok: true, score, exact });
      return;
    }
    throw new Error(`Неизвестная команда worker: ${msg.type}`);
  } catch (error) {
    self.postMessage({ id, type: msg.type, ok: false, error: error && error.message ? error.message : String(error) });
  }
};
