/** Desktop Host providers for session-addressed product and native services. */

import { randomUUID } from "node:crypto";

export const name = "dsh-work-product-host-ipc";
export const inject = ["webServer", "agents"];

const PRODUCT_REQUEST_TIMEOUT_MS = 30_000;

/** A closed product-capability failure returned by the desktop parent. */
export class DshWorkProductHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DshWorkProductHostError";
    this.code = code;
  }
}

function isProductResponse(message) {
  if (!message || typeof message !== "object" || message.type !== "product-response"
    || typeof message.id !== "string" || !message.result || typeof message.result.ok !== "boolean") return false;
  if (message.result.ok) return Object.hasOwn(message.result, "value");
  return typeof message.result.error?.code === "string"
    && typeof message.result.error?.message === "string";
}

/** Send one IPC message without turning parent shutdown into an unhandled process error. */
export function sendRuntimeParentMessage(channel, message, onError = () => {}) {
  if (channel?.connected !== true || typeof channel.send !== "function") {
    onError(Object.assign(new Error("Parent IPC channel is closed"), { code: "ERR_IPC_CHANNEL_CLOSED" }));
    return false;
  }
  try {
    channel.send(message, (error) => {
      if (error) onError(error);
    });
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

/** Create the correlated request transport over one Node process channel. */
export function createProductHostTransport(ctx, channel = process) {
  const pending = new Map();

  const sendCancel = (request) => {
    sendRuntimeParentMessage(channel, {
      type: "product-cancel",
      id: request.id,
      sessionId: request.sessionId,
    });
  };

  const settle = (request, error, value) => {
    clearTimeout(request.timer);
    request.signal?.removeEventListener("abort", request.onAbort);
    pending.delete(request.id);
    if (error) request.reject(error);
    else request.resolve(value);
  };

  const onMessage = (message) => {
    if (!isProductResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    if (message.result.ok) settle(request, null, message.result.value);
    else settle(request, new DshWorkProductHostError(message.result.error.code, message.result.error.message));
  };

  ctx.effect(() => {
    channel.on("message", onMessage);
    return () => {
      channel.off("message", onMessage);
      for (const request of pending.values()) {
        sendCancel(request);
        settle(request, new DshWorkProductHostError(
          "product-unavailable",
          "DSH Desktop product Host disposed",
        ));
      }
    };
  }, "dsh-work product Host IPC");

  return Object.freeze({
    request(sessionId, method, payload, signal) {
      if (channel?.connected !== true || typeof channel.send !== "function") {
        return Promise.reject(new DshWorkProductHostError(
          "product-unavailable",
          "DSH Desktop parent process is unavailable",
        ));
      }
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const request = {
          id,
          sessionId,
          resolve,
          reject,
          signal,
          onAbort: null,
          timer: null,
        };
        request.onAbort = () => {
          sendCancel(request);
          settle(request, new DshWorkProductHostError("product-rejected", `product request ${method} aborted`));
        };
        if (signal?.aborted) {
          request.onAbort();
          return;
        }
        signal?.addEventListener("abort", request.onAbort, { once: true });
        request.timer = setTimeout(() => {
          sendCancel(request);
          settle(request, new DshWorkProductHostError("product-timeout", `product request ${method} timed out`));
        }, PRODUCT_REQUEST_TIMEOUT_MS);
        request.timer.unref?.();
        pending.set(id, request);
        sendRuntimeParentMessage(
          channel,
          { type: "product-request", id, sessionId, method, payload },
          (error) => {
            if (!pending.has(id)) return;
            settle(request, new DshWorkProductHostError(
              "product-unavailable",
              `product request ${method} failed: ${error?.message || String(error)}`,
            ));
          },
        );
      });
    },
  });
}

function call(transport, method, request, context) {
  const sessionId = String(context?.sessionId || "").trim();
  if (!sessionId) {
    return Promise.reject(new DshWorkProductHostError(
      "product-rejected",
      `${method} requires the initiating DSH Session id`,
    ));
  }
  return transport.request(sessionId, method, request || {}, context?.signal);
}

/** Build transport-independent services consumed by product feature Bundles. */
export function createProductHostServices(transport) {
  const productHost = Object.freeze({
    projectList: (request, context) => call(transport, "projectList", request, context),
    conversationList: (request, context) => call(transport, "conversationList", request, context),
    conversationContext: (request, context) => call(transport, "conversationContext", request, context),
    capabilitySnapshot: (context) => call(transport, "capabilitySnapshot", {}, context),
    skillList: (context) => call(transport, "skillList", {}, context),
    skillGet: (request, context) => call(transport, "skillGet", request, context),
    mcpToolList: (context) => call(transport, "mcpToolList", {}, context),
    mcpToolCall: (request, context) => call(transport, "mcpToolCall", request, context),
    canvasInspect: (request, context) => call(transport, "canvasInspect", request, context),
    canvasCreate: (request, context) => call(transport, "canvasCreate", request, context),
    canvasEdit: (request, context) => call(transport, "canvasEdit", request, context),
    canvasSuggest: (request, context) => call(transport, "canvasSuggest", request, context),
    uiRender: (request, context) => call(transport, "uiRender", request, context),
  });
  const officeArtifactHost = Object.freeze({
    inspect: (request, context) => call(transport, "artifactOfficeInspect", request, context),
    create: (request, context) => call(transport, "artifactOfficeCreate", request, context),
    edit: (request, context) => call(transport, "artifactOfficeEdit", request, context),
  });
  const browserWorkspaceHost = Object.freeze({
    getState: (context) => call(transport, "browserWorkspaceGetState", {}, context),
    setVisible: (request, context) => call(transport, "browserWorkspaceSetVisible", request, context),
    setBounds: (request, context) => call(transport, "browserWorkspaceSetBounds", request, context),
    createTab: (request, context) => call(transport, "browserWorkspaceCreateTab", request, context),
    activateTab: (request, context) => call(transport, "browserWorkspaceActivateTab", request, context),
    closeTab: (request, context) => call(transport, "browserWorkspaceCloseTab", request, context),
    navigate: (request, context) => call(transport, "browserWorkspaceNavigate", request, context),
    goBack: (request, context) => call(transport, "browserWorkspaceGoBack", request, context),
    goForward: (request, context) => call(transport, "browserWorkspaceGoForward", request, context),
    reload: (request, context) => call(transport, "browserWorkspaceReload", request, context),
    stop: (request, context) => call(transport, "browserWorkspaceStop", request, context),
    findInPage: (request, context) => call(transport, "browserWorkspaceFindInPage", request, context),
    stopFindInPage: (request, context) => call(transport, "browserWorkspaceStopFindInPage", request, context),
    capturePage: (request, context) => call(transport, "browserWorkspaceCapturePage", request, context),
    captureScreenshot: (request, context) => call(transport, "browserWorkspaceCaptureScreenshot", request, context),
    listPermissions: (context) => call(transport, "browserWorkspaceListPermissions", {}, context),
    removePermission: (request, context) => call(transport, "browserWorkspaceRemovePermission", request, context),
    resolvePermissionRequest: (request, context) => call(transport, "browserWorkspaceResolvePermissionRequest", request, context),
  });
  const fileDialogHost = Object.freeze({
    openFiles: (request, context) => call(transport, "fileDialogOpenFiles", request, context),
    openDirectory: (request, context) => call(transport, "fileDialogOpenDirectory", request, context),
  });
  const windowHost = Object.freeze({
    getState: (context) => call(transport, "windowGetState", {}, context),
    focus: (context) => call(transport, "windowFocus", {}, context),
    minimize: (context) => call(transport, "windowMinimize", {}, context),
    maximize: (context) => call(transport, "windowMaximize", {}, context),
    restore: (context) => call(transport, "windowRestore", {}, context),
  });
  return Object.freeze({ productHost, officeArtifactHost, browserWorkspaceHost, fileDialogHost, windowHost });
}

/** Register the desktop Host services and publish runtime readiness. */
export function apply(ctx) {
  const transport = createProductHostTransport(ctx);
  const { productHost, officeArtifactHost, browserWorkspaceHost, fileDialogHost, windowHost } = createProductHostServices(transport);
  ctx.provide("productHost", productHost);
  ctx.provide("officeArtifactHost", officeArtifactHost);
  ctx.provide("browserWorkspaceHost", browserWorkspaceHost);
  ctx.provide("fileDialogHost", fileDialogHost);
  ctx.provide("windowHost", windowHost);

  const announcedAgents = new Map();
  const announceNativeSession = (agent) => {
    const sessionId = String(agent?.session?.id || "").trim();
    if (!sessionId) throw new Error("dsh-work product Host cannot authorize an Agent without a DSH Session id");
    if (announcedAgents.has(agent)) return;
    announcedAgents.set(agent, sessionId);
    sendRuntimeParentMessage(process, {
      type: "product-native-session-ready",
      sessionId,
    });
  };
  const releaseNativeSession = (agent) => {
    const sessionId = announcedAgents.get(agent);
    if (!sessionId) return;
    announcedAgents.delete(agent);
    sendRuntimeParentMessage(process, {
      type: "product-native-session-released",
      sessionId,
    });
  };
  ctx.on("agent/created", ({ agent }) => announceNativeSession(agent));
  ctx.on("agent/disposed", ({ agent }) => releaseNativeSession(agent));
  ctx.effect(() => () => {
    for (const agent of announcedAgents.keys()) releaseNativeSession(agent);
    announcedAgents.clear();
  }, "dsh-work native Host Session announcements");

  let stopping = false;
  const stopRuntime = () => {
    if (stopping) return;
    stopping = true;
    void ctx.root.fiber.dispose().finally(() => process.exit(0));
  };
  const onLifecycleMessage = (message) => {
    if (message?.type === "shutdown") stopRuntime();
  };
  ctx.effect(() => {
    process.on("message", onLifecycleMessage);
    process.on("disconnect", stopRuntime);
    return () => {
      process.off("message", onLifecycleMessage);
      process.off("disconnect", stopRuntime);
    };
  }, "dsh-work runtime lifecycle");

  if (!ctx.webServer?.port) throw new Error("dsh-work product Host requires a listening Web server");
  const publishReady = () => {
    if (!ctx.get("webServer")?.port) return;
    sendRuntimeParentMessage(process, {
      type: "client-ready",
      url: `http://127.0.0.1:${ctx.webServer.port}/`,
    });
    sendRuntimeParentMessage(process, {
      type: "ready",
      distribution: process.env.DSH_RUNTIME_DISTRIBUTION || "npm",
      version: process.env.DSH_RUNTIME_VERSION || null,
    });
  };
  const settled = ctx.get("loader")?.await();
  if (!settled) publishReady();
  else void settled.then(publishReady, () => {});
}
