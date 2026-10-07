#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

// Full Josekipedia graph refresh entry point.
const ROOT_ID = 1;
const BASE_URL = "https://www.josekipedia.com/db/node.php";
const OUT_FILE = path.resolve("data/joseki/josekipedia.json");
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

async function fetchNode(id) {
  const url = `${BASE_URL}?id=${encodeURIComponent(id)}&pid=0`;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "accept": "application/json,text/plain,*/*",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "SchoolWeiqi-GoInterfaces-Josekipedia-Archiver/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const data = JSON.parse(text);
      return data;
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
      : null;

  return {
    id,
    move,
    type: Number.isFinite(Number(raw._mtype)) ? Number(raw._mtype) : null
  };
}

function compactNode(raw) {
  const id = Number(raw?._id);
  const children = Array.isArray(raw?._children)
    ? raw._children.map(normalizeEdge).filter(Boolean)
    : [];
  const ghosts = Array.isArray(raw?._ghosts)
    ? raw._ghosts.map(item => {
        const edge = normalizeEdge({ _id: item.id, _mtype: item.mtype });
        if (!edge) return null;
        edge.move = item.loc ? { color: null, point: String(item.loc) } : null;
        return edge;
      }).filter(Boolean)
    : [];

  return {
    id,
    type: Number.isFinite(Number(raw?._mtype)) ? Number(raw._mtype) : null,
    move: raw?.B
      ? { color: 1, point: String(raw.B) }
      : raw?.W
        ? { color: 2, point: String(raw.W) }
        : null,
    children,
    ghosts
  };
}

async function main() {
  const queue = [ROOT_ID];
  const queued = new Set(queue);
  const visited = new Set();
  const nodes = new Map();
  let processed = 0;

  while (queue.length) {
    const ids = [];

    while (queue.length && ids.length < CONCURRENCY) {
      const id = queue.shift();
      queued.delete(id);
      if (visited.has(id)) continue;
      visited.add(id);
      ids.push(id);
    }

    if (!ids.length) continue;

    const batch = await Promise.all(ids.map(async id => {
      const raw = await fetchNode(id);
      return [id, compactNode(raw)];
    }));

    for (const [id, compact] of batch) {
      nodes.set(id, compact);
      processed += 1;

      // Only _children are real Josekipedia tree branches.
      // _ghosts are UI suggestions/placeholders and must not be crawled recursively.
      for (const edge of compact.children) {
        if (visited.has(edge.id) || queued.has(edge.id)) continue;
        queue.push(edge.id);
        queued.add(edge.id);
      }
    }

    if (processed % 250 < ids.length) {
      console.log(`Fetched ${processed} nodes; queued ${queue.length}`);
    }
  }

  const orderedNodes = Object.fromEntries(
    [...nodes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, node]) => [String(id), node])
  );

  const payload = {
    schema: 1,
    source: "Josekipedia",
    sourceUrl: "https://www.josekipedia.com/",
    rootId: ROOT_ID,
    generatedAt: new Date().toISOString(),
    moveTypes: TYPE_NAMES,
    nodeCount: nodes.size,
    nodes: orderedNodes
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload), "utf8");
  console.log(`Wrote ${OUT_FILE}: ${nodes.size} nodes`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
