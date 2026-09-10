import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../../config/paths.js";
import { dshRuntimeEnabled, resolveDshRuntimeDistribution } from "./source_locator.js";
import { createSessionProductHostDispatcher } from "./product_host_dispatcher.js";
import { ensureDshWorkspaceSession } from "./session_attachment.js";
import { ensureDshProfileInitialized } from "./profile_initialization.js";

const CHILD_PATH = fileURLToPath(new URL("./source_runtime_child.mjs", import.meta.url));
const NPM_RUNTIME_CHILD_PATH = fileURLToPath(new URL("./npm_runtime_child.mjs", import.meta.url));
const PROFILE_MODULE_LOADER_PATH = fileURLToPath(new URL("./profile_module_loader.mjs", import.meta.url));
const CLIENT_PATCH_PATH = fileURLToPath(new URL("./desktop_web.patch.yml", import.meta.url));
const START_TIMEOUT_MS = 60_000;
const CLIENT_SURFACE_TIMEOUT_MS = 60_000;
const STREAM_RETRY_BASE_MS = 500;
const STREAM_RETRY_MAX_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5_000;
const REMOTE_STREAM_MUX_PATH = "/api/remote.mux";
const REMOTE_EVENT_STREAM_ENDPOINT = "$events";
const REMOTE_EVENT_RESULT_ENDPOINT = "$events/result";

function errorFromPayload(payload, fallback) {
  const error = new Error(payload?.message || fallback);
  error.name = payload?.name || "Error";
  if (payload?.code) error.code = payload.code;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function streamFailure(stream, message, code = "DSH_EVENT_STREAM_FAILED") {
  const error = new Error(message);
  error.code = code;
  error.stream = stream;
  return error;
}

/** Accept only the loopback origin emitted by the trusted DSH child. */
export function normalizeDshClientSurface(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    const error = new Error("DSH 客户端地址不是受信任的 loopback HTTP origin");
    error.code = "DSH_CLIENT_SURFACE_INVALID";
    throw error;
  }
  return `${url.origin}/`;
}

/** Accept the alpha Client launch URL and reduce it to a clean origin plus token. */
export function normalizeDshClientLaunchUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.hash) {
    const error = new Error("DSH 客户端启动地址不是受信任的 loopback HTTP URL");
    error.code = "DSH_CLIENT_SURFACE_INVALID";
    throw error;
  }
  const tokenNames = [...url.searchParams.keys()];
  const tokens = url.searchParams.getAll("token");
  if (tokenNames.some((name) => name !== "token") || tokens.length > 1
    || (tokens.length === 1 && !tokens[0])) {
    const error = new Error("DSH 客户端启动地址包含无效认证参数");
    error.code = "DSH_CLIENT_SURFACE_INVALID";
    throw error;
  }
  return {
    surface: `${url.origin}/`,
    launchUrl: url.href,
    hasLaunchToken: tokens.length === 1,
  };
}

/** Alpha 1 replaces the two legacy event sockets with the Gateway Remote mux. */
export function usesDshRemoteStreamProtocol(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 0 || minor > 1 || patch >= 2;
}

/** Join active LLM routes with the settings directory used to edit those routes. */
export function mergeDshProviderDirectory(registered = [], configurable = []) {
  const activeById = new Map((Array.isArray(registered) ? registered : []).map((provider) => [
    provider?.provider || provider?.id,
    provider,
  ]).filter(([id]) => id));
  const joined = (Array.isArray(configurable) ? configurable : []).map((entry) => {
    const active = activeById.get(entry?.provider);
    activeById.delete(entry?.provider);
    return {
      ...(active || {}),
      ...entry,
      id: entry.provider,
      name: entry.displayName,
      provider: entry.provider,
      provider_name: entry.displayName,
      registered: Boolean(active),
    };
  });
  for (const provider of activeById.values()) {
    joined.push({
      ...provider,
      provider: provider?.provider || provider?.id,
      provider_name: provider?.provider_name || provider?.name,
      registered: true,
    });
  }
  return joined;
}

function cookieFromResponse(response) {
  const cookies = typeof response.headers?.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  const header = cookies[0] || response.headers?.get("set-cookie") || "";
  const cookie = String(header).split(";", 1)[0].trim();
  return cookie || null;
}

function remoteError(frame, fallback) {
  return errorFromPayload(frame?.error, fallback);
}

function remoteWaterfallMuxFrame(frame) {
  const eventId = String(frame?.eventId || "").trim();
  const sessionId = String(frame?.agentId || "").trim();
  const request = frame?.request;
  if (frame?.type !== "waterfall" || !eventId || !sessionId
    || !request || typeof request !== "object" || Array.isArray(request)) return null;
  if (frame.event === "approval/request") {
    const toolName = String(request.toolName || "").trim();
    if (!toolName) return null;
    return {
      rpcId: eventId,
      payload: {
        type: "approval/requested",
        sessionId,
        approvalId: eventId,
        toolName,
        ...(request.callId ? { callId: String(request.callId) } : {}),
        ...(request.reason ? { reason: String(request.reason) } : {}),
      },
    };
  }
  if (frame.event === "user-questions/request") {
    const questions = Array.isArray(request.questions) ? request.questions : [];
    if (!questions.length) return null;
    return {
      rpcId: eventId,
      payload: { type: "question/requested", sessionId, questions },
    };
  }
  return null;
}

function remoteWaterfallResolvedFrame(wait) {
  if (wait.event === "approval/request") {
    return {
      rpcId: wait.eventId,
      payload: {
        type: "approval/resolved",
        sessionId: wait.sessionId,
        approvalId: wait.eventId,
      },
    };
  }
  return {
    rpcId: wait.eventId,
    payload: {
      type: "question/resolved",
      sessionId: wait.sessionId,
      questionRpcId: wait.eventId,
    },
  };
}

