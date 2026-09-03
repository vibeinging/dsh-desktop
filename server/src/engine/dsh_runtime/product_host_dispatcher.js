// DSH Desktop Host dispatcher: the server-side handler for inbound
// `product-request` messages from the app-owned DSH Host adapter.
// The adapter sends `{ type: "product-request", id, sessionId, method, payload }`
// over the fork() IPC channel when a product capability consumer runs. This dispatcher owns:
//   - the method whitelist (default-deny; a method not listed is rejected),
//   - the caller identity (the request NEVER carries a userId — the dispatcher
//     derives it from the bound dsh-work session via resolveUserId),
//   - the result-size cap (hard upper bound on returned items),
// The request carries only the DSH session identity. It never carries userId or
// projectId; those come from a parent-owned binding established after dsh-work
// has authorized the app Session.
//
// It returns the response envelope it wants sent back:
//   { type: "product-response", id, result: { ok: true, value } }
//   { type: "product-response", id, result: { ok: false, error: { code, message } } }
//
// This module is transport-agnostic: it takes the inbound message and returns
// the outbound message; the DshRuntimeClient owns the actual process.send.

import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import * as projectsService from "../../app/projects/index.js";
import { CHAT_PROJECT_ID } from "../../app/projects/access.js";
import * as sessionService from "../../app/chat/agent_misc.js";
import {
  createProjectOfficeArtifact,
  editProjectOfficeArtifact,
  inspectProjectOfficeArtifact,
} from "../agents/office_artifact_service.js";
import {
  createCanvas,
  createCanvasSuggestion,
  editCanvas,
  getCanvas,
} from "../agents/canvas_store.js";
import {
  hashGenerativeUiDocument,
  parseGenerativeUiDocument,
} from "../agents/generative_ui_schema.js";
import {
  buildAppInstructionsMarkdown,
  readAppInstructions,
} from "../../app/agents/app_settings.js";
import { buildProjectInstructionsMarkdown } from "../agents/workspace_context.js";
import { bindDshSessionState } from "./session_state.js";

const MAX_ITEMS = 200;
const DESKTOP_NATIVE_TIMEOUT_MS = 30_000;
const DESKTOP_FILE_DIALOG_TIMEOUT_MS = 180_000;
const ANNOUNCED_SESSION_METHODS = new Set([
  "conversationCreateScope",
]);
const DESKTOP_NATIVE_METHODS = new Set([
  "browserWorkspaceGetState",
  "browserWorkspaceSetVisible",
  "browserWorkspaceSetBounds",
  "browserWorkspaceCreateTab",
  "browserWorkspaceActivateTab",
  "browserWorkspaceCloseTab",
  "browserWorkspaceNavigate",
  "browserWorkspaceGoBack",
  "browserWorkspaceGoForward",
  "browserWorkspaceReload",
  "browserWorkspaceStop",
  "browserWorkspaceFindInPage",
  "browserWorkspaceStopFindInPage",
  "browserWorkspaceCapturePage",
  "browserWorkspaceCaptureScreenshot",
  "browserWorkspaceListPermissions",
  "browserWorkspaceRemovePermission",
  "browserWorkspaceResolvePermissionRequest",
  "fileDialogOpenFiles",
  "fileDialogOpenDirectory",
  "windowGetState",
  "windowFocus",
  "windowMinimize",
  "windowMaximize",
  "windowRestore",
]);

function isDesktopNativeResponse(message) {
  return Boolean(message && typeof message === "object"
    && message.type === "desktop-native-response"
    && typeof message.id === "string"
    && message.result && typeof message.result.ok === "boolean"
    && (message.result.ok
      ? Object.hasOwn(message.result, "value")
      : typeof message.result.error?.code === "string"
        && typeof message.result.error?.message === "string"));
}

