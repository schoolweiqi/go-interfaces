#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_ID = 1;
const BASE_URL = "https://www.josekipedia.com/db/node.php";
const LEGACY_SEED_FILE = path.resolve("data/joseki/josekipedia.json");
const DB_DIR = path.resolve("data/joseki/josekipedia");
const SHARD_DIR = path.join(DB_DIR, "shards");
const STATE_FILE = path.join(DB_DIR, "state.json");
const MANIFEST_FILE = path.join(DB_DIR, "manifest.json");

const SHARD_COUNT = 128;
const MAX_NODES_PER_RUN = Number(process.env.JOSEKIPEDIA_MAX_NODES_PER_RUN || 50000);
const CONCURRENCY = Number(process.env.JOSEKIPEDIA_CONCURRENCY || 8);
const RETRIES = Number(process.env.JOSEKIPEDIA_RETRIES || 6);
const REQUEST_TIMEOUT_MS = Number(process.env.JOSEKIPEDIA_TIMEOUT_MS || 20000);

const TYPE_NAMES = {
  0: "IDEAL",
  1: "GOOD",
  2: "MISTAKE",
  3: "TRICK",
  4: "QUESTION"
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shardIndex(id) {
  return Math.abs(Number(id)) % SHARD_COUNT;
}

function shardName(index) {
  return String(index).padStart(3, "0") + ".json";
}

function shardPath(index) {
  return path.join(SHARD_DIR, shardName(index));
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value), "utf8");
}