function remoteWaterfallResult(wait, payload) {
  if (wait.event === "approval/request") return payload?.outcome;
  if (wait.event === "user-questions/request") return payload?.answer;
  return undefined;
}

/** Resolve one native DSH Session only from its authoritative Workspace account. */
export function resolveNativeProductSessionContext(dshSessionId, workspaceBaseline, sessionList) {
  const sessionId = String(dshSessionId || "").trim();
  if (!sessionId) return null;
  const workspaces = Array.isArray(workspaceBaseline?.items) ? workspaceBaseline.items : [];
  const workspace = workspaces.find((item) => (
    Array.isArray(item?.sessionIds) && item.sessionIds.map(String).includes(sessionId)
  ));
  const workspaceId = String(workspace?.workspaceId || "").trim();
  const cwd = String(workspace?.path || "").trim();
  if (!workspaceId || !cwd) return null;
  const sessions = Array.isArray(sessionList?.items) ? sessionList.items : [];
  const session = sessions.find((item) => String(item?.sessionId || item?.id || "").trim() === sessionId);
  const sessionCwd = String(session?.cwd || "").trim();
  if (sessionCwd && sessionCwd !== cwd) return null;
  return {
    dshSessionId: sessionId,
    workspaceId,
    cwd,
    workspaceTitle: String(workspace?.title || "").trim(),
    title: String(session?.title || session?.projections?.values?.title || "").trim() || "新建对话",
  };
}

export class DshRuntimeClient extends EventEmitter {
  constructor({
    env = process.env,
    spawn = fork,
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: WebSocketImpl = globalThis.WebSocket,
    productHostDispatcher = null,
  } = {}) {
    super();
    this.env = env;
    this.spawn = spawn;
    this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.productHostDispatcher = productHostDispatcher || createSessionProductHostDispatcher({
      resolveNativeSessionContext: (sessionId) => this.#resolveNativeProductSessionContext(sessionId),
    });
    this.child = null;
    this.starting = null;
    this.closing = false;
    this.restarting = false;
    this.restartTimer = null;
    this.restartAttempt = 0;
    this.clientSurface = null;
    this.clientLaunchUrl = null;
    this.clientSurfaceError = null;
    this.clientAuthCookie = null;
    this.clientReadyPromise = null;
    this.clientReadyResolve = null;
    this.clientReadyReject = null;
    this.runtimeVersion = null;
    this.remoteStreamProtocol = false;
    this.streamController = null;
    this.streamLoop = null;
    this.remoteEventClientId = null;
    this.remoteEventWaits = new Map();
  }

  /**
   * Register the parent-owned identity for one DSH Session. The binding remains
   * valid across turns and child restarts; the child supplies only dshSessionId
   * on each product request.
   */
  registerProductHostSession({ db, userId, projectId, appSessionId, dshSessionId }) {
    if (typeof this.productHostDispatcher.bind === "function") {
      return this.productHostDispatcher.bind({ db, userId, projectId, appSessionId, dshSessionId });
    }
    return dshSessionId;
  }

  unregisterProductHostSession(dshSessionId) {
    if (typeof this.productHostDispatcher.clear === "function") {
      return this.productHostDispatcher.clear(dshSessionId);
    }
    return false;
  }

  registerNativeProductHostSession(dshSessionId) {
    if (typeof this.productHostDispatcher.registerNativeHostSession === "function") {
      return this.productHostDispatcher.registerNativeHostSession(dshSessionId);
    }
    return dshSessionId;
  }

  unregisterNativeProductHostSession(dshSessionId) {
    if (typeof this.productHostDispatcher.clearNativeHostSession === "function") {
      return this.productHostDispatcher.clearNativeHostSession(dshSessionId);
    }
    return false;
  }

