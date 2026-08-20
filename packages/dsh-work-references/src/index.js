/**
 * Host half of the workspace references Bundle.
 *
 * The only root accepted by the route comes from the requested DSH Session's
 * durable workspace header. The browser never supplies a filesystem path.
 */

import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

export const name = "dsh-work-references";
export const inject = ["webServer", "sessions"];

const ROUTE_PATH = "/dsh-work-references/files";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUERY_LENGTH = 200;
const MAX_SCANNED_ENTRIES = 4_000;
const MAX_WALK_DEPTH = 6;
const MAX_MATCHES = 20;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function trustedRequest(request) {
  const origin = request.headers?.origin;
  if (typeof origin !== "string" || origin === "") return true;
  const host = request.headers?.host;
  return typeof host === "string" && origin === `http://${host}`;
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function relevance(path, query) {
  if (!query) return path.length;
  const namePart = basename(path).toLowerCase();
  if (namePart.startsWith(query)) return 0;
  if (namePart.includes(query)) return 1;
  return 2;
}

/**
 * List bounded, workspace-relative file candidates.
 *
 * @param {string} cwd - absolute workspace directory owned by the Session.
 * @param {string} rawQuery - case-insensitive filename query.
 * @returns {Promise<Array<{name: string, description: string, text: string}>>}
 */
export async function listWorkspaceFileReferences(cwd, rawQuery) {
  const query = String(rawQuery || "").trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  const matches = [];
  let scanned = 0;
  const queue = [{ dir: cwd, depth: 0 }];
  while (queue.length > 0 && scanned < MAX_SCANNED_ENTRIES && matches.length < MAX_MATCHES) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scanned >= MAX_SCANNED_ENTRIES || matches.length >= MAX_MATCHES) break;
      scanned += 1;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name) || depth >= MAX_WALK_DEPTH) continue;
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = relative(cwd, join(dir, entry.name)).split(sep).join("/");
      if (relativePath.startsWith("..") || relativePath.includes("/../")) continue;
      if (query && !relativePath.toLowerCase().includes(query)) continue;
      matches.push(relativePath);
    }
  }
  matches.sort((left, right) => (
    relevance(left, query) - relevance(right, query)
      || left.length - right.length
      || left.localeCompare(right)
  ));
  return matches.map((relativePath) => ({
    name: basename(relativePath),
    description: relativePath,
    text: relativePath,
  }));
}

async function handleFileReferences(request, response, ctx) {
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return;
  }
  if (!trustedRequest(request)) {
    sendJson(response, 403, { error: "cross-origin requests are rejected" });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    sendJson(response, 400, { error: "invalid request body" });
    return;
  }
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.slice(0, MAX_QUERY_LENGTH) : "";
  const query = typeof body?.query === "string" ? body.query.slice(0, MAX_QUERY_LENGTH) : "";
  if (!sessionId) {
    sendJson(response, 400, { error: "sessionId is required" });
    return;
  }
  const session = ctx.sessions?.get?.(sessionId);
  const cwd = session?.header?.cwd;
  if (typeof cwd !== "string" || cwd === "") {
    sendJson(response, 200, { items: [] });
    return;
  }
  try {
    sendJson(response, 200, { items: await listWorkspaceFileReferences(cwd, query) });
  } catch (error) {
    sendJson(response, 500, { error: error?.message || String(error) });
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: ROUTE_PATH,
    handler: (request, response) => {
      void handleFileReferences(request, response, ctx);
    },
  }), "dsh-work references: file route");
}