async function fetchNode(id) {
  const url = `${BASE_URL}?id=${encodeURIComponent(id)}&pid=0`;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json,text/plain,*/*",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "SchoolWeiqi-GoInterfaces-Josekipedia-Archiver/2.0"
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return JSON.parse(await response.text());
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await sleep(Math.min(15000, 500 * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("unreachable");
}

function normalizeEdge(raw) {
  if (!raw) return null;
  const id = Number(raw._id ?? raw.id);
  if (!Number.isFinite(id)) return null;

  const move = raw.B
    ? { color: 1, point: String(raw.B) }
    : raw.W
      ? { color: 2, point: String(raw.W) }
      : raw.move?.point
        ? {
            color: Number(raw.move.color) === 2 ? 2 : Number(raw.move.color) === 1 ? 1 : null,
            point: String(raw.move.point)
          }
        : null;

  return {
    id,
    move,
    type: Number.isFinite(Number(raw._mtype ?? raw.type))
      ? Number(raw._mtype ?? raw.type)
      : null
  };
}

function compactNode(raw) {
  const id = Number(raw?._id ?? raw?.id);
  const children = Array.isArray(raw?._children)
    ? raw._children.map(normalizeEdge).filter(Boolean)
    : Array.isArray(raw?.children)
      ? raw.children.map(normalizeEdge).filter(Boolean)
      : [];

  const ghosts = Array.isArray(raw?._ghosts)
    ? raw._ghosts.map(item => {
        const edge = normalizeEdge({ _id: item.id, _mtype: item.mtype });
        if (!edge) return null;
        edge.move = item.loc ? { color: null, point: String(item.loc) } : null;
        return edge;
      }).filter(Boolean)
    : Array.isArray(raw?.ghosts)
      ? raw.ghosts.map(normalizeEdge).filter(Boolean)
      : [];

  const ownMove = raw?.B
    ? { color: 1, point: String(raw.B) }
    : raw?.W
      ? { color: 2, point: String(raw.W) }
      : raw?.move?.point
        ? {
            color: Number(raw.move.color) === 2 ? 2 : Number(raw.move.color) === 1 ? 1 : null,
            point: String(raw.move.point)
          }
        : null;

  return {
    id,
    type: Number.isFinite(Number(raw?._mtype ?? raw?.type))
      ? Number(raw?._mtype ?? raw?.type)
      : null,
    move: ownMove,
    children,
    ghosts
  };
}

async function loadAllShards() {
  await fs.mkdir(SHARD_DIR, { recursive: true });

  const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
  const visited = new Set();

  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const data = await readJson(shardPath(index), {});
    shards[index] = data && typeof data === "object" ? data : {};
    for (const key of Object.keys(shards[index])) visited.add(Number(key));
  }

  return { shards, visited };
}

async function seedFromLegacyIfNeeded(shards, visited) {
  if (visited.size) return false;

  const legacy = await readJson(LEGACY_SEED_FILE, null);
  if (!legacy?.nodes) return false;

  for (const [key, rawNode] of Object.entries(legacy.nodes)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    shards[shardIndex(id)][String(id)] = compactNode(rawNode);
    visited.add(id);
  }

  console.log(`Imported legacy seed: ${visited.size} nodes`);
  return true;
}

function deriveQueueFromKnownNodes(shards, visited) {
  const queue = [];
  const queued = new Set();

  for (const shard of shards) {
    for (const rawNode of Object.values(shard)) {
      const node = compactNode(rawNode);
      for (const edge of node.children) {
        if (visited.has(edge.id) || queued.has(edge.id)) continue;
        queue.push(edge.id);
        queued.add(edge.id);
      }
    }
  }

  if (!visited.has(ROOT_ID) && !queued.has(ROOT_ID)) queue.unshift(ROOT_ID);
  return queue;
}

async function saveChangedShards(shards, changed) {
  for (const index of changed) {
    const ordered = Object.fromEntries(
      Object.entries(shards[index]).sort((a, b) => Number(a[0]) - Number(b[0]))
    );
    await writeJson(shardPath(index), ordered);
  }
}

async function saveProgress({ visited, queue, processedThisRun, complete }) {
  const now = new Date().toISOString();

  await writeJson(STATE_FILE, {
    schema: 2,
    rootId: ROOT_ID,
    shardCount: SHARD_COUNT,
    complete,
    nodeCount: visited.size,
    queue,
    processedThisRun,
    updatedAt: now
  });

  await writeJson(MANIFEST_FILE, {
    schema: 2,
    source: "Josekipedia",
    sourceUrl: "https://www.josekipedia.com/",
    rootId: ROOT_ID,
    complete,
    nodeCount: visited.size,
    queueLength: queue.length,
    shardCount: SHARD_COUNT,
    shardPattern: "shards/{bucket}.json",
    bucketRule: "nodeId modulo shardCount",
    moveTypes: TYPE_NAMES,
    generatedAt: now
  });
}

async function main() {
  await fs.mkdir(DB_DIR, { recursive: true });
  await fs.mkdir(SHARD_DIR, { recursive: true });

  const { shards, visited } = await loadAllShards();
  const seeded = await seedFromLegacyIfNeeded(shards, visited);

  let state = await readJson(STATE_FILE, null);
  let queue;

  if (
    state &&
    state.schema === 2 &&
    Array.isArray(state.queue) &&
    Number(state.shardCount) === SHARD_COUNT
  ) {
    queue = state.queue
      .map(Number)
      .filter(id => Number.isFinite(id) && !visited.has(id));
  } else {
    queue = deriveQueueFromKnownNodes(shards, visited);
  }

  const queued = new Set(queue);
  const changedShards = new Set();

  if (seeded) {
    for (let index = 0; index < SHARD_COUNT; index += 1) {
      if (Object.keys(shards[index]).length) changedShards.add(index);
    }
  }

  let processedThisRun = 0;

  console.log(
    `Josekipedia resume: ${visited.size} nodes stored; ${queue.length} queued; run limit ${MAX_NODES_PER_RUN}`
  );

  while (queue.length && processedThisRun < MAX_NODES_PER_RUN) {
    const ids = [];

    while (
      queue.length &&
      ids.length < CONCURRENCY &&
      processedThisRun + ids.length < MAX_NODES_PER_RUN
    ) {
      const id = Number(queue.shift());
      queued.delete(id);
      if (!Number.isFinite(id) || visited.has(id)) continue;
      ids.push(id);
    }

    if (!ids.length) continue;

    const batch = await Promise.all(ids.map(async id => {
      const raw = await fetchNode(id);
      return [id, compactNode(raw)];
    }));

    for (const [id, compact] of batch) {
      const index = shardIndex(id);
      shards[index][String(id)] = compact;
      changedShards.add(index);
      visited.add(id);
      processedThisRun += 1;

      for (const edge of compact.children) {
        if (visited.has(edge.id) || queued.has(edge.id)) continue;
        queue.push(edge.id);
        queued.add(edge.id);
      }
    }

    if (processedThisRun % 1000 < ids.length) {
      console.log(
        `Run fetched ${processedThisRun}; total stored ${visited.size}; queued ${queue.length}`
      );
    }
  }

  await saveChangedShards(shards, changedShards);

  // Remove already stored IDs that could remain in a resumed queue.
  queue = queue.filter(id => !visited.has(Number(id)));
  const complete = queue.length === 0;

  await saveProgress({
    visited,
    queue,
    processedThisRun,
    complete
  });

  console.log(
    complete
      ? `Josekipedia complete: ${visited.size} nodes`
      : `Checkpoint saved: ${visited.size} nodes; ${queue.length} queued`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
