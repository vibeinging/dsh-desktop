/** Bounded Git Worktree operations shared by the portable DSH Bundle. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const WORKTREE_DIR_NAME = ".dsh-worktrees";
export const MAX_BRANCH_NAME_LENGTH = 120;
const MAX_BASE_REF_LENGTH = 240;
const MAX_GIT_OUTPUT_LENGTH = 64 * 1024;
const GIT_TIMEOUT_MS = 30_000;

/** Structured error safe for projection through the local Web route. */
export class WorktreeError extends Error {
  constructor(message, status = 409, code = "GIT_OPERATION_FAILED") {
    super(message);
    this.name = "WorktreeError";
    this.status = status;
    this.code = code;
  }
}

function runGit(cwd, args, stdin = "", { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
        LANG: "C",
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTruncated = false;
    let settled = false;
    const appendOutput = (current, chunk) => {
      if (current.length >= MAX_GIT_OUTPUT_LENGTH) {
        outputTruncated = true;
        return current;
      }
      const next = current + String(chunk || "");
      if (next.length <= MAX_GIT_OUTPUT_LENGTH) return next;
      outputTruncated = true;
      return next.slice(0, MAX_GIT_OUTPUT_LENGTH);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ...result, stdout, stderr, timedOut, outputTruncated });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr = appendOutput(stderr, "\nGit operation timed out");
      child.kill("SIGKILL");
    }, Math.max(1, Number(timeoutMs) || GIT_TIMEOUT_MS));
    timeout.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = appendOutput(stderr, chunk); });
    child.on("error", (error) => {
      stderr = appendOutput(stderr, error?.message || String(error));
      finish({ code: 127 });
    });
    child.on("close", (code) => finish({ code: timedOut ? 124 : Number(code ?? 1) }));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

function gitError(result, fallback, { status = 409, code = "GIT_OPERATION_FAILED" } = {}) {
  if (result?.timedOut) {
    return new WorktreeError("Git 操作超时，请检查仓库锁或磁盘状态后重试", 503, "GIT_OPERATION_TIMEOUT");
  }
  const detail = String(result?.stderr || "").trim().slice(0, 300);
  return new WorktreeError(`${fallback}${detail ? `：${detail}` : ""}`, status, code);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function managedWorktreeParent(rootPath, { create = false } = {}) {
  const root = await realpath(String(rootPath || "").trim()).catch(() => null);
  if (!root) throw new WorktreeError("工作区目录不存在或无法访问", 409, "WORKSPACE_UNAVAILABLE");
  const parent = path.join(root, WORKTREE_DIR_NAME);
  if (create) await mkdir(parent, { recursive: true });
  const parentInfo = await lstat(parent).catch(() => null);
  if (!parentInfo) return { root, parent };
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new WorktreeError("Worktree 管理目录无效，不能继续操作", 409, "WORKTREE_DIRECTORY_UNSAFE");
  }
  const resolvedParent = await realpath(parent).catch(() => null);
  if (!resolvedParent || !isInside(root, resolvedParent)) {
    throw new WorktreeError("Worktree 管理目录超出仓库，不能继续操作", 409, "WORKTREE_DIRECTORY_UNSAFE");
  }
  return { root, parent: resolvedParent };
}

async function canonicalWorktreePath(parent, value) {
  const input = String(value || "").trim();
  if (!input) throw new WorktreeError("缺少 Worktree 路径", 400, "WORKTREE_PATH_REQUIRED");
  const candidate = await realpath(input).catch(() => path.resolve(input));
  if (path.dirname(candidate) !== parent) {
    throw new WorktreeError("Worktree 路径不属于当前仓库的管理目录", 409, "WORKTREE_PATH_OUT_OF_SCOPE");
  }
  return candidate;
}

function normalizeBranchInput(value, { allowEmpty = false } = {}) {
  const branch = String(value || "").trim();
  if (!branch && allowEmpty) return null;
  if (!branch) throw new WorktreeError("分支名称不能为空", 400, "WORKTREE_BRANCH_REQUIRED");
  if (branch.length > MAX_BRANCH_NAME_LENGTH) {
    throw new WorktreeError(`分支名称不能超过 ${MAX_BRANCH_NAME_LENGTH} 个字符`, 400, "WORKTREE_BRANCH_TOO_LONG");
  }
  if (branch.startsWith("-")) {
    throw new WorktreeError("分支名称不能以 - 开头", 400, "WORKTREE_BRANCH_INVALID");
  }
  return branch;
}