  async #resolveNativeProductSessionContext(dshSessionId) {
    const [workspaceBaseline, sessionList] = await Promise.all([
      this.request("workspace.list", {}),
      this.request("session.list", {}),
    ]);
    return resolveNativeProductSessionContext(dshSessionId, workspaceBaseline, sessionList);
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.child?.connected) return this;
    this.starting = this.#start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async #start() {
    const resolved = resolveDshRuntimeDistribution({ env: this.env });
    if (!resolved) throw new Error("DSH 运行时未启用");
    this.clientSurface = null;
    this.clientLaunchUrl = null;
    this.clientSurfaceError = null;
    this.clientAuthCookie = null;
    this.runtimeVersion = null;
    this.remoteStreamProtocol = false;
    this.clientReadyPromise = new Promise((resolve, reject) => {
      this.clientReadyResolve = resolve;
      this.clientReadyReject = reject;
    });
    void this.clientReadyPromise.catch(() => {});
    const dshHome = this.env.DSH_RUNTIME_HOME || dataRoot();
    const childEnv = {
      ...process.env,
      ...this.env,
      DSH_RUNTIME_DISTRIBUTION: resolved.distribution,
      DSH_RUNTIME_VERSION: resolved.version || "",
      DSH_HOME: dshHome,
      DSH_DESKTOP_PROFILE_NAME: "web",
      DSH_TELEMETRY_DISABLED: this.env.DSH_TELEMETRY_DISABLED || "1",
      DSH_APP_BOOT_PATH: resolved.appBootPath,
      DSH_RUNTIME_INSTALL_ANCHOR: resolved.installAnchor,
      ...(resolved.profileBootPath ? { DSH_PROFILE_BOOT_PATH: resolved.profileBootPath } : {}),
    };
    await ensureDshProfileInitialized({
      resolved,
      dshHome,
      env: childEnv,
      appRoot: this.env.DSH_APP_ROOT,
    });
    const profileNodeModules = join(dshHome, "profiles", "web", "node_modules");
    const electronProfileLoader = resolved.distribution === "npm"
      && process.versions.electron
      && existsSync(profileNodeModules);
    const execArgv = resolved.execArgv;
    if (electronProfileLoader) {
      childEnv.DSH_PROFILE_NODE_MODULES = profileNodeModules;
      childEnv.DSH_PROFILE_MODULE_LOADER_PATH = PROFILE_MODULE_LOADER_PATH;
    }
    let launchPath = CHILD_PATH;
    let launchArgs = [];
    if (resolved.launch === "cli") {
      launchPath = NPM_RUNTIME_CHILD_PATH;
      childEnv.DSH_CLI_ENTRY_PATH = resolved.entryPath;
      // DSH 0.1.5 auto-opens the default browser on `web`; the desktop app
      // renders the surface in its own window, so suppress the browser.
      launchArgs = ["web", "--no-open", "--patch", CLIENT_PATCH_PATH];
    }
    const child = this.spawn(launchPath, launchArgs, {
      execPath: process.execPath,
      execArgv,
      cwd: resolved.root,
      env: childEnv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });
    this.child = child;
    child.on("message", (message) => this.#onMessage(message));
    child.once("exit", (code, signal) => this.#onExit(child, code, signal));
    child.once("error", (error) => this.#fail(error));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("DSH 源码运行时启动超时")), START_TIMEOUT_MS);
        timer.unref?.();
        const ready = () => {
          clearTimeout(timer);
          this.off("fatal", fatal);
          resolve();
        };
        const fatal = (error) => {
          clearTimeout(timer);
          this.off("ready", ready);
          reject(error);
        };
        this.once("ready", ready);
        this.once("fatal", fatal);
      });
    } catch (error) {
      if (child.connected) child.disconnect();
      child.kill();
      if (this.child === child) this.child = null;
      throw error;
    }
    return this;
  }

  #onMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      this.runtimeVersion = String(message.version || "");
      this.remoteStreamProtocol = usesDshRemoteStreamProtocol(this.runtimeVersion);
      void this.#activateRuntime(message);
      return;
    }
    if (message.type === "client-ready") {
      try {
        const launch = normalizeDshClientLaunchUrl(message.url);
        this.clientSurface = launch.surface;
        this.clientLaunchUrl = launch.launchUrl;
        this.clientSurfaceError = null;
        if (launch.hasLaunchToken) this.remoteStreamProtocol = true;
        this.#authenticateClient(launch.launchUrl).then((cookie) => {
          this.clientAuthCookie = cookie;
          this.clientReadyResolve?.();
          this.clientReadyResolve = null;
          this.clientReadyReject = null;
          this.emit("client-surface", this.clientSurface);
        }).catch((error) => {
          this.clientSurface = null;
          this.clientLaunchUrl = null;
          this.clientSurfaceError = error;
          this.clientReadyReject?.(error);
          this.clientReadyResolve = null;
          this.clientReadyReject = null;
          this.emit("client-surface-error", error);
        });
      } catch (error) {
        this.clientSurface = null;
        this.clientLaunchUrl = null;
        this.clientSurfaceError = error;
        this.clientReadyReject?.(error);
        this.clientReadyResolve = null;
        this.clientReadyReject = null;
        this.emit("client-surface-error", error);
      }
      return;
    }
    if (message.type === "fatal") {
      this.emit("fatal", errorFromPayload(message.error, "DSH 运行时启动失败"));
      return;
    }
    if (message.type === "product-native-session-ready") {
      try {
        this.registerNativeProductHostSession(message.sessionId);
      } catch (error) {
        this.emit("fatal", error);
      }
      return;
    }
    if (message.type === "product-native-session-released") {
      this.unregisterNativeProductHostSession(message.sessionId);
      return;
    }
    if (message.type === "product-cancel") {
      this.productHostDispatcher.cancel?.(message);
      return;
    }
    if (message.type === "product-request") {
      const child = this.child;
      if (!child?.connected) return;
      void this.productHostDispatcher.handle(message).then((response) => {
        if (child.connected) child.send(response);
      }).catch((error) => {
        if (!child.connected) return;
        child.send({
          type: "product-response",
          id: message.id,
          result: {
            ok: false,
            error: { code: "product-unavailable", message: error?.message || String(error) },
          },
        });
      });
      return;
    }
  }

  async #activateRuntime(message) {
    try {
      await this.clientReadyPromise;
      await this.#startEventStreams();
      this.emit("ready", message);
    } catch (error) {
      this.emit("fatal", error);
    }
  }

  async #startEventStreams() {
    this.#stopEventStreams();
    if (!this.clientSurface) {
      throw streamFailure("all", "DSH Web 客户端地址未在运行时就绪前发布", "DSH_EVENT_STREAM_SURFACE_MISSING");
    }
    const controller = new AbortController();
    this.streamController = controller;
    let openedResolve;
    let openedReject;
    const opened = new Promise((resolve, reject) => {
      openedResolve = resolve;
      openedReject = reject;
    });
    this.streamLoop = this.#runEventStreamLoop(controller, openedResolve, openedReject);
    await opened;
  }

  #stopEventStreams() {
    this.streamController?.abort();
    this.streamController = null;
    this.streamLoop = null;
    this.remoteEventClientId = null;
    this.remoteEventWaits.clear();
  }

  async #runEventStreamLoop(lifecycle, openedResolve, openedReject) {
    if (this.remoteStreamProtocol) {
      await this.#runRemoteEventStreamLoop(lifecycle, openedResolve, openedReject);
      return;
    }
    let firstGeneration = true;
    let attempt = 0;
    while (!lifecycle.signal.aborted && this.child?.connected && !this.closing) {
      const generation = new AbortController();
      const abortGeneration = () => generation.abort();
      lifecycle.signal.addEventListener("abort", abortGeneration, { once: true });
      try {
        const streams = await Promise.all([
          this.#openEventStream("mux", generation.signal),
          this.#openEventStream("host", generation.signal),
        ]);
        if (firstGeneration) openedResolve();
        firstGeneration = false;
        attempt = 0;
        const ended = await Promise.race(streams.map(({ done }) => done));
        if (ended.error) throw ended.error;
        if (!generation.signal.aborted) {
          throw streamFailure("all", "DSH 事件流意外结束");
        }
      } catch (error) {
        if (lifecycle.signal.aborted || this.closing || !this.child?.connected) return;
        if (firstGeneration) {
          openedReject(error);
          return;
        }
        this.emit("stream-error", { stream: error?.stream || "all", error });
      } finally {
        lifecycle.signal.removeEventListener("abort", abortGeneration);
        generation.abort();
      }
      attempt += 1;
      const delay = Math.min(STREAM_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), STREAM_RETRY_MAX_MS);
      await abortableDelay(delay, lifecycle.signal);
    }
  }

  async #openEventStream(stream, signal) {
    if (typeof this.WebSocket !== "function") {
      throw streamFailure(stream, "当前 Node.js 运行时不支持 WebSocket", "DSH_EVENT_STREAM_WEBSOCKET_MISSING");
    }
    const url = new URL(`api/events.${stream}`, this.clientSurface);
    url.protocol = "ws:";
    const socket = this.#createWebSocket(url);
    let opened = false;
    let openResolve;
    let openReject;
    let doneResolve;
    const open = new Promise((resolve, reject) => {
      openResolve = resolve;
      openReject = reject;
    });
    const done = new Promise((resolve) => { doneResolve = resolve; });
    const close = () => {
      try {
        socket.close(1000, "runtime stream stopped");
      } catch {
        // A socket that failed before negotiation is already closed.
      }
    };
    signal.addEventListener("abort", close, { once: true });
    socket.addEventListener("open", () => {
      opened = true;
      openResolve();
    }, { once: true });
    socket.addEventListener("message", (event) => this.#emitEventMessage(stream, event.data));
    socket.addEventListener("error", () => {
      const error = streamFailure(stream, `DSH ${stream} WebSocket 连接失败`, "DSH_EVENT_STREAM_WEBSOCKET_ERROR");
      if (!opened) openReject(error);
      else doneResolve({ error });
    });
    socket.addEventListener("close", () => {
      signal.removeEventListener("abort", close);
      if (!opened) {
        openReject(streamFailure(stream, `DSH ${stream} WebSocket 在就绪前关闭`, "DSH_EVENT_STREAM_WEBSOCKET_CLOSED"));
      } else {
        doneResolve({ error: null });
      }
    }, { once: true });
    await open;
    return { stream, socket, done };
  }

  #emitEventMessage(stream, data) {
    if (typeof data !== "string") {
      this.emit("stream-error", {
        stream,
        error: streamFailure(stream, `DSH ${stream} WebSocket 包含非文本消息`, "DSH_EVENT_STREAM_INVALID_FRAME"),
      });
      return;
    }
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      this.emit("stream-error", {
        stream,
        error: streamFailure(stream, `DSH ${stream} 事件流包含无效 JSON`, "DSH_EVENT_STREAM_INVALID_FRAME"),
      });
      return;
    }
    if (message?.type !== "server-request" || typeof message.rpcId !== "string"
      || !message.payload || typeof message.payload !== "object") {
      this.emit("stream-error", {
        stream,
        error: streamFailure(stream, `DSH ${stream} 事件流包含无效消息`, "DSH_EVENT_STREAM_INVALID_FRAME"),
      });
      return;
    }
    if (message.payload.type === "stream/error") {
      this.emit("stream-error", {
        stream,
        error: errorFromPayload(message.payload.error, `DSH ${stream} 事件流失败`),
      });
      return;
    }
    this.emit(stream, { rpcId: message.rpcId, payload: message.payload });
  }

  async #authenticateClient(launchUrl) {
    if (!new URL(launchUrl).searchParams.has("token")) return null;
    const response = await this.fetch(launchUrl, { redirect: "manual" });
    if (response.status !== 303) {
      const error = new Error(`DSH Web 客户端认证失败（HTTP ${response.status}）`);
      error.code = "DSH_CLIENT_AUTH_FAILED";
      throw error;
    }
    const cookie = cookieFromResponse(response);
    if (!cookie) {
      const error = new Error("DSH Web 客户端认证没有返回会话 Cookie");
      error.code = "DSH_CLIENT_AUTH_COOKIE_MISSING";
      throw error;
    }
    return cookie;
  }

  #createWebSocket(url) {
    if (!this.clientAuthCookie) return new this.WebSocket(url);
    return new this.WebSocket(url, { headers: { cookie: this.clientAuthCookie } });
  }

  async #runRemoteEventStreamLoop(lifecycle, openedResolve, openedReject) {
    let firstGeneration = true;
    let attempt = 0;
    while (!lifecycle.signal.aborted && this.child?.connected && !this.closing) {
      const generation = new AbortController();
      let generationClientId = null;
      const abortGeneration = () => generation.abort();
      lifecycle.signal.addEventListener("abort", abortGeneration, { once: true });
      try {
        let ready = false;
        for await (const value of this.#openRemoteStreamRaw(
          REMOTE_EVENT_STREAM_ENDPOINT,
          { args: {} },
          generation.signal,
        )) {
          if (!ready) {
            if (value?.type !== "ready") {
              throw streamFailure("remote", "DSH Remote 事件流没有返回 ready", "DSH_EVENT_STREAM_INVALID_FRAME");
            }
            generationClientId = String(value.clientId || "").trim();
            if (!generationClientId) {
              throw streamFailure("remote", "DSH Remote 事件流 ready 缺少 clientId", "DSH_EVENT_STREAM_INVALID_FRAME");
            }
            this.remoteEventClientId = generationClientId;
            this.remoteEventWaits.clear();
            ready = true;
            if (firstGeneration) openedResolve();
            firstGeneration = false;
            attempt = 0;
            continue;
          }
          this.#emitRemoteEvent(value);
        }
        if (!generation.signal.aborted) {
          throw streamFailure("remote", "DSH Remote 事件流意外结束");
        }
      } catch (error) {
        if (lifecycle.signal.aborted || this.closing || !this.child?.connected) return;
        if (firstGeneration) {
          openedReject(error);
          return;
        }
        this.emit("stream-error", { stream: error?.stream || "remote", error });
      } finally {
        lifecycle.signal.removeEventListener("abort", abortGeneration);
        generation.abort();
        if (this.remoteEventClientId === generationClientId) {
          this.remoteEventClientId = null;
          this.remoteEventWaits.clear();
        }
      }
      attempt += 1;
      const delay = Math.min(STREAM_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), STREAM_RETRY_MAX_MS);
      await abortableDelay(delay, lifecycle.signal);
    }
  }

  #emitRemoteEvent(frame) {
    if (!frame || typeof frame !== "object") return;
    if (frame.type === "waterfall") {
      const muxFrame = remoteWaterfallMuxFrame(frame);
      if (!muxFrame || !this.remoteEventClientId) return;
      this.remoteEventWaits.set(muxFrame.rpcId, {
        clientId: this.remoteEventClientId,
        eventId: muxFrame.rpcId,
        event: frame.event,
        sessionId: muxFrame.payload.sessionId,
      });
      this.emit("mux", muxFrame);
      return;
    }
    if (frame.type === "cancel") {
      const eventId = String(frame.eventId || "").trim();
      const wait = this.remoteEventWaits.get(eventId);
      if (!wait) return;
      this.remoteEventWaits.delete(eventId);
      this.emit("mux", remoteWaterfallResolvedFrame(wait));
      return;
    }
    if (frame.type !== "emit" || typeof frame.event !== "string" || !Array.isArray(frame.args)) return;
    this.emit("remote-event", frame);
    if (frame.event === "api-session/status") {
      this.emit("host", {
        rpcId: null,
        payload: {
          type: "host/session-status",
          sessionId: frame.args[0],
          running: frame.args[1] === true,
        },
      });
    }
    if (frame.event === "api-session/error") {
      this.emit("host", {
        rpcId: null,
        payload: {
          type: "host/agent-error",
          sessionId: frame.args[0],
          message: frame.args[1],
        },
      });
    }
  }

  async *#openRemoteStreamRaw(endpoint, payload, signal) {
    if (typeof this.WebSocket !== "function") {
      throw streamFailure("remote", "当前 Node.js 运行时不支持 WebSocket", "DSH_EVENT_STREAM_WEBSOCKET_MISSING");
    }
    const url = new URL(REMOTE_STREAM_MUX_PATH, this.clientSurface);
    url.protocol = "ws:";
    const socket = this.#createWebSocket(url);
    const streamId = randomUUID();
    const queue = new RemoteFrameQueue();
    let opened = false;
    let completed = false;
    const close = () => {
      try { socket.close(1000, "runtime stream stopped"); } catch { /* already closed */ }
    };
    const abort = () => {
      queue.fail(signal.reason || new Error("DSH Remote 事件流已取消"));
      close();
    };
    if (signal.aborted) {
      abort();
      throw signal.reason || new Error("DSH Remote 事件流已取消");
    }
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("open", () => {
      opened = true;
      socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        queue.fail(streamFailure("remote", "DSH Remote 事件流包含非文本消息", "DSH_EVENT_STREAM_INVALID_FRAME"));
        return;
      }
      let frame;
      try { frame = JSON.parse(event.data); } catch {
        queue.fail(streamFailure("remote", "DSH Remote 事件流包含无效 JSON", "DSH_EVENT_STREAM_INVALID_FRAME"));
        return;
      }
      if (frame?.streamId !== streamId) return;
      if (frame.type === "item") queue.push(frame.value);
      else if (frame.type === "end") queue.end();
      else if (frame.type === "error") queue.fail(remoteError(frame, "DSH Remote 事件流失败"));
      else queue.fail(streamFailure("remote", "DSH Remote 事件流包含无效消息", "DSH_EVENT_STREAM_INVALID_FRAME"));
    });
    socket.addEventListener("error", () => {
      queue.fail(streamFailure("remote", "DSH Remote WebSocket 连接失败", "DSH_EVENT_STREAM_WEBSOCKET_ERROR"));
    });
    socket.addEventListener("close", () => {
      if (!opened) queue.fail(streamFailure("remote", "DSH Remote WebSocket 在就绪前关闭", "DSH_EVENT_STREAM_WEBSOCKET_CLOSED"));
      else if (!completed) queue.end();
    }, { once: true });
    try {
      while (true) {
        const frame = await queue.next();
        if (frame.type === "item") {
          yield frame.value;
          continue;
        }
        completed = true;
        if (frame.type === "error") throw frame.error;
        return;
      }
    } finally {
      signal.removeEventListener("abort", abort);
      if (opened && !completed && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "cancel", streamId }));
      }
      close();
    }
  }

  /** Follow one alpha Session journal through the Gateway Remote stream. */
  openRemoteStream(endpoint, args = {}, signal = new AbortController().signal) {
    return this.#openRemoteStreamRaw(endpoint, { args }, signal);
  }

  #onExit(exitedChild, code, signal) {
    if (this.child !== exitedChild) return;
    const reason = signal || (code ?? "unknown");
    const error = new Error(`DSH 运行时已退出（${reason}）`);
    error.code = "DSH_RUNTIME_EXITED";
    this.child = null;
    this.clientSurface = null;
    this.clientLaunchUrl = null;
    this.clientAuthCookie = null;
    this.clientReadyReject?.(error);
    this.clientReadyResolve = null;
    this.clientReadyReject = null;
    this.#stopEventStreams();
    if (this.starting) this.emit("fatal", error);
    this.emit("exit", { code, signal });
    // Auto-restart on unexpected exit (not a deliberate close()). This keeps
    // the resident mux-baseline subscriber's listener fed after a crash, and
    // avoids the cold-start latency on the next request. Deliberate shutdown
    // (close() sets this.closing = true) skips the restart.
    if (!this.closing && !this.restarting) this.#scheduleRestart();
  }

  /**
   * Schedule an automatic restart with exponential backoff (1s → 2s → 4s, cap
   * 8s, reset on successful start). The restart re-opens the mux stream so the
   * DSH baseline replays pending approval/question frames to the resident
   * subscriber. Only one restart timer is active at a time.
   */
  #scheduleRestart() {
    if (this.restartTimer !== null) return;
    const delay = Math.min(1000 * 2 ** this.restartAttempt, 8000);
    this.restartAttempt += 1;
    console.info(`[dsh-runtime] 自动重启中（${delay}ms 后，第 ${this.restartAttempt} 次）`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start().then(() => {
        this.restartAttempt = 0;
        console.info("[dsh-runtime] 自动重启成功");
        return this.reattachSessions();
      }).catch((error) => {
        console.error("[dsh-runtime] 自动重启失败:", error?.message || error);
        this.#scheduleRestart();
      });
    }, delay);
    this.restartTimer.unref?.();
  }

  async reattachSessions() {
    const { listDshSessionBindings } = await import("./session_state.js");
    const results = [];
    for (const binding of listDshSessionBindings()) {
      if (!binding.cwd) {
        results.push({ ...binding, attached: false, error: "missing-cwd" });
        continue;
      }
      try {
        await ensureDshWorkspaceSession(this, { sessionId: binding.dshSessionId, cwd: binding.cwd });
        results.push({ ...binding, attached: true });
      } catch (error) {
        results.push({ ...binding, attached: false, error: error?.code || error?.message || String(error) });
      }
    }
    const failed = results.filter((result) => !result.attached);
    if (failed.length) console.error(`[dsh-runtime] 自动恢复会话失败 ${failed.length}/${results.length}`, failed);
    return results;
  }

  #fail(error) {
    this.#stopEventStreams();
    this.emit("fatal", error);
  }

  async request(method, payload = {}, { rpcId = randomUUID() } = {}) {
    if (this.remoteStreamProtocol) {
      return this.#requestModernCompatibility(method, payload, { rpcId });
    }
    return this.requestClientApi(method, payload, { rpcId });
  }

  async #requestModernCompatibility(method, payload = {}, { rpcId = randomUUID() } = {}) {
    if (method === "host.describe") {
      const catalog = await this.#requestModernCompatibility("llm.models", {}, { rpcId });
      const current = catalog?.current || catalog?.default || {};
      return {
        version: this.runtimeVersion || null,
        provider: current.provider || null,
        model: current.model || null,
      };
    }
    if (method === "llm.models" || method === "session.models") {
      const catalog = await this.requestRemote("session/modelCatalog", {}, { rpcId });
      return {
        ...catalog,
        current: catalog?.current || catalog?.default || null,
      };
    }
    if (method === "llm.providers") {
      const [providers, configurable] = await Promise.all([
        this.requestRemote("llm/listProviders", {}, { rpcId }),
        this.requestRemote("llm/listConfigurableProviders", {}, { rpcId }),
      ]);
      return {
        providers: mergeDshProviderDirectory(providers, configurable),
      };
    }
    if (method === "llm.discoverModels") {
      return this.requestRemote("llm/discoverModels", {
        settingsNs: payload.settingsNs,
        request: {
          ...(payload.provider ? { provider: payload.provider } : {}),
          ...(payload.baseURL ? { baseURL: payload.baseURL } : {}),
          ...(payload.api ? { api: payload.api } : {}),
          ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
        },
      }, { rpcId });
    }
    if (method === "settings.describe") {
      return this.requestRemote("settings/describe", {}, { rpcId });
    }
    if (method === "settings.mutate") {
      return this.requestRemote("settings/mutate", payload, { rpcId });
    }
    if (method === "credentials.describe" || method === "credentials.set" || method === "credentials.unset") {
      return this.requestRemote(method.replace(".", "/"), payload, { rpcId });
    }
    if (method === "skill.list") {
      return this.requestRemote("skills/list", { request: payload }, { rpcId });
    }
    if (method === "command.execute") {
      const execution = await this.requestRemote("commands/execute", {
        agentId: payload.sessionId || payload.agentId,
        line: payload.line,
        images: Array.isArray(payload.images) ? payload.images : [],
      }, { rpcId });
      if (!execution) return { matched: false };
      return {
        ...execution,
        matched: true,
        ...(execution.result ? { command: { text: execution.result.text, kind: execution.result.kind } } : {}),
      };
    }
    if (method === "session.prompt") {
      return this.requestRemote("session/prompt", {
        request: {
          ...payload,
          requestId: payload.requestId || String(rpcId),
        },
      }, { rpcId });
    }
    if (method === "session.list") {
      return this.requestRemote("session/list", { _request: payload }, { rpcId });
    }
    if (method === "session.history") return this.#requestModernHistory(payload, { rpcId });
    if (method === "workspace.list") return this.#requestModernWorkspaceBaseline({ rpcId });

    const [namespace, name] = String(method).split(".");
    if (!namespace || !name) {
      const error = new Error(`DSH alpha 不支持旧接口：${method}`);
      error.code = "DSH_MODERN_ENDPOINT_UNSUPPORTED";
      throw error;
    }
    return this.requestRemote(`${namespace}/${name}`, { request: payload }, { rpcId });
  }

  async #requestModernHistory(payload = {}, { rpcId = randomUUID() } = {}) {
    const sessionId = String(payload.sessionId || "").trim();
    if (!sessionId) {
      const error = new Error("读取 DSH 历史缺少 session id");
      error.code = "DSH_SESSION_ID_MISSING";
      throw error;
    }
    const address = { kind: "session", sessionId };
    const snapshot = await this.#readModernSessionSnapshot(
      address,
      payload.beforeSeq === undefined ? payload.maxMessages : 1,
    );
    if (payload.beforeSeq === undefined) {
      return {
        events: Array.isArray(snapshot.records) ? snapshot.records : [],
        hasMore: snapshot.hasMore === true,
        projections: snapshot.projections,
      };
    }
    const page = await this.requestRemote("session/page", {
      request: {
        address,
        throughSeq: snapshot.cursor,
        beforeSeq: payload.beforeSeq,
        ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
      },
    }, { rpcId });
    return {
      events: Array.isArray(page?.records) ? page.records : [],
      hasMore: page?.hasMore === true,
    };
  }

  async #readModernSessionSnapshot(address, maxMessages) {
    const controller = new AbortController();
    try {
      const args = {
        request: {
          address,
          ...(maxMessages === undefined ? {} : { maxMessages }),
        },
      };
      for await (const value of this.#openRemoteStreamRaw("session/follow", { args }, controller.signal)) {
        if (value?.type !== "snapshot") {
          const error = new Error("DSH session/follow 没有先返回 snapshot");
          error.code = "DSH_SESSION_HISTORY_INVALID_FRAME";
          throw error;
        }
        return value;
      }
    } finally {
      controller.abort();
    }
    const error = new Error("DSH session/follow 没有返回 snapshot");
    error.code = "DSH_SESSION_HISTORY_EMPTY";
    throw error;
  }

  async #requestModernWorkspaceBaseline() {
    const controller = new AbortController();
    try {
      for await (const value of this.#openRemoteStreamRaw("workspace/follow", { args: {} }, controller.signal)) {
        if (value?.type !== "baseline") {
          const error = new Error("DSH workspace/follow 没有先返回 baseline");
          error.code = "DSH_WORKSPACE_INVALID_FRAME";
          throw error;
        }
        return value.value;
      }
    } finally {
      controller.abort();
    }
    const error = new Error("DSH workspace/follow 没有返回 baseline");
    error.code = "DSH_WORKSPACE_BASELINE_EMPTY";
    throw error;
  }

  /** Call one unary method on the trusted loopback DSH Web ApiProxy. */
  async requestClientApi(method, payload = {}, { rpcId = randomUUID() } = {}) {
    await this.waitForClientSurface();
    return this.#requestClientApiOnSurface(method, payload, { rpcId });
  }

  async #requestClientApiOnSurface(method, payload = {}, { rpcId = randomUUID() } = {}) {
    const surface = this.clientSurface;
    if (!surface) throw streamFailure("api", "DSH Web 客户端地址尚未就绪", "DSH_CLIENT_SURFACE_MISSING");
    const response = await this.fetch(new URL(`api/${method}`, surface), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.clientAuthCookie ? { cookie: this.clientAuthCookie } : {}),
      },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
    });
    if (!response.ok) {
      const error = new Error(`DSH Web ApiProxy 请求失败（HTTP ${response.status}）`);
      error.code = "DSH_WEB_API_HTTP_ERROR";
      throw error;
    }
    const message = await response.json();
    if (message?.rpcId !== rpcId || !message?.result || typeof message.result.ok !== "boolean") {
      const error = new Error("DSH Web ApiProxy 返回了无效响应");
      error.code = "DSH_WEB_API_INVALID_RESPONSE";
      throw error;
    }
    if (!message.result.ok) {
      const error = new Error(message.result.error?.message || "DSH Web ApiProxy 请求失败");
      error.code = message.result.error?.code || "DSH_WEB_API_FAILED";
      error.details = message.result.error?.details || {};
      throw error;
    }
    return message.result.value;
  }

  /** Call one Typert Remote method on the trusted loopback DSH Web gateway. */
  async requestRemote(endpoint, args = {}, { rpcId = randomUUID() } = {}) {
    const surface = await this.waitForClientSurface();
    const response = await this.fetch(new URL(`api/${endpoint}`, surface), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.clientAuthCookie ? { cookie: this.clientAuthCookie } : {}),
      },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method: endpoint,
        payload: { args },
      }),
    });
    if (!response.ok) {
      const error = new Error(`DSH Web Remote 请求失败（HTTP ${response.status}）`);
      error.code = "DSH_WEB_REMOTE_HTTP_ERROR";
      throw error;
    }
    const message = await response.json();
    if (message?.rpcId !== rpcId || !message?.result || typeof message.result.ok !== "boolean") {
      const error = new Error("DSH Web Remote 返回了无效响应");
      error.code = "DSH_WEB_REMOTE_INVALID_RESPONSE";
      throw error;
    }
    if (!message.result.ok) {
      const error = new Error(message.result.error?.message || "DSH Web Remote 请求失败");
      error.code = message.result.error?.code || "DSH_WEB_REMOTE_FAILED";
      error.details = message.result.error?.details || {};
      throw error;
    }
    return message.result.value;
  }

  async respond(rpcId, payload) {
    if (this.remoteStreamProtocol) {
      const eventId = String(rpcId || "").trim();
      const wait = this.remoteEventWaits.get(eventId);
      if (!wait) {
        const error = new Error("DSH Remote 交互已经失效");
        error.code = "DSH_REMOTE_EVENT_NOT_PENDING";
        throw error;
      }
      const value = remoteWaterfallResult(wait, payload);
      if (value === undefined) {
        const error = new Error("DSH Remote 交互响应缺少结果");
        error.code = "DSH_REMOTE_EVENT_RESULT_MISSING";
        throw error;
      }
      await this.requestRemote(REMOTE_EVENT_RESULT_ENDPOINT, {
        clientId: wait.clientId,
        eventId: wait.eventId,
        outcome: { kind: "result", value },
      }, { rpcId: eventId });
      return { accepted: true };
    }
    const surface = await this.waitForClientSurface();
    const response = await this.fetch(new URL("api/respond", surface), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.clientAuthCookie ? { cookie: this.clientAuthCookie } : {}),
      },
      body: JSON.stringify({ type: "client-response", rpcId, result: { ok: true, value: payload } }),
    });
    if (!response.ok) {
      const error = new Error(`DSH Web 响应提交失败（HTTP ${response.status}）`);
      error.code = "DSH_WEB_RESPOND_HTTP_ERROR";
      throw error;
    }
    const receipt = await response.json();
    if (receipt?.accepted !== true && !(receipt?.accepted === false && typeof receipt.reason === "string")) {
      const error = new Error("DSH Web 响应提交返回了无效回执");
      error.code = "DSH_WEB_RESPOND_INVALID_RECEIPT";
      throw error;
    }
    return receipt;
  }

  /** Wait for the official loopback DSH Web client mounted in this child. */
  async waitForClientSurface() {
    await this.start();
    if (this.clientSurface) return this.clientSurface;
    if (this.clientSurfaceError) throw this.clientSurfaceError;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.off("client-surface", ready);
        this.off("client-surface-error", failed);
        this.off("exit", exited);
      };
      const ready = (surface) => { cleanup(); resolve(surface); };
      const failed = (error) => { cleanup(); reject(error); };
      const exited = () => {
        const error = new Error("DSH 运行时在客户端界面就绪前退出");
        error.code = "DSH_CLIENT_SURFACE_EXITED";
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        const error = new Error("DSH 客户端界面启动超时");
        error.code = "DSH_CLIENT_SURFACE_TIMEOUT";
        cleanup();
        reject(error);
      }, CLIENT_SURFACE_TIMEOUT_MS);
      timer.unref?.();
      this.once("client-surface", ready);
      this.once("client-surface-error", failed);
      this.once("exit", exited);
    });
  }

  /** Return the authenticated browser launch URL without exposing it to the renderer. */
  async waitForClientLaunchUrl() {
    await this.waitForClientSurface();
    return this.clientLaunchUrl || this.clientSurface;
  }

  async close() {
    this.closing = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.#stopEventStreams();
    const child = this.child;
    if (child?.connected) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      const timeout = new AbortController();
      child.send({ type: "shutdown" }, () => {});
      try {
        await Promise.race([exited, abortableDelay(CLOSE_TIMEOUT_MS, timeout.signal)]);
      } finally {
        timeout.abort();
      }
      if (child.connected) child.disconnect();
      if (this.child === child) child.kill();
    }
    await this.productHostDispatcher.dispose?.();
  }

  /** Restart the Profile tree after its ordered Bundle list changes. */
  async restart() {
    if (this.closing) {
      const error = new Error("DSH 运行时正在关闭，不能重启 Profile");
      error.code = "DSH_RUNTIME_CLOSING";
      throw error;
    }
    this.restarting = true;
    try {
      this.#stopEventStreams();
      const child = this.child;
      if (child) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        const timeout = new AbortController();
        try {
          await Promise.race([exited, abortableDelay(CLOSE_TIMEOUT_MS, timeout.signal)]);
        } finally {
          timeout.abort();
        }
        if (this.child === child) child.kill("SIGKILL");
      }
      this.child = null;
      this.clientSurface = null;
      this.clientLaunchUrl = null;
      this.clientAuthCookie = null;
      await this.start();
      this.restartAttempt = 0;
      return this.reattachSessions();
    } finally {
      this.restarting = false;
    }
  }
}