/** Correlate one narrow server-to-Electron Host request without exposing it to Web code. */
export function createDesktopNativeHostTransport(channel = process) {
  const pending = new Map();
  const onMessage = (message) => {
    if (!isDesktopNativeResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    request.signal?.removeEventListener("abort", request.onAbort);
    pending.delete(message.id);
    if (message.result.ok) request.resolve(message.result.value);
    else {
      const error = new Error(message.result.error.message);
      error.code = message.result.error.code;
      request.reject(error);
    }
  };
  channel?.on?.("message", onMessage);
  const cancel = (request) => {
    try {
      if (channel?.connected === true && typeof channel.send === "function") {
        channel.send({ type: "desktop-native-cancel", id: request.id, sessionId: request.sessionId });
      }
    } catch {
      // The parent is already exiting; the pending request will be rejected below.
    }
  };
  return Object.freeze({
    request(sessionId, method, payload = {}, signal) {
      const sessionKey = String(sessionId || "").trim();
      if (!sessionKey || !DESKTOP_NATIVE_METHODS.has(method)) {
        const error = new Error("Desktop Native Host 请求缺少已绑定 Session 或使用了未知方法");
        error.code = "desktop-native-rejected";
        return Promise.reject(error);
      }
      if (channel?.connected !== true || typeof channel.send !== "function") {
        const error = new Error("Electron Native Host 不可用");
        error.code = "desktop-native-unavailable";
        return Promise.reject(error);
      }
      const id = randomRequestId();
      return new Promise((resolve, reject) => {
        const request = { id, sessionId: sessionKey, resolve, reject, signal, timer: null, onAbort: null };
        const finish = (error) => {
          if (!pending.has(id)) return;
          clearTimeout(request.timer);
          request.signal?.removeEventListener("abort", request.onAbort);
          pending.delete(id);
          reject(error);
        };
        request.onAbort = () => {
          cancel(request);
          finish(Object.assign(new Error("Browser Workspace 请求已取消"), { code: "desktop-native-rejected" }));
        };
        if (signal?.aborted) {
          request.onAbort();
          return;
        }
        const timeoutMs = method.startsWith("fileDialog")
          ? DESKTOP_FILE_DIALOG_TIMEOUT_MS
          : DESKTOP_NATIVE_TIMEOUT_MS;
        request.timer = setTimeout(() => {
          cancel(request);
          finish(Object.assign(new Error(`Desktop Native 请求超时：${method}`), { code: "desktop-native-timeout" }));
        }, timeoutMs);
        request.timer.unref?.();
        signal?.addEventListener("abort", request.onAbort, { once: true });
        pending.set(id, request);
        try {
          channel.send({ type: "desktop-native-request", id, sessionId: sessionKey, method, payload }, (error) => {
            if (!error || !pending.has(id)) return;
            finish(Object.assign(new Error(`Electron Native Host 请求失败：${error.message || error}`), {
              code: "desktop-native-unavailable",
            }));
          });
        } catch (error) {
          finish(Object.assign(new Error(`Electron Native Host 请求失败：${error?.message || error}`), {
            code: "desktop-native-unavailable",
          }));
        }
      });
    },
    dispose() {
      channel?.off?.("message", onMessage);
      for (const request of pending.values()) {
        cancel(request);
        clearTimeout(request.timer);
        request.signal?.removeEventListener("abort", request.onAbort);
        request.reject(Object.assign(new Error("Electron Native Host 已关闭"), { code: "desktop-native-unavailable" }));
      }
      pending.clear();
    },
  });
}

let nativeRequestSequence = 0;
function randomRequestId() {
  nativeRequestSequence = (nativeRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `native-${process.pid}-${nativeRequestSequence}`;
}

function parseSessionConfig(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

function distinctIdentity(rows) {
  const identities = new Map();
  for (const row of rows) {
    const projectId = String(row?.project_id || row?.projectId || "").trim();
    const userId = String(row?.user_id || row?.userId || "").trim();
    if (!projectId || !userId) continue;
    identities.set(`${projectId}\u0000${userId}`, { projectId, userId });
  }
  return identities.size === 1 ? [...identities.values()][0] : null;
}

function normalizedIdentities(rows) {
  const identities = new Map();
  for (const row of rows) {
    const projectId = String(row?.project_id || row?.projectId || "").trim();
    const userId = String(row?.user_id || row?.userId || "").trim();
    if (!projectId || !userId) continue;
    identities.set(`${projectId}\u0000${userId}`, { projectId, userId });
  }
  return [...identities.values()];
}

const WORKSPACE_IDENTITY_SQL = `SELECT psf.project_id, pm.user_id
   FROM project_source_folders psf
   JOIN projects p ON p.id=psf.project_id AND p.deleted_at IS NULL
   JOIN project_members pm ON pm.project_id=psf.project_id AND pm.deleted_at IS NULL
  WHERE psf.local_path=$1 AND psf.deleted_at IS NULL`;

function createNativeWorkspaceIdentity(db, context) {
  if (typeof db?.transaction !== "function") return null;
  return db.transaction((tx) => {
    const current = normalizedIdentities(tx.query(WORKSPACE_IDENTITY_SQL, [context.cwd]));
    if (current.length > 1) return null;
    if (current.length === 1) return current[0];

    const users = tx.query(
      "SELECT id, company_id FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC",
    );
    if (users.length !== 1) return null;
    const userId = String(users[0]?.id || "").trim();
    const companyId = String(users[0]?.company_id || "").trim();
    if (!userId || !companyId) return null;

    const projectId = randomUUID();
    const requestedTitle = String(context.workspaceTitle || "").trim();
    const folderTitle = basename(context.cwd).trim();
    const projectTitle = (requestedTitle || folderTitle || context.cwd).slice(0, 100);
    const displayName = (requestedTitle || folderTitle || projectTitle).slice(0, 160);
    const adminRole = tx.queryOne(
      `SELECT id FROM roles
        WHERE deleted_at IS NULL
          AND (code='project_admin' OR (is_system=true AND (name LIKE '%管理员%' OR code LIKE '%admin%')))
        ORDER BY (code='project_admin') DESC, is_system DESC
        LIMIT 1`,
    );
    tx.query(
      `INSERT INTO projects
         (id, company_id, name, description, instructions, status, created_at, updated_at)
       VALUES ($1,$2,$3,NULL,'','active',now(),now())`,
      [projectId, companyId, projectTitle],
    );
    tx.query(
      `INSERT INTO project_members
         (id, project_id, user_id, role_id, is_owner, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,now(),now())`,
      [randomUUID(), projectId, userId, adminRole?.id || null],
    );
    tx.query(
      `INSERT INTO project_source_folders
         (id, project_id, local_path, display_name, access_mode, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'write',0,now(),now())`,
      [randomUUID(), projectId, context.cwd, displayName],
    );
    return { projectId, userId };
  }, { mode: "immediate" });
}

async function activeStoredIdentity(db, row) {
  const projectId = String(row?.project_id || "").trim();
  const userId = String(row?.created_by || "").trim();
  if (!projectId || !userId) return null;
  if (projectId === CHAT_PROJECT_ID) return { projectId, userId };
  const membership = await db.queryOne(
    `SELECT p.id
       FROM projects p
       JOIN project_members pm ON pm.project_id=p.id
        AND pm.user_id=$2 AND pm.deleted_at IS NULL
      WHERE p.id=$1 AND p.deleted_at IS NULL
      LIMIT 1`,
    [projectId, userId],
  ).catch(() => null);
  return membership ? { projectId, userId } : null;
}

/** Adopt a native DSH Session only when its Workspace maps to one App identity. */
export async function adoptNativeDshProductSession(db, context) {
  const dshSessionId = String(context?.dshSessionId || "").trim();
  const workspaceId = String(context?.workspaceId || "").trim();
  const cwd = String(context?.cwd || "").trim();
  if (!dshSessionId || !workspaceId || !cwd || !db?.query || !db?.queryOne) return null;

  const storedRows = await db.query(
    `SELECT s.id, s.project_id, s.created_by, s.title, s.session_config
       FROM sessions s
      WHERE s.deleted_at IS NULL AND s.session_config IS NOT NULL`,
  );
  const parsedRows = storedRows.map((row) => ({ ...row, config: parseSessionConfig(row.session_config) }));
  const exactRows = parsedRows.filter((row) => String(row.config.dsh_runtime_session_id || "").trim() === dshSessionId);
  if (exactRows.length > 1) {
    const error = new Error("同一个 DSH Session 对应多个 App Session，拒绝自动认领");
    error.code = "DSH_PRODUCT_HOST_IDENTITY_CONFLICT";
    throw error;
  }
  if (exactRows.length === 1) {
    const row = exactRows[0];
    const boundCwd = String(row.config.dsh_runtime_cwd || "").trim();
    const identity = await activeStoredIdentity(db, row);
    if (!identity || (boundCwd && boundCwd !== cwd)) return null;
    const title = String(context?.title || "").trim();
    if (title && title !== String(row.title || "").trim()) {
      await db.query(
        "UPDATE sessions SET title=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL",
        [row.id, title],
      );
    }
    const binding = {
      db,
      dshSessionId,
      appSessionId: String(row.id || "").trim(),
      projectId: identity.projectId,
      userId: identity.userId,
      cwd,
    };
    bindDshSessionState(binding);
    return binding;
  }

  const storedCandidates = [];
  for (const row of parsedRows) {
    if (String(row.config.dsh_runtime_cwd || "").trim() !== cwd) continue;
    const identity = await activeStoredIdentity(db, row);
    if (identity) storedCandidates.push(identity);
  }
  let identity = distinctIdentity(storedCandidates);
  if (!identity && storedCandidates.length === 0) {
    const folderCandidates = await db.query(WORKSPACE_IDENTITY_SQL, [cwd]);
    const folderIdentities = normalizedIdentities(folderCandidates);
    if (folderIdentities.length > 1) return null;
    identity = folderIdentities[0] || createNativeWorkspaceIdentity(db, {
      cwd,
      workspaceTitle: String(context?.workspaceTitle || "").trim(),
    });
  }
  if (!identity) return null;

  const appSessionId = randomUUID();
  const title = String(context?.title || "").trim() || "新建对话";
  const sessionConfig = JSON.stringify({
    runtime_backend: "dsh",
    dsh_runtime_session_id: dshSessionId,
    dsh_runtime_cwd: cwd,
    dsh_runtime_workspace_id: workspaceId,
  });
  await db.query(
    `INSERT INTO sessions
       (id, project_id, created_by, title, description, source_type, source_id,
        action_type, status, message_count, session_config, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NULL,'agent',$2,'agentic_chat','active',0,$5,now(),now())`,
    [appSessionId, identity.projectId, identity.userId, title, sessionConfig],
  );
  const binding = {
    db,
    dshSessionId,
    appSessionId,
    projectId: identity.projectId,
    userId: identity.userId,
    cwd,
  };
  bindDshSessionState(binding);
  return binding;
}

/**
 * The business services the dispatcher calls. Held as a mutable registry so
 * tests can inject mocks (ES module exports are read-only at runtime). The
 * production default is the real app/projects module.
 */
export const services = {
  listProjects: projectsService.listProjects,
  listAgentSessions: sessionService.listAgentSessions,
  createAgentSession: async (ctx, input) => {
    const { createSession } = await import("../../app/session/index.js");
    return createSession(ctx, input);
  },
  adoptNativeDshSession: async (context) => {
    const db = await import("../../db.js");
    return adoptNativeDshProductSession(db, context);
  },
  createProjectOfficeArtifact,
  editProjectOfficeArtifact,
  inspectProjectOfficeArtifact,
  createCanvas,
  createCanvasSuggestion,
  editCanvas,
  getCanvas,
};

/**
 * Test seam: override one or more services (restored by returning the previous
 * values). Production never calls this.
 * @param {Partial<typeof services>} overrides
 * @returns {Partial<typeof services>} the previous values (pass to restore).
 */
export function overrideServices(overrides) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = services[key];
    services[key] = overrides[key];
  }
  return previous;
}

const HANDLERS = Object.freeze({
  projectList: handleProjectList,
  conversationList: handleConversationList,
  conversationCreateScope: handleConversationCreateScope,
  conversationCreate: handleConversationCreate,
  conversationContext: handleConversationContext,
  capabilitySnapshot: handleCapabilitySnapshot,
  skillList: handleSkillList,
  skillGet: handleRemovedPluginCapability,
  mcpToolList: handleMcpToolList,
  mcpToolCall: handleRemovedPluginCapability,
  artifactOfficeInspect: handleArtifactOfficeInspect,
  artifactOfficeCreate: handleArtifactOfficeCreate,
  artifactOfficeEdit: handleArtifactOfficeEdit,
  canvasInspect: handleCanvasInspect,
  canvasCreate: handleCanvasCreate,
  canvasEdit: handleCanvasEdit,
  canvasSuggest: handleCanvasSuggest,
  uiRender: handleUiRender,
  ...Object.fromEntries([...DESKTOP_NATIVE_METHODS].map((method) => [method, handleDesktopNative])),
});

async function handleDesktopNative({ nativeHost, sessionId, method, payload, signal }) {
  if (!nativeHost) throw productRejected("Desktop Native Host 不可用");
  return nativeHost.request(sessionId, method, payload, signal);
}

function handleCapabilitySnapshot() {
  return {
    revision: "profile-bundles-v1",
    truncated: false,
    selectedPlugins: [],
    selectedSkills: [],
    plugins: [],
    bridge: {
      context: "available",
      skills: "not-bridged",
      mcp: "not-bridged",
      pages: "app-only",
    },
  };
}

function handleSkillList() {
  return { revision: "profile-bundles-v1", items: [] };
}

function handleMcpToolList() {
  return { revision: "profile-bundles-v1", items: [], unavailable: [] };
}

function handleRemovedPluginCapability() {
  throw productRejected("旧项目 Plugin Skill 和 MCP 桥接已移除；请使用 DSH Profile Bundle 的原生能力");
}

function productErrorCode(error) {
  if (error?.name === "AbortError") return "product-rejected";
  if (Number(error?.status) >= 400 && Number(error?.status) < 500) return "product-rejected";
  return error?.code === "product-timeout" || error?.code === "product-rejected"
    ? error.code
    : "product-unavailable";
}

/**
 * Build a dispatcher bound to a specific dsh-work session identity and db.
 * @param {object} deps
 * @param {object} deps.db - dsh-work database handle ({ query, queryOne, transaction }).
 * @param {() => string|number} deps.resolveUserId - returns the userId bound to the calling DSH session.
 * @returns {{ handle(message: object): Promise<object> }} the dispatcher.
 */
export function createProductHostDispatcher({
  db,
  resolveUserId,
  resolveProjectId,
  resolveAppSessionId,
}) {
  const inFlight = new Map();
  return {
    async handle(message) {
      const id = message?.id;
      const method = message?.method;
      const handler = HANDLERS[method];
      if (!handler) {
        return response(id, { ok: false, error: { code: "product-rejected", message: `不支持的 productHost 方法：${method}` } });
      }
      const controller = new AbortController();
      inFlight.set(id, { sessionId: String(message?.sessionId || ""), controller });
      try {
        const value = await handler({
          db,
          resolveUserId,
          resolveProjectId,
          resolveAppSessionId,
          payload: message.payload || {},
          signal: controller.signal,
        });
        return response(id, { ok: true, value });
      } catch (error) {
        const code = productErrorCode(error);
        return response(id, { ok: false, error: { code, message: error?.message || String(error) } });
      } finally {
        inFlight.delete(id);
      }
    },
    cancel(message) {
      const pending = inFlight.get(message?.id);
      if (!pending || pending.sessionId !== String(message?.sessionId || "")) return false;
      pending.controller.abort(new DOMException("product-host caller cancelled", "AbortError"));
      return true;
    },
    dispose() {
      for (const pending of inFlight.values()) {
        pending.controller.abort(new DOMException("product-host dispatcher disposed", "AbortError"));
      }
      inFlight.clear();
      return undefined;
    },
  };
}

/**
 * Null dispatcher: rejects every product-request with product-unavailable.
 * Used when no dsh-work session identity is bound (the child still loads, but
 * product-host calls fail loud instead of hanging).
 */
export const nullProductHostDispatcher = {
  async handle(message) {
    return response(message?.id, { ok: false, error: { code: "product-unavailable", message: "productHost 未接入 DSH Desktop 业务服务" } });
  },
  cancel() {
    return false;
  },
  async dispose() {},
};

/**
 * Session-addressed dispatcher for the process-wide DSH child. Bindings are
 * established from authorized App Session rows or an unambiguous parent-owned
 * Workspace mapping and remain available across turns and child restarts. Each
 * request selects its binding with the DSH-owned sessionId; userId and projectId
 * never come from the child payload.
 */
export function createSessionProductHostDispatcher({
  nativeHost = createDesktopNativeHostTransport(),
  resolveNativeSessionContext = async () => null,
} = {}) {
  const bindings = new Map();
  const nativeSessions = new Set();
  const nativeAdoptions = new Map();
  const inFlight = new Map();
  let disposed = false;
  const bind = (next) => {
    const dshSessionId = String(next?.dshSessionId || "").trim();
    const appSessionId = String(next?.appSessionId || "").trim();
    if (!dshSessionId || !appSessionId || !next?.db) {
      const error = new Error("注册 DSH ProductHost 绑定需要 dshSessionId、appSessionId 和数据库连接");
      error.code = "DSH_PRODUCT_HOST_BINDING_INVALID";
      throw error;
    }
    const binding = {
      db: next.db,
      dshSessionId,
      appSessionId,
      userId: String(next.userId || ""),
      projectId: String(next.projectId || "").trim() || null,
    };
    const current = bindings.get(dshSessionId);
    if (current && (current.appSessionId !== binding.appSessionId
      || current.userId !== binding.userId
      || current.projectId !== binding.projectId)) {
      const error = new Error("同一个 DSH session 不能改绑到另一项 DSH Desktop 身份");
      error.code = "DSH_PRODUCT_HOST_IDENTITY_CONFLICT";
      throw error;
    }
    bindings.set(dshSessionId, binding);
    nativeSessions.delete(dshSessionId);
    return dshSessionId;
  };
  const adoptNative = async (dshSessionId) => {
    if (disposed) return null;
    const current = bindings.get(dshSessionId);
    if (current) return current;
    if (!nativeSessions.has(dshSessionId)) return null;
    const running = nativeAdoptions.get(dshSessionId);
    if (running) return running;
    const adoption = (async () => {
      const context = await resolveNativeSessionContext(dshSessionId);
      if (!context) return null;
      if (String(context.dshSessionId || "").trim() !== dshSessionId) {
        const error = new Error("DSH Session 上下文返回了不同的 Session 标识");
        error.code = "DSH_PRODUCT_HOST_IDENTITY_CONFLICT";
        throw error;
      }
      const binding = await services.adoptNativeDshSession(context);
      if (!binding) return null;
      if (String(binding.dshSessionId || "").trim() !== dshSessionId) {
        const error = new Error("App Session 认领结果与发起请求的 DSH Session 不一致");
        error.code = "DSH_PRODUCT_HOST_IDENTITY_CONFLICT";
        throw error;
      }
      if (disposed || !nativeSessions.has(dshSessionId)) return null;
      bind(binding);
      return bindings.get(dshSessionId) || null;
    })();
    nativeAdoptions.set(dshSessionId, adoption);
    try {
      return await adoption;
    } finally {
      nativeAdoptions.delete(dshSessionId);
    }
  };
  return {
    bind,
    registerNativeHostSession(dshSessionId) {
      const key = String(dshSessionId || "").trim();
      if (!key || key.length > 160) {
        const error = new Error("注册原生 Host Session 需要有效的 DSH sessionId");
        error.code = "DSH_PRODUCT_HOST_NATIVE_SESSION_INVALID";
        throw error;
      }
      nativeSessions.add(key);
      return key;
    },
    clearNativeHostSession(dshSessionId) {
      const key = String(dshSessionId || "").trim();
      const removed = nativeSessions.delete(key);
      for (const [id, pending] of inFlight) {
        if (pending.sessionId !== key || pending.binding) continue;
        pending.controller.abort(new DOMException("product-host native Session announcement removed", "AbortError"));
        inFlight.delete(id);
      }
      return removed;
    },
    clear(dshSessionId) {
      const key = String(dshSessionId || "").trim();
      const binding = bindings.get(key);
      const native = nativeSessions.delete(key);
      if (!binding && !native) return false;
      if (binding) bindings.delete(key);
      for (const [id, pending] of inFlight) {
        if (pending.sessionId !== key) continue;
        pending.controller.abort(new DOMException("product-host Session binding removed", "AbortError"));
        inFlight.delete(id);
      }
      return true;
    },
    async handle(message) {
      const id = message?.id;
      const dshSessionId = String(message?.sessionId || "").trim();
      if (!dshSessionId) {
        return response(id, { ok: false, error: { code: "product-rejected", message: "productHost 请求缺少 DSH sessionId" } });
      }
      const method = message?.method;
      const handler = HANDLERS[method];
      if (!handler) {
        return response(id, { ok: false, error: { code: "product-rejected", message: `不支持的 productHost 方法：${method}` } });
      }
      let binding = bindings.get(dshSessionId);
      if (!binding && nativeSessions.has(dshSessionId) && !DESKTOP_NATIVE_METHODS.has(method)) {
        try {
          binding = await adoptNative(dshSessionId);
        } catch (error) {
          const code = productErrorCode(error);
          return response(id, { ok: false, error: { code, message: error?.message || String(error) } });
        }
      }
      const nativeOnly = !binding
        && nativeSessions.has(dshSessionId)
        && (ANNOUNCED_SESSION_METHODS.has(method) || DESKTOP_NATIVE_METHODS.has(method));
      if (!binding && !nativeOnly) {
        return response(id, { ok: false, error: { code: "product-unavailable", message: "productHost 没有这个 DSH session 的授权绑定" } });
      }
      const controller = new AbortController();
      inFlight.set(id, { sessionId: dshSessionId, controller, binding: Boolean(binding) });
      try {
        const value = await handler({
          db: binding?.db || null,
          resolveUserId: binding ? () => binding.userId : () => null,
          resolveProjectId: binding ? () => binding.projectId || null : () => null,
          resolveAppSessionId: binding ? () => binding.appSessionId : () => null,
          nativeHost,
          productBound: Boolean(binding),
          sessionId: dshSessionId,
          method,
          payload: message.payload || {},
          signal: controller.signal,
        });
        return response(id, { ok: true, value });
      } catch (error) {
        const code = productErrorCode(error);
        return response(id, { ok: false, error: { code, message: error?.message || String(error) } });
      } finally {
        inFlight.delete(id);
      }
    },
    cancel(message) {
      const pending = inFlight.get(message?.id);
      if (!pending || pending.sessionId !== String(message?.sessionId || "").trim()) return false;
      pending.controller.abort(new DOMException("product-host caller cancelled", "AbortError"));
      return true;
    },
    async dispose() {
      disposed = true;
      for (const pending of inFlight.values()) {
        pending.controller.abort(new DOMException("product-host dispatcher disposed", "AbortError"));
      }
      inFlight.clear();
      await Promise.allSettled(nativeAdoptions.values());
      nativeAdoptions.clear();
      bindings.clear();
      nativeSessions.clear();
      nativeHost.dispose?.();
    },
  };
}

function response(id, result) {
  return { type: "product-response", id, result };
}

async function handleProjectList({ db, resolveUserId, payload }) {
  const userId = resolveUserId();
  const ctx = { query: db.query, queryOne: db.queryOne, transaction: db.transaction, userId };
  const r = await services.listProjects(ctx, { query: { search: payload.search || "" }, body: {}, params: {} });
  const all = r.data?.items || [];
  const truncated = all.length > MAX_ITEMS;
  const items = truncated ? all.slice(0, MAX_ITEMS) : all;
  return {
    items: items.map((p) => ({ id: String(p.id), name: String(p.name || ""), ...(p.description ? { description: String(p.description) } : {}) })),
    total: r.data?.total ?? all.length,
    page: 1,
    perPage: items.length,
    truncated,
  };
}

async function handleConversationList({ db, resolveUserId, resolveProjectId, payload }) {
  const userId = resolveUserId();
  const projectId = resolveProjectId();
  if (!projectId) throw new Error("conversationList 需要活动项目绑定");
  const ctx = { query: db.query, queryOne: db.queryOne, transaction: db.transaction, userId };
  const r = await services.listAgentSessions(ctx, {
    params: { pid: projectId },
    body: {},
    query: payload.archived === true ? { archived: "1" } : {},
  });
  const all = r.data?.sessions || r.data?.items || [];
  const truncated = all.length > MAX_ITEMS;
  const items = (truncated ? all.slice(0, MAX_ITEMS) : all).map((s) => ({
    id: String(s.id || s.session_id || ""),
    title: String(s.title || "（未命名对话）"),
    archived: String(s.status || "active") === "archived",
  }));
  return {
    items,
    total: all.length,
    truncated,
  };
}

function handleConversationCreateScope({ productBound }) {
  return { mode: productBound ? "product" : "dsh" };
}

async function handleConversationCreate({ db, resolveUserId, resolveProjectId, payload }) {
  const userId = String(resolveUserId?.() || "").trim();
  const projectId = String(resolveProjectId?.() || "").trim();
  const title = String(payload?.title || "").trim();
  if (!userId || !projectId) throw productRejected("conversationCreate 需要活动项目和用户绑定");
  if (!title) throw productRejected("conversationCreate 需要 title");
  const agentPreset = String(payload?.agentPreset || "").trim();
  const ctx = { query: db.query, queryOne: db.queryOne, transaction: db.transaction, userId };
  const result = await services.createAgentSession(ctx, {
    params: { pid: projectId },
    query: {},
    body: {
      title,
      source_type: "agent",
      source_id: projectId,
      action_type: "agentic_chat",
      ...(agentPreset ? { agent_preset: agentPreset } : {}),
    },
  });
  const conversation = result?.data;
  let sessionConfig = {};
  try {
    sessionConfig = typeof conversation?.session_config === "string"
      ? JSON.parse(conversation.session_config)
      : (conversation?.session_config || {});
  } catch {
    sessionConfig = {};
  }
  const dshSessionId = String(sessionConfig.dsh_runtime_session_id || "").trim();
  const appSessionId = String(conversation?.id || "").trim();
  if (!appSessionId || !dshSessionId) {
    throw new Error("conversationCreate 没有返回完整的 App 和 DSH Session 标识");
  }
  return {
    appSessionId,
    dshSessionId,
    title: String(conversation?.title || title),
  };
}

async function handleConversationContext({
  db,
  resolveUserId,
  resolveProjectId,
  resolveAppSessionId,
}) {
  const userId = String(resolveUserId?.() || "").trim();
  const projectId = String(resolveProjectId?.() || "").trim();
  const appSessionId = String(resolveAppSessionId?.() || "").trim();
  if (!(userId && projectId && appSessionId)) return { instructions: null };
  const session = await db.queryOne(
    "SELECT action_type,session_config FROM sessions WHERE id=$1 AND project_id=$2 AND created_by=$3 AND deleted_at IS NULL LIMIT 1",
    [appSessionId, projectId, userId],
  ).catch(() => null);
  if (!session) throw productRejected("conversationContext 找不到绑定的 DSH Desktop Session");
  let sessionConfig = {};
  try {
    sessionConfig = typeof session.session_config === "string"
      ? JSON.parse(session.session_config)
      : (session.session_config || {});
  } catch {
    sessionConfig = {};
  }
  const temporary = session.action_type === "temporary_chat" || sessionConfig.temporary === true;
  const appInstructions = await readAppInstructions(db, userId);
  const projectRow = projectId === CHAT_PROJECT_ID
    ? null
    : await db.queryOne(
      "SELECT instructions FROM projects WHERE id=$1 AND deleted_at IS NULL LIMIT 1",
      [projectId],
    ).catch(() => null);
  const projectInstructions = String(projectRow?.instructions || "").trim();
  const instructionText = [
    buildAppInstructionsMarkdown(appInstructions),
    buildProjectInstructionsMarkdown(projectInstructions),
    temporary
      ? "## Temporary conversation\n\n当前是临时对话。这里的内容不会进入普通对话历史，也不能作为其他对话的记忆来源。"
      : "",
  ].filter(Boolean).join("\n\n");
  return {
    instructions: {
      text: instructionText,
      scopes: {
        application: Boolean(appInstructions),
        project: Boolean(projectInstructions),
        temporary,
      },
    },
  };
}

function productRejected(message) {
  const error = new Error(message);
  error.code = "product-rejected";
  return error;
}

function boundOfficeRequest({ db, resolveUserId, resolveProjectId, resolveAppSessionId, payload }) {
  const projectId = String(resolveProjectId?.() || "").trim();
  const requestedProjectId = String(payload?.project_id || projectId).trim();
  const appSessionId = String(resolveAppSessionId?.() || "").trim();
  if (!projectId || !appSessionId) throw productRejected("Office 产物工具需要活动项目和 DSH Desktop Session 绑定");
  if (requestedProjectId !== projectId) throw productRejected("Office 产物工具只能操作当前 DSH Session 绑定的项目");
  return {
    projectId,
    appSessionId,
    ctx: {
      query: db.query,
      queryOne: db.queryOne,
      transaction: db.transaction,
      userId: resolveUserId(),
    },
  };
}

function officeSource(appSessionId) {
  return { sessionId: appSessionId };
}

function boundCanvasRequest({ db, resolveUserId, resolveProjectId, resolveAppSessionId }) {
  const projectId = String(resolveProjectId?.() || "").trim();
  const appSessionId = String(resolveAppSessionId?.() || "").trim();
  if (!projectId || !appSessionId) throw productRejected("Canvas 工具需要活动项目和 DSH Desktop Session 绑定");
  return {
    projectId,
    appSessionId,
    userId: resolveUserId(),
    ctx: {
      query: db.query,
      queryOne: db.queryOne,
      transaction: db.transaction,
      userId: resolveUserId(),
    },
  };
}

function canvasSource() {
  return { type: "tool" };
}

function officeDocumentForModel(document) {
  if (!document || typeof document !== "object") return document;
  return {
    ...document,
    sections: Array.isArray(document.sections)
      ? document.sections.map(({ preview_svg: _previewSvg, ...section }) => section)
      : document.sections,
  };
}

async function handleArtifactOfficeInspect(deps) {
  const { projectId, ctx } = boundOfficeRequest(deps);
  const artifactId = String(deps.payload?.artifact_id || "").trim();
  if (!artifactId) throw productRejected("artifactOfficeInspect 需要 artifact_id");
  const result = await services.inspectProjectOfficeArtifact(ctx, {
    projectId,
    artifactId,
    versionId: String(deps.payload?.version_id || "").trim(),
  });
  return {
    success: true,
    ...result,
    document: officeDocumentForModel(result.document),
  };
}

async function handleArtifactOfficeCreate(deps) {
  const { projectId, appSessionId, ctx } = boundOfficeRequest(deps);
  const format = String(deps.payload?.format || "").trim();
  if (!format) throw productRejected("artifactOfficeCreate 需要 format");
  const result = await services.createProjectOfficeArtifact(ctx, {
    projectId,
    format,
    name: deps.payload?.name,
    title: deps.payload?.title,
    content: deps.payload?.content,
    specification: deps.payload?.specification,
    description: deps.payload?.description,
    source: officeSource(appSessionId),
  });
  return { success: true, ...result };
}

async function handleArtifactOfficeEdit(deps) {
  const { projectId, appSessionId, ctx } = boundOfficeRequest(deps);
  const artifactId = String(deps.payload?.artifact_id || "").trim();
  const baseVersionId = String(deps.payload?.base_version_id || "").trim();
  if (!artifactId || !baseVersionId) {
    throw productRejected("artifactOfficeEdit 需要 artifact_id 和 base_version_id");
  }
  const result = await services.editProjectOfficeArtifact(ctx, {
    projectId,
    artifactId,
    baseVersionId,
    operations: deps.payload?.operations,
    changeSummary: deps.payload?.change_summary,
    source: officeSource(appSessionId),
  });
  return { success: true, ...result };
}

async function handleCanvasInspect(deps) {
  const { projectId, appSessionId, userId, ctx } = boundCanvasRequest(deps);
  const canvasId = String(deps.payload?.canvas_id || "").trim();
  if (!canvasId) throw productRejected("canvasInspect 需要 canvas_id");
  const canvas = await services.getCanvas(ctx, { userId, sessionId: appSessionId, canvasId });
  if (String(canvas?.project_id || "") !== projectId) throw productRejected("Canvas 不属于当前 DSH Session 绑定的项目");
  return { success: true, project_id: projectId, canvas };
}

async function handleCanvasCreate(deps) {
  const { projectId, appSessionId, userId, ctx } = boundCanvasRequest(deps);
  const result = await services.createCanvas(ctx, {
    userId,
    sessionId: appSessionId,
    title: deps.payload?.title,
    kind: deps.payload?.kind,
    language: deps.payload?.language,
    content: typeof deps.payload?.content === "string" ? deps.payload.content : "",
    changeSummary: deps.payload?.change_summary,
    source: canvasSource(),
    metadata: { created_by: "canvas_create" },
  });
  if (String(result?.canvas?.project_id || "") !== projectId) throw productRejected("创建的 Canvas 不属于当前 DSH Session 绑定的项目");
  return { success: true, project_id: projectId, ...result };
}

async function handleCanvasEdit(deps) {
  const { projectId, appSessionId, userId, ctx } = boundCanvasRequest(deps);
  const canvasId = String(deps.payload?.canvas_id || "").trim();
  const baseVersionId = String(deps.payload?.base_version_id || "").trim();
  if (!canvasId || !baseVersionId) throw productRejected("canvasEdit 需要 canvas_id 和 base_version_id");
  const result = await services.editCanvas(ctx, {
    userId,
    sessionId: appSessionId,
    canvasId,
    baseVersionId,
    ...(typeof deps.payload?.content === "string"
      ? { content: deps.payload.content }
      : { operations: deps.payload?.operations }),
    changeSummary: deps.payload?.change_summary,
    source: canvasSource(),
    metadata: { edited_by: "canvas_edit" },
  });
  if (String(result?.canvas?.project_id || "") !== projectId) throw productRejected("Canvas 不属于当前 DSH Session 绑定的项目");
  return { success: true, project_id: projectId, ...result };
}

async function handleCanvasSuggest(deps) {
  const { projectId, appSessionId, userId, ctx } = boundCanvasRequest(deps);
  const canvasId = String(deps.payload?.canvas_id || "").trim();
  const baseVersionId = String(deps.payload?.base_version_id || "").trim();
  if (!canvasId || !baseVersionId) throw productRejected("canvasSuggest 需要 canvas_id 和 base_version_id");
  const suggestion = await services.createCanvasSuggestion(ctx, {
    userId,
    sessionId: appSessionId,
    canvasId,
    baseVersionId,
    start: deps.payload?.start,
    end: deps.payload?.end,
    selectedText: deps.payload?.selected_text,
    replacementText: deps.payload?.replacement_text,
    instruction: deps.payload?.instruction,
    source: canvasSource(),
  });
  const canvas = await services.getCanvas(ctx, { userId, sessionId: appSessionId, canvasId });
  if (String(canvas?.project_id || "") !== projectId) throw productRejected("Canvas 不属于当前 DSH Session 绑定的项目");
  return { success: true, project_id: projectId, suggestion, canvas };
}

function handleUiRender({ resolveProjectId, resolveAppSessionId, payload }) {
  const projectId = String(resolveProjectId?.() || "").trim();
  const appSessionId = String(resolveAppSessionId?.() || "").trim();
  if (!projectId || !appSessionId) throw productRejected("uiRender 需要活动项目和 DSH Desktop Session 绑定");
  const { document, stats } = parseGenerativeUiDocument(payload, { allowedLocalRoots: [] });
  return {
    success: true,
    project_id: projectId,
    session_id: appSessionId,
    generative_ui: document,
    generative_ui_stats: stats,
    document_hash: hashGenerativeUiDocument(document),
  };
}
