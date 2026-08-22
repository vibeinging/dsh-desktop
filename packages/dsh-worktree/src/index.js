/** Host half of the portable Git Worktree conversation Bundle. */

import {
  WorktreeError,
  createWorktree,
  getCurrentBranch,
  isGitRepository,
  listWorktrees,
  removeWorktree,
  resolveGitWorktreeRoot,
  resolveMainWorktreeRoot,
} from "./git.js";

export const name = "dsh-worktree";
export const inject = ["webServer", "sessions"];

const ROUTE_PATH = "/dsh-worktree";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SESSION_ID_LENGTH = 240;

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
  return typeof host === "string" && (origin === `http://${host}` || origin === `https://${host}`);
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new WorktreeError("请求内容过大", 413, "REQUEST_BODY_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sessionCwd(ctx, sessionId) {
  const normalized = typeof sessionId === "string" ? sessionId.trim().slice(0, MAX_SESSION_ID_LENGTH) : "";
  if (!normalized) throw new WorktreeError("缺少 Session 标识", 400, "SESSION_ID_REQUIRED");
  const session = ctx.sessions?.get?.(normalized);
  if (!session) throw new WorktreeError("Session 不存在或尚未加载", 404, "SESSION_NOT_FOUND");
  const cwd = session.header?.cwd;
  if (typeof cwd !== "string" || cwd === "") {
    throw new WorktreeError("当前 Session 没有可用工作目录", 409, "SESSION_CWD_UNAVAILABLE");
  }
  return cwd;
}

/** Execute one Worktree action against the requested Session's fixed cwd. */
export async function executeWorktreeAction(ctx, payload) {
  const action = typeof payload?.action === "string" ? payload.action : "list";
  const cwd = sessionCwd(ctx, payload?.sessionId);
  if (!(await isGitRepository(cwd))) {
    if (action === "list") return { gitRepository: false, currentPath: cwd, main: null, items: [] };
    throw new WorktreeError("当前 Session 不在 Git 仓库中", 409, "WORKTREE_NOT_GIT");
  }
  const currentPath = await resolveGitWorktreeRoot(cwd);
  const root = await resolveMainWorktreeRoot(cwd);
  if (!currentPath || !root) throw new WorktreeError("无法定位 Git 主检出", 409, "WORKTREE_MAIN_ROOT_UNAVAILABLE");
  if (action === "list") {
    return {
      gitRepository: true,
      currentPath,
      main: { path: root, branch: await getCurrentBranch(root), active: currentPath === root },
      items: (await listWorktrees(root)).map((item) => ({ ...item, active: item.path === currentPath })),
    };
  }
  if (action === "create") {
    const item = await createWorktree(root, {
      branchName: payload?.branchName,
      baseBranch: payload?.baseBranch,
    });
    return { item: { ...item, active: false } };
  }
  if (action === "remove") {
    const targetPath = typeof payload?.path === "string" ? payload.path : "";
    if (targetPath && targetPath === currentPath) {
      throw new WorktreeError("当前 Session 正在使用这个 Worktree，不能删除", 409, "WORKTREE_IN_USE");
    }
    return removeWorktree(root, targetPath);
  }
  throw new WorktreeError("不支持的 Worktree 操作", 400, "WORKTREE_ACTION_INVALID");
}

async function handleWorktreeRequest(request, response, ctx) {
  if (request.method !== "POST") {
    response.writeHead(405, { allow: "POST" });
    response.end();
    return;
  }
  if (!trustedRequest(request)) {
    sendJson(response, 403, { error: "拒绝跨源请求", code: "CROSS_ORIGIN_REJECTED" });
    return;
  }
  try {
    const payload = JSON.parse(await readBody(request));
    sendJson(response, 200, await executeWorktreeAction(ctx, payload));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    sendJson(response, status, {
      error: error?.message || String(error),
      code: error?.code || "WORKTREE_INTERNAL_ERROR",
    });
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: ROUTE_PATH,
    handler: (request, response) => { void handleWorktreeRequest(request, response, ctx); },
  }), "dsh worktree: session-bound route");
}