class RemoteFrameQueue {
  constructor() {
    this.frames = [];
    this.waiter = null;
    this.failure = null;
    this.ended = false;
  }

  push(value) {
    if (this.failure || this.ended) return;
    this.frames.push({ type: "item", value });
    this.waiter?.();
    this.waiter = null;
  }

  fail(error) {
    if (this.failure || this.ended) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.frames = [];
    this.waiter?.();
    this.waiter = null;
  }

  end() {
    if (this.failure || this.ended) return;
    this.ended = true;
    this.waiter?.();
    this.waiter = null;
  }

  async next() {
    while (!this.frames.length) {
      if (this.failure) return { type: "error", error: this.failure };
      if (this.ended) return { type: "end" };
      await new Promise((resolve) => { this.waiter = resolve; });
    }
    return this.frames.shift();
  }
}

let sharedClient = null;

export function getDshRuntimeClient() {
  sharedClient ||= new DshRuntimeClient();
  return sharedClient;
}

export function dshRuntimeStatus() {
  if (!dshRuntimeEnabled()) return { available: false, running: false, initialized: false };
  try {
    const resolved = resolveDshRuntimeDistribution();
    return {
      available: true,
      running: Boolean(sharedClient?.child?.connected),
      initialized: Boolean(sharedClient?.child?.connected),
      distribution: resolved.distribution,
      process_count: sharedClient?.child?.connected ? 1 : 0,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      running: false,
      initialized: false,
      process_count: 0,
      error: { code: error?.code || "DSH_RUNTIME_UNAVAILABLE", message: error?.message || String(error) },
    };
  }
}

export async function probeDshRuntime() {
  const client = getDshRuntimeClient();
  await client.start();
  const [host, catalog] = await Promise.all([
    client.request("host.describe", {}),
    client.request("llm.models", {}),
  ]);
  return {
    running: true,
    version: host.version,
    provider: host.provider || null,
    model: host.model || null,
    models: (catalog.groups || []).flatMap((group) => (
      (group.models || []).map((model) => ({ ...model, provider: group.id, provider_name: group.name }))
    )),
    failures: catalog.failures || [],
  };
}

export async function closeDshRuntimeClient() {
  const client = sharedClient;
  sharedClient = null;
  await client?.close();
}

export async function restartDshRuntimeClient() {
  if (!sharedClient?.child?.connected) return { restarted: false, sessions: [] };
  const sessions = await sharedClient.restart();
  return { restarted: true, sessions };
}