function normalizeBaseRef(value) {
  const ref = String(value || "").trim();
  if (!ref) return null;
  if (ref.length > MAX_BASE_REF_LENGTH) {
    throw new WorktreeError(`起始分支或提交不能超过 ${MAX_BASE_REF_LENGTH} 个字符`, 400, "WORKTREE_BASE_INVALID");
  }
  if (ref.startsWith("-") || /[\u0000-\u0020\u007f~^:?*\[\\]/u.test(ref) || ref.includes("..") || ref.includes("@{")) {
    throw new WorktreeError("起始分支或提交格式无效", 400, "WORKTREE_BASE_INVALID");
  }
  return ref;
}

async function validatedBranchName(root, value, fallback) {
  const branch = normalizeBranchInput(value, { allowEmpty: true }) || fallback;
  const result = await runGit(root, ["check-ref-format", "--branch", branch]);
  if (result.code !== 0) {
    throw new WorktreeError("分支名称格式无效，请使用 Git 支持的分支名称", 400, "WORKTREE_BRANCH_INVALID");
  }
  return branch;
}

async function resolvedBaseCommit(root, value) {
  const ref = normalizeBaseRef(value);
  if (!ref) return null;
  const result = await runGit(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  if (result.code !== 0) throw new WorktreeError("找不到起始分支或提交", 400, "WORKTREE_BASE_NOT_FOUND");
  return result.stdout.trim();
}

async function ensureManagedDirectoryIgnored(root) {
  const commonDir = await getGitCommonDir(root);
  if (!commonDir) throw new WorktreeError("无法定位 Git 元数据目录", 409, "GIT_COMMON_DIRECTORY_UNAVAILABLE");
  const infoDir = path.join(commonDir, "info");
  const excludePath = path.join(infoDir, "exclude");
  const rule = `/${WORKTREE_DIR_NAME}/`;
  await mkdir(infoDir, { recursive: true });
  const current = await readFile(excludePath, "utf8").catch(() => "");
  if (current.split(/\r?\n/u).some((line) => line.trim() === rule)) return;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await appendFile(excludePath, `${prefix}${rule}\n`, "utf8");
}

/** Detect whether a directory is inside a Git working tree. */
export async function isGitRepository(cwd) {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (result.timedOut) throw gitError(result, "检查 Git 仓库失败", { status: 503 });
  return result.code === 0 && result.stdout.trim() === "true";
}

/** Resolve the root of the checkout containing cwd. */
export async function resolveGitWorktreeRoot(cwd) {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.timedOut) throw gitError(result, "检查 Git 仓库根目录失败", { status: 503 });
  if (result.code !== 0) return null;
  return realpath(result.stdout.trim()).catch(() => null);
}

/** Worktree creation starts at a repository root, not an arbitrary subfolder. */
export async function isGitRepositoryRoot(cwd) {
  const canonicalInput = await realpath(String(cwd || "").trim()).catch(() => null);
  if (!canonicalInput) return false;
  return (await resolveGitWorktreeRoot(canonicalInput)) === canonicalInput;
}

/** Resolve the shared main checkout from either the main tree or a linked Worktree. */
export async function resolveMainWorktreeRoot(cwd) {
  const worktreeRoot = await resolveGitWorktreeRoot(cwd);
  if (!worktreeRoot) return null;
  const commonDir = await getGitCommonDir(worktreeRoot);
  if (!commonDir) return null;
  const resolvedCommonDir = await realpath(commonDir).catch(() => null);
  if (!resolvedCommonDir) return null;
  const mainRoot = await realpath(path.dirname(resolvedCommonDir)).catch(() => null);
  if (!mainRoot || !(await isGitRepositoryRoot(mainRoot))) return null;
  return mainRoot;
}

/** Get the current HEAD commit SHA, or null when unavailable. */
export async function getHeadCommit(cwd) {
  const result = await runGit(cwd, ["rev-parse", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Get the checked-out branch, or HEAD for a detached checkout. */
export async function getCurrentBranch(cwd) {
  const result = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : "HEAD";
}

/** Get the common Git directory shared across linked Worktrees. */
export async function getGitCommonDir(cwd) {
  const result = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (result.code !== 0) return null;
  const commonDir = result.stdout.trim();
  if (!commonDir) return null;
  return path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
}

/** Create one managed Worktree on a new branch. */
export async function createWorktree(rootPath, { branchName, baseBranch = null, id = randomUUID() } = {}) {
  const root = String(rootPath || "").trim();
  if (!root) throw new WorktreeError("缺少仓库目录", 400, "WORKTREE_ROOT_REQUIRED");
  if (!(await isGitRepository(root))) throw new WorktreeError("当前目录不是 Git 仓库，无法创建 Worktree", 409, "WORKTREE_NOT_GIT");
  if (!(await isGitRepositoryRoot(root))) {
    throw new WorktreeError("Worktree 必须从 Git 主检出根目录创建", 409, "WORKTREE_REPOSITORY_ROOT_REQUIRED");
  }
  const safeId = String(id || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32) || randomUUID();
  const { root: resolvedRoot, parent } = await managedWorktreeParent(root, { create: true });
  const worktreePath = path.join(parent, safeId);
  if (await lstat(worktreePath).catch(() => null)) {
    throw new WorktreeError("Worktree 目录已存在，请重试", 409, "WORKTREE_ALREADY_EXISTS");
  }
  const branch = await validatedBranchName(resolvedRoot, branchName, `dsh/${safeId}`);
  const branchExists = await runGit(resolvedRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (branchExists.code === 0) throw new WorktreeError(`分支已存在：${branch}`, 409, "WORKTREE_ALREADY_EXISTS");
  if (branchExists.code !== 1) throw gitError(branchExists, "检查分支是否存在失败", { status: 503 });
  const baseCommit = await resolvedBaseCommit(resolvedRoot, baseBranch);
  await ensureManagedDirectoryIgnored(resolvedRoot);
  const args = ["worktree", "add", "-b", branch, worktreePath];
  if (baseCommit) args.push(baseCommit);
  const result = await runGit(resolvedRoot, args);
  if (result.code !== 0) throw gitError(result, "创建 Worktree 失败");
  const resolvedPath = await realpath(worktreePath).catch(() => worktreePath);
  return { id: safeId, path: resolvedPath, branch, baseCommit: await getHeadCommit(resolvedPath) };
}

/** List only Worktrees created below the managed directory. */
export async function listWorktrees(rootPath) {
  const root = String(rootPath || "").trim();
  if (!root || !(await isGitRepositoryRoot(root))) return [];
  const { root: resolvedRoot, parent } = await managedWorktreeParent(root);
  const result = await runGit(resolvedRoot, ["worktree", "list", "--porcelain", "-z"]);
  if (result.code !== 0) throw gitError(result, "读取 Worktree 列表失败", { status: 503 });
  const entries = [];
  let current = null;
  for (const line of result.stdout.split("\0")) {
    if (!line) {
      if (current) entries.push(current);
      current = null;
    } else if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("HEAD ") && current) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//u, "");
    }
  }
  if (current) entries.push(current);
  const managed = [];
  for (const entry of entries) {
    const resolvedEntry = await realpath(entry.path).catch(() => path.resolve(entry.path));
    if (path.dirname(resolvedEntry) === parent) managed.push({ ...entry, id: path.basename(resolvedEntry), path: resolvedEntry });
  }
  return managed;
}

/** Remove a managed Worktree while preserving its branch by default. */
export async function removeWorktree(rootPath, worktreePath, { deleteBranch = false } = {}) {
  const root = String(rootPath || "").trim();
  if (!root) throw new WorktreeError("缺少仓库目录", 400, "WORKTREE_ROOT_REQUIRED");
  const { root: resolvedRoot, parent } = await managedWorktreeParent(root);
  const resolvedWorktree = await canonicalWorktreePath(parent, worktreePath);
  const existing = await stat(resolvedWorktree).catch(() => null);
  const managed = await listWorktrees(resolvedRoot);
  const registered = managed.find((entry) => entry.path === resolvedWorktree);
  if (!registered) {
    if (!existing) {
      await runGit(resolvedRoot, ["worktree", "prune"]);
      return { removed: false, missing: true };
    }
    throw new WorktreeError("目录不是当前仓库管理的 Worktree，不能删除", 409, "WORKTREE_NOT_MANAGED");
  }
  const result = await runGit(resolvedRoot, ["worktree", "remove", resolvedWorktree]);
  if (result.code !== 0) throw gitError(result, "删除 Worktree 失败");
  const prune = await runGit(resolvedRoot, ["worktree", "prune"]);
  if (prune.code !== 0) throw gitError(prune, "清理 Worktree 元数据失败", { status: 503 });
  if (deleteBranch && registered.branch) {
    const deleted = await runGit(resolvedRoot, ["branch", "-D", "--", registered.branch]);
    if (deleted.code !== 0) throw gitError(deleted, "清理 Worktree 分支失败");
  }
  return { removed: true, missing: false, branch: registered.branch || null };
}
