// Tests for the dsh-app product_host_dispatcher: method whitelist, userId
// injection (never from the child payload), result-size cap, and the
// session-binding lifecycle (persistent per-Session bind, addressed removal),
// concurrent routing, and status-only capability snapshots.
//
// These tests inject a mock listProjects through overrideServices so no real
// database is touched.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionProductHostDispatcher,
  createProductHostDispatcher,
  nullProductHostDispatcher,
  overrideServices,
} from "../../server/src/engine/dsh_runtime/product_host_dispatcher.js";
import {
  apply as applyProductBridge,
  createDshWorkInstructionMessage,
  inject as productBridgeInject,
} from "../../packages/dsh-product-bridge/src/index.js";
import {
  apply as applyModelInheritance,
  inject as modelInheritanceInject,
  modelTarget,
} from "../../packages/dsh-model-inheritance/src/index.js";
import {
  apply as applyCanvasTools,
  createCanvasProductTools,
} from "../../packages/dsh-canvas-tools/src/index.js";
import {
  apply as applyOfficeTools,
  createOfficeProductTools,
} from "../../packages/dsh-office-tools/src/index.js";
import {
  apply as applyProjectTools,
  createProjectProductTools,
} from "../../packages/dsh-project-tools/src/index.js";
import {
  apply as applyStructuredUiTools,
  createStructuredUiProductTools,
} from "../../packages/dsh-structured-ui-tools/src/index.js";
import {
  createProductHostServices,
  sendRuntimeParentMessage,
} from "../../packages/dsh-work-product-host-ipc/src/index.js";

const emptyDb = { query() {}, queryOne() {}, transaction() {} };

test("product bridge IPC treats parent shutdown as a normal lifecycle edge", () => {
  const messages = [];
  const errors = [];
  const connected = {
    connected: true,
    send(message, callback) {
      messages.push(message);
      callback(Object.assign(new Error("Channel closed"), { code: "ERR_IPC_CHANNEL_CLOSED" }));
    },
  };
  assert.equal(sendRuntimeParentMessage(
    connected,
    { type: "client-ready" },
    (error) => errors.push(error.code),
  ), true);
  assert.deepEqual(messages, [{ type: "client-ready" }]);
  assert.deepEqual(errors, ["ERR_IPC_CHANNEL_CLOSED"]);
  assert.equal(sendRuntimeParentMessage({ connected: false }, { type: "ready" }), false);
});

test("the IPC adapter exposes narrow product, file-dialog, window, and Office Host services", async () => {
  const calls = [];
  const services = createProductHostServices({
    async request(sessionId, method, payload, signal) {
      calls.push({ sessionId, method, payload, signal });
      return { method };
    },
  });
  const signal = new AbortController().signal;
  await services.productHost.projectList({ search: "alpha" }, { sessionId: "dsh-product", signal });
  await services.productHost.conversationContext({}, { sessionId: "dsh-product", signal });
  await services.productHost.capabilitySnapshot({ sessionId: "dsh-product", signal });
  await services.officeArtifactHost.edit(
    { artifact_id: "artifact-1" },
    { sessionId: "dsh-office", signal },
  );
  await services.fileDialogHost.openFiles(
    { multiple: true, filters: [{ name: "Text", extensions: ["txt"] }] },
    { sessionId: "dsh-file", signal },
  );
  await services.fileDialogHost.openDirectory(
    {},
    { sessionId: "dsh-file", signal },
  );
  await services.windowHost.maximize({ sessionId: "dsh-window", signal });
  await services.windowHost.restore({ sessionId: "dsh-window", signal });
  assert.deepEqual(calls, [{
    sessionId: "dsh-product",
    method: "projectList",
    payload: { search: "alpha" },
    signal,
  }, {
    sessionId: "dsh-product",
    method: "conversationContext",
    payload: {},
    signal,
  }, {
    sessionId: "dsh-product",
    method: "capabilitySnapshot",
    payload: {},
    signal,
  }, {
    sessionId: "dsh-office",
    method: "artifactOfficeEdit",
    payload: { artifact_id: "artifact-1" },
    signal,
  }, {
    sessionId: "dsh-file",
    method: "fileDialogOpenFiles",
    payload: { multiple: true, filters: [{ name: "Text", extensions: ["txt"] }] },
    signal,
  }, {
    sessionId: "dsh-file",
    method: "fileDialogOpenDirectory",
    payload: {},
    signal,
  }, {
    sessionId: "dsh-window",
    method: "windowMaximize",
    payload: {},
    signal,
  }, {
    sessionId: "dsh-window",
    method: "windowRestore",
    payload: {},
    signal,
  }]);
  await assert.rejects(
    services.productHost.projectList({}, { sessionId: "" }),
    { name: "DshWorkProductHostError", code: "product-rejected" },
  );
  assert.equal(Object.hasOwn(services.productHost, "request"), false);
});

test("feature Bundles fail loudly when their required Host service is absent", () => {
  const missing = { get: () => null };
  assert.throws(() => applyProductBridge(missing), /requires the productHost conversationContext method/);
  assert.throws(() => applyProjectTools(missing), /requires the productHost project methods/);
  assert.throws(() => applyCanvasTools(missing), /requires the productHost Canvas methods/);
  assert.throws(() => applyStructuredUiTools(missing), /requires the productHost uiRender method/);
  assert.throws(() => applyOfficeTools(missing), /requires the officeArtifactHost service/);
});

function bindSession(dispatcher, overrides = {}) {
  return dispatcher.bind({
    db: emptyDb,
    dshSessionId: "dsh-s1",
    appSessionId: "app-s1",
    userId: "u1",
    projectId: "p1",
    ...overrides,
  });
}

test("session dispatcher rejects an unknown DSH session", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  const reply = await dispatcher.handle({ id: "r1", sessionId: "missing", method: "projectList", payload: {} });
  assert.equal(reply.type, "product-response");
  assert.equal(reply.id, "r1");
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-unavailable");
});

test("session dispatcher rejects an unknown method even when bound", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  const reply = await dispatcher.handle({ id: "r2", sessionId: "dsh-s1", method: "evilMethod", payload: {} });
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-rejected");
});

test("removed project Plugin capabilities return an empty Profile-era snapshot", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  const snapshot = await dispatcher.handle({
    id: "profile-snapshot",
    sessionId: "dsh-s1",
    method: "capabilitySnapshot",
    payload: {},
  });
  const skills = await dispatcher.handle({
    id: "profile-skills",
    sessionId: "dsh-s1",
    method: "skillList",
    payload: {},
  });
  assert.deepEqual(snapshot.result.value.plugins, []);
  assert.equal(snapshot.result.value.bridge.skills, "not-bridged");
  assert.deepEqual(skills.result.value.items, []);
  await dispatcher.dispose();
});

test("session dispatcher forwards projectList with the bound userId (never from payload)", async () => {
  let capturedCtx = null;
  let capturedInput = null;
  const previous = overrideServices({
    listProjects: async (ctx, input) => {
      capturedCtx = ctx;
      capturedInput = input;
      return { data: { items: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }], total: 2 }, message: "ok" };
    },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, { userId: "user-42" });
  // The child's payload must NOT carry a userId; the dispatcher derives it.
  const reply = await dispatcher.handle({ id: "r3", sessionId: "dsh-s1", method: "projectList", payload: { search: "alp" } });
  overrideServices(previous);

  assert.equal(capturedCtx.userId, "user-42", "userId comes from the binding, not the payload");
  assert.equal(capturedInput.query.search, "alp");
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.value.total, 2);
  assert.equal(reply.result.value.items[0].id, "1");
  assert.equal(reply.result.value.items[0].name, "Alpha");
  assert.equal(reply.result.value.truncated, false);
});

test("session dispatcher caps the result at 200 items and marks it truncated", async () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ id: i, name: `P${i}` }));
  const previous = overrideServices({
    listProjects: async () => ({ data: { items: many, total: 250 }, message: "ok" }),
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  const reply = await dispatcher.handle({ id: "r4", sessionId: "dsh-s1", method: "projectList", payload: {} });
  overrideServices(previous);

  assert.equal(reply.result.value.items.length, 200);
  assert.equal(reply.result.value.truncated, true);
  assert.equal(reply.result.value.total, 250);
});

test("session dispatcher maps a handler throw to product-unavailable", async () => {
  const previous = overrideServices({
    listProjects: async () => { throw new Error("db down"); },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  const reply = await dispatcher.handle({ id: "r5", sessionId: "dsh-s1", method: "projectList", payload: {} });
  overrideServices(previous);

  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-unavailable");
  assert.match(reply.result.error.message, /db down/);
});

test("clear() removes only the addressed DSH session binding", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  bindSession(dispatcher, { dshSessionId: "dsh-s2", appSessionId: "app-s2" });
  dispatcher.clear("dsh-s1");
  const reply = await dispatcher.handle({ id: "r6", sessionId: "dsh-s1", method: "projectList", payload: {} });
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-unavailable");
  const retained = await dispatcher.handle({ id: "r6b", sessionId: "dsh-s2", method: "evilMethod", payload: {} });
  assert.equal(retained.result.error.code, "product-rejected");
});

test("createProductHostDispatcher (static binding) forwards projectList", async () => {
  const previous = overrideServices({
    listProjects: async () => ({ data: { items: [{ id: 7, name: "Gamma" }], total: 1 }, message: "ok" }),
  });
  const dispatcher = createProductHostDispatcher({ db: emptyDb, resolveUserId: () => "static-user" });
  const reply = await dispatcher.handle({ id: "r7", sessionId: "dsh-static", method: "projectList", payload: {} });
  overrideServices(previous);

  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.value.items[0].id, "7");
});

test("nullProductHostDispatcher rejects every call", async () => {
  const reply = await nullProductHostDispatcher.handle({ id: "r8", sessionId: "dsh-s1", method: "projectList", payload: {} });
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-unavailable");
});

test("session dispatcher forwards conversationList with projectId from binding", async () => {
  let capturedPid = null;
  const previous = overrideServices({
    listAgentSessions: async (ctx, input) => {
      capturedPid = input.params.pid;
      return { data: { sessions: [{ id: "c1", title: "Chat 1" }, { id: "c2", title: "Archived", status: "archived" }] } };
    },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, { projectId: "proj-42" });
  const reply = await dispatcher.handle({ id: "r9", sessionId: "dsh-s1", method: "conversationList", payload: { archived: true } });
  overrideServices(previous);

  assert.equal(capturedPid, "proj-42", "projectId from binding");
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.value.items.length, 2);
  assert.equal(reply.result.value.items[0].id, "c1");
  assert.equal(reply.result.value.items[1].archived, true);
});

test("conversationContext returns parent-selected instructions without accepting identity from the child", async () => {
  const queries = [];
  const db = {
    query() {},
    queryOne: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("FROM sessions")) return { action_type: "agentic_chat", session_config: "{}" };
      if (sql.includes("FROM app_user_settings")) return { instructions: "先给结论。" };
      if (sql.includes("FROM projects")) return { instructions: "修改前说明影响。" };
      return null;
    },
    transaction() {},
  };
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, {
    db,
    projectId: "project-context",
    appSessionId: "app-context",
    userId: "context-user",
  });
  try {
    const reply = await dispatcher.handle({
      id: "context-request",
      sessionId: "dsh-s1",
      method: "conversationContext",
      payload: { userId: "forged-user", projectId: "forged-project" },
    });
    assert.equal(reply.result.ok, true);
    assert.match(reply.result.value.instructions.text, /先给结论/);
    assert.match(reply.result.value.instructions.text, /修改前说明影响/);
    assert.deepEqual(reply.result.value.instructions.scopes, {
      application: true,
      project: true,
      temporary: false,
    });
    assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM sessions"))?.params, [
      "app-context", "project-context", "context-user",
    ]);
    assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM projects"))?.params, ["project-context"]);
    assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM app_user_settings"))?.params, ["context-user"]);
  } finally {
    await dispatcher.dispose();
  }
});

test("the product bridge logs parent-owned instructions with explicit scope provenance", () => {
  const message = createDshWorkInstructionMessage({
    instructions: {
      text: "## Application instructions\n\n先给结论。",
      scopes: { application: true, project: false, temporary: true },
    },
  });
  assert.equal(message.role, "user");
  assert.deepEqual(message.source, {
    kind: "plugin",
    plugin: "dsh-work-context",
    form: "instructions",
    dshWorkInstructions: { application: true, project: false, temporary: true },
  });
  assert.match(message.content[0].text, /Application instructions/);
  assert.equal(Object.isFrozen(message), true);
  assert.equal(createDshWorkInstructionMessage({ instructions: { text: "", scopes: {} } }), null);
});

test("session dispatcher rejects conversationList without projectId binding", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, { projectId: null });
  const reply = await dispatcher.handle({ id: "r10", sessionId: "dsh-s1", method: "conversationList", payload: {} });
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-unavailable");
});

test("office inspect stays inside the bound project and removes UI preview SVG from the model result", async () => {
  let captured = null;
  const previous = overrideServices({
    inspectProjectOfficeArtifact: async (ctx, input) => {
      captured = { ctx, input };
      return {
        artifact: { id: input.artifactId },
        version: { id: "v2" },
        document: {
          format: "pptx",
          sections: [{ anchor: "slide:1", text: "Title", preview_svg: "<svg>large preview</svg>" }],
        },
      };
    },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, { userId: "office-user", projectId: "office-project" });
  try {
    const reply = await dispatcher.handle({
      id: "office-inspect",
      sessionId: "dsh-s1",
      method: "artifactOfficeInspect",
      payload: { artifact_id: "artifact-1" },
    });
    assert.equal(reply.result.ok, true);
    assert.equal(captured.ctx.userId, "office-user");
    assert.equal(captured.input.projectId, "office-project");
    assert.equal(reply.result.value.document.sections[0].anchor, "slide:1");
    assert.equal(Object.hasOwn(reply.result.value.document.sections[0], "preview_svg"), false);

    const rejected = await dispatcher.handle({
      id: "office-wrong-project",
      sessionId: "dsh-s1",
      method: "artifactOfficeInspect",
      payload: { project_id: "other-project", artifact_id: "artifact-1" },
    });
    assert.equal(rejected.result.ok, false);
    assert.equal(rejected.result.error.code, "product-rejected");
  } finally {
    overrideServices(previous);
    await dispatcher.dispose();
  }
});

test("office create and edit use the parent-bound user, project, and App Session", async () => {
  const calls = [];
  const previous = overrideServices({
    createProjectOfficeArtifact: async (ctx, input) => {
      calls.push({ kind: "create", ctx, input });
      return { artifact: { id: "created", current_version: { id: "v1" } } };
    },
    editProjectOfficeArtifact: async (ctx, input) => {
      calls.push({ kind: "edit", ctx, input });
      return { artifact: { id: input.artifactId, current_version: { id: "v2" } } };
    },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, {
    userId: "office-user",
    projectId: "office-project",
    appSessionId: "app-office-session",
  });
  try {
    const created = await dispatcher.handle({
      id: "office-create",
      sessionId: "dsh-s1",
      method: "artifactOfficeCreate",
      payload: { format: "pptx", title: "Launch" },
    });
    const edited = await dispatcher.handle({
      id: "office-edit",
      sessionId: "dsh-s1",
      method: "artifactOfficeEdit",
      payload: {
        artifact_id: "created",
        base_version_id: "v1",
        operations: [{ type: "replace_text", anchor: "slide:1:title", text: "Ready" }],
      },
    });
    assert.equal(created.result.ok, true);
    assert.equal(edited.result.ok, true);
    assert.deepEqual(calls.map((call) => call.kind), ["create", "edit"]);
    assert.ok(calls.every((call) => call.ctx.userId === "office-user"));
    assert.ok(calls.every((call) => call.input.projectId === "office-project"));
    assert.ok(calls.every((call) => call.input.source.sessionId === "app-office-session"));
  } finally {
    overrideServices(previous);
    await dispatcher.dispose();
  }
});

test("the Office Bundle registers scoped tools with native tool results", async () => {
  const calls = [];
  const officeArtifactHost = {
    async inspect(payload, context) {
      calls.push({ operation: "inspect", payload, context });
      return { success: true, artifact: { id: "artifact-1" } };
    },
  };
  const agent = { session: { id: "dsh-office-session" } };
  const tools = createOfficeProductTools(officeArtifactHost, agent);
  assert.deepEqual(
    new Set(tools.keys()),
    new Set(["artifact_office_inspect", "artifact_office_create", "artifact_office_edit"]),
  );
  assert.deepEqual(tools.get("artifact_office_edit").definition.parameters.required, [
    "artifact_id",
    "base_version_id",
    "operations",
  ]);
  const signal = new AbortController().signal;
  const value = await tools.get("artifact_office_inspect").definition.execute(
    { artifact_id: "artifact-1" },
    { agent, signal },
  );
  assert.equal(value.success, true);
  assert.deepEqual(calls[0], {
    operation: "inspect",
    payload: { artifact_id: "artifact-1" },
    context: { sessionId: "dsh-office-session", signal },
  });
  assert.equal(
    tools.get("artifact_office_inspect").definition.output.render({}, value)[0].text,
    JSON.stringify(value),
  );
});

test("the Office Bundle follows Agent scope disposal and DSH write approval", async () => {
  const handlers = new Map();
  const effects = [];
  const registered = [];
  const disposed = [];
  const officeArtifactHost = {
    inspect: async () => ({ ok: true }),
    create: async () => ({ ok: true }),
    edit: async () => ({ ok: true }),
  };
  const ctx = {
    get(name) {
      return name === "officeArtifactHost" ? officeArtifactHost : null;
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  applyOfficeTools(ctx);
  const agent = {
    id: "agent-office",
    session: { id: "session-office" },
    ctx: {
      get(name) {
        if (name !== "tools") return null;
        return {
          register(definition) {
            registered.push(definition.name);
            return () => disposed.push(definition.name);
          },
        };
      },
    },
  };
  handlers.get("agent/created")({ agent });
  assert.deepEqual(registered, ["artifact_office_inspect", "artifact_office_create", "artifact_office_edit"]);
  assert.deepEqual(await handlers.get("tools/pre-execute")({ name: "artifact_office_edit" }, () => "next"), {
    kind: "ask",
    reason: "artifact_office_edit changes parent-owned DSH Desktop product data",
  });
  assert.equal(await handlers.get("tools/pre-execute")({ name: "artifact_office_inspect" }, () => "next"), "next");
  handlers.get("agent/disposed")({ agent });
  assert.deepEqual(disposed, registered);
  for (const dispose of effects) dispose();
});

test("Canvas tools use the parent-bound App Session and project", async () => {
  const calls = [];
  const canvas = {
    id: "canvas-1",
    session_id: "app-canvas-session",
    project_id: "canvas-project",
    kind: "document",
    current_version: { id: "canvas-v2" },
  };
  const previous = overrideServices({
    getCanvas: async (ctx, input) => {
      calls.push({ kind: "inspect", ctx, input });
      return canvas;
    },
    createCanvas: async (ctx, input) => {
      calls.push({ kind: "create", ctx, input });
      return { canvas: { ...canvas, current_version: { id: "canvas-v1" } }, created: true };
    },
    editCanvas: async (ctx, input) => {
      calls.push({ kind: "edit", ctx, input });
      return { canvas, version: canvas.current_version };
    },
    createCanvasSuggestion: async (ctx, input) => {
      calls.push({ kind: "suggest", ctx, input });
      return { id: "suggestion-1", canvas_id: input.canvasId, status: "pending" };
    },
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, {
    userId: "canvas-user",
    projectId: "canvas-project",
    appSessionId: "app-canvas-session",
  });
  try {
    const inspected = await dispatcher.handle({
      id: "canvas-inspect",
      sessionId: "dsh-s1",
      method: "canvasInspect",
      payload: { canvas_id: "canvas-1" },
    });
    const created = await dispatcher.handle({
      id: "canvas-create",
      sessionId: "dsh-s1",
      method: "canvasCreate",
      payload: { kind: "document", content: "First" },
    });
    const edited = await dispatcher.handle({
      id: "canvas-edit",
      sessionId: "dsh-s1",
      method: "canvasEdit",
      payload: { canvas_id: "canvas-1", base_version_id: "canvas-v1", content: "Second" },
    });
    const suggested = await dispatcher.handle({
      id: "canvas-suggest",
      sessionId: "dsh-s1",
      method: "canvasSuggest",
      payload: {
        canvas_id: "canvas-1",
        base_version_id: "canvas-v2",
        start: 0,
        end: 6,
        selected_text: "Second",
        replacement_text: "Ready",
      },
    });
    assert.ok([inspected, created, edited, suggested].every((reply) => reply.result.ok === true));
    assert.deepEqual(calls.map((call) => call.kind), ["inspect", "create", "edit", "suggest", "inspect"]);
    assert.ok(calls.every((call) => call.ctx.userId === "canvas-user"));
    assert.ok(calls.every((call) => call.input.sessionId === "app-canvas-session"));
    assert.equal(calls[1].input.metadata.created_by, "canvas_create");
    assert.equal(calls[2].input.metadata.edited_by, "canvas_edit");
    assert.equal(suggested.result.value.suggestion.id, "suggestion-1");
  } finally {
    overrideServices(previous);
    await dispatcher.dispose();
  }
});

test("the Canvas Bundle registers Canvas and local Site tools", async () => {
  const calls = [];
  const productHost = {
    async canvasInspect(payload, context) {
      calls.push({ payload, context });
      return { success: true, canvas: { id: "canvas-1" } };
    },
  };
  const agent = { session: { id: "dsh-canvas-session" } };
  const tools = createCanvasProductTools(productHost, agent);
  assert.deepEqual(new Set(tools.keys()), new Set([
    "canvas_inspect",
    "canvas_create",
    "canvas_edit",
    "canvas_suggest",
  ]));
  assert.deepEqual(tools.get("canvas_suggest").definition.parameters.required, [
    "canvas_id",
    "base_version_id",
    "start",
    "end",
    "selected_text",
    "replacement_text",
  ]);
  const signal = new AbortController().signal;
  await tools.get("canvas_inspect").definition.execute(
    { canvas_id: "canvas-1" },
    { agent, signal },
  );
  assert.deepEqual(calls[0], {
    payload: { canvas_id: "canvas-1" },
    context: { sessionId: "dsh-canvas-session", signal },
  });
});

test("the Canvas Bundle follows Agent scope disposal and DSH write approval", async () => {
  const handlers = new Map();
  const effects = [];
  const registered = [];
  const disposed = [];
  const productHost = {
    canvasInspect: async () => ({ ok: true }),
    canvasCreate: async () => ({ ok: true }),
    canvasEdit: async () => ({ ok: true }),
    canvasSuggest: async () => ({ ok: true }),
  };
  const ctx = {
    get(name) {
      return name === "productHost" ? productHost : null;
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  applyCanvasTools(ctx);
  const agent = {
    id: "agent-canvas",
    session: { id: "session-canvas" },
    ctx: {
      get(name) {
        if (name !== "tools") return null;
        return {
          register(definition) {
            registered.push(definition.name);
            return () => disposed.push(definition.name);
          },
        };
      },
    },
  };
  handlers.get("agent/created")({ agent });
  assert.deepEqual(registered, ["canvas_inspect", "canvas_create", "canvas_edit", "canvas_suggest"]);
  assert.deepEqual(await handlers.get("tools/pre-execute")({ name: "canvas_edit" }, () => "next"), {
    kind: "ask",
    reason: "canvas_edit changes parent-owned DSH Desktop product data",
  });
  assert.equal(await handlers.get("tools/pre-execute")({ name: "canvas_inspect" }, () => "next"), "next");
  handlers.get("agent/disposed")({ agent });
  assert.deepEqual(disposed, registered);
  for (const dispose of effects) dispose();
});

test("ui_render is validated by the bound parent and registered in the DSH Agent scope", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, {
    userId: "ui-user",
    projectId: "ui-project",
    appSessionId: "app-ui-session",
  });
  const document = {
    schema_version: 1,
    surface_id: "release-status",
    revision: 1,
    title: "Release status",
    summary: "Two checks passed",
    root: {
      id: "status",
      type: "metric",
      label: "Checks",
      value: "2/2",
    },
  };
  try {
    const rendered = await dispatcher.handle({
      id: "ui-render",
      sessionId: "dsh-s1",
      method: "uiRender",
      payload: document,
    });
    assert.equal(rendered.result.ok, true);
    assert.equal(rendered.result.value.project_id, "ui-project");
    assert.equal(rendered.result.value.session_id, "app-ui-session");
    assert.equal(rendered.result.value.generative_ui.surface_id, "release-status");
    assert.match(rendered.result.value.document_hash, /^sha256:[a-f0-9]{64}$/);

    const rejected = await dispatcher.handle({
      id: "ui-render-invalid",
      sessionId: "dsh-s1",
      method: "uiRender",
      payload: { ...document, root: { id: "bad", type: "script" } },
    });
    assert.equal(rejected.result.ok, false);
    assert.match(rejected.result.error.message, /must be one of|unsupported|unknown node type/i);
  } finally {
    await dispatcher.dispose();
  }

  const calls = [];
  const productHost = {
    async uiRender(payload, context) {
      calls.push({ payload, context });
      return { success: true, generative_ui: payload };
    },
  };
  const agent = { session: { id: "dsh-ui-session" } };
  const tools = createStructuredUiProductTools(productHost, agent);
  assert.deepEqual([...tools.keys()], ["ui_render"]);
  assert.deepEqual(tools.get("ui_render").definition.parameters.required, [
    "schema_version",
    "surface_id",
    "revision",
    "summary",
    "root",
  ]);
  await tools.get("ui_render").definition.execute(document, { agent });
  assert.deepEqual(calls[0], { payload: document, context: { sessionId: "dsh-ui-session", signal: undefined } });
});

test("the Structured UI Bundle follows Agent scope registration and cleanup", () => {
  const handlers = new Map();
  const effects = [];
  const registered = [];
  const disposed = [];
  const productHost = { uiRender: async () => ({ ok: true }) };
  const ctx = {
    get(name) {
      return name === "productHost" ? productHost : null;
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  applyStructuredUiTools(ctx);
  const agent = {
    id: "agent-structured-ui",
    session: { id: "session-structured-ui" },
    ctx: {
      get(name) {
        if (name !== "tools") return null;
        return {
          register(definition) {
            registered.push(definition.name);
            return () => disposed.push(definition.name);
          },
        };
      },
    },
  };
  handlers.get("agent/created")({ agent });
  assert.deepEqual(registered, ["ui_render"]);
  handlers.get("agent/disposed")({ agent });
  assert.deepEqual(disposed, registered);
  for (const dispose of effects) dispose();
});

test("the Project Bundle registers read-only tools over productHost", async () => {
  const calls = [];
  const productHost = {
    async projectList(payload, context) {
      calls.push({ operation: "projectList", payload, context });
      return { items: [] };
    },
    async conversationList(payload, context) {
      calls.push({ operation: "conversationList", payload, context });
      return { items: [] };
    },
  };
  const agent = { session: { id: "dsh-project-session" } };
  const tools = createProjectProductTools(productHost, agent);
  assert.deepEqual(new Set(tools.keys()), new Set(["project_list", "conversation_list"]));
  await tools.get("project_list").definition.execute({ search: "alpha" }, { agent });
  await tools.get("conversation_list").definition.execute({ archived: true }, { agent });
  assert.deepEqual(calls, [{
    operation: "projectList",
    payload: { search: "alpha" },
    context: { sessionId: "dsh-project-session", signal: undefined },
  }, {
    operation: "conversationList",
    payload: { archived: true },
    context: { sessionId: "dsh-project-session", signal: undefined },
  }]);
});

test("the Project Bundle follows Agent scope registration and cleanup", () => {
  const handlers = new Map();
  const effects = [];
  const registered = [];
  const disposed = [];
  const productHost = {
    projectList: async () => ({ items: [] }),
    conversationList: async () => ({ items: [] }),
  };
  const ctx = {
    get(name) {
      return name === "productHost" ? productHost : null;
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  applyProjectTools(ctx);
  const agent = {
    id: "agent-project",
    session: { id: "session-project" },
    ctx: {
      get(name) {
        if (name !== "tools") return null;
        return {
          register(definition) {
            registered.push(definition.name);
            return () => disposed.push(definition.name);
          },
        };
      },
    },
  };
  handlers.get("agent/created")({ agent });
  assert.deepEqual(registered, ["project_list", "conversation_list"]);
  handlers.get("agent/disposed")({ agent });
  assert.deepEqual(disposed, registered);
  for (const dispose of effects) dispose();
});

test("the product bridge no longer owns a Tool registry dependency", () => {
  assert.deepEqual(productBridgeInject, ["agents", "productHost"]);
});

test("the product bridge keeps only the context hook in the Agent lifecycle", async () => {
  const handlers = new Map();
  const agentHandlers = new Map();
  const disposed = [];
  const effects = [];
  const contextCalls = [];
  const ctx = {
    agents: { get: () => null },
    get(name) {
      return name === "productHost" ? {
        conversationContext: async (request, context) => {
          contextCalls.push({ request, context });
          return {
            instructions: {
              text: "## Application instructions\n\n先给结论。",
              scopes: { application: true, project: false, temporary: false },
            },
          };
        },
      } : null;
    },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  applyProductBridge(ctx);
  const agent = {
    id: "agent-context",
    session: { id: "session-context", header: {} },
    ctx: {
      logger: { warn() {} },
      on(name, handler) {
        agentHandlers.set(name, handler);
        return () => disposed.push(name);
      },
    },
  };
  handlers.get("agent/created")({ agent });
  assert.deepEqual(new Set(agentHandlers.keys()), new Set(["agent/pre-step"]));
  const signal = new AbortController().signal;
  const decision = await agentHandlers.get("agent/pre-step")(
    { signal },
    async () => ({ kind: "enter", messages: [{ id: "user-message", role: "user", content: [] }] }),
  );
  assert.equal(contextCalls.length, 1);
  assert.deepEqual(contextCalls[0], { request: {}, context: { sessionId: "session-context", signal } });
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[1].source.plugin, "dsh-work-context");
  handlers.get("agent/disposed")({ agent });
  assert.deepEqual(new Set(disposed), new Set(["agent/pre-step"]));
  for (const dispose of effects) dispose();
});

test("the portable model Bundle pins a sub-Agent to its resolved parent target", async () => {
  assert.deepEqual(modelInheritanceInject, ["agents"]);
  assert.equal(modelTarget({ provider: "", model: "missing" }), null);
  assert.deepEqual(modelTarget({
    provider: "deepseek-official",
    model: "deepseek-reasoner",
    maxTokens: 8192,
    reasoningEffort: "high",
  }), {
    provider: "deepseek-official",
    model: "deepseek-reasoner",
    maxTokens: 8192,
    reasoningEffort: "high",
  });

  const handlers = new Map();
  const effects = [];
  const agents = new Map();
  const ctx = {
    agents: { get: (sessionId) => agents.get(sessionId) || null },
    on(name, handler) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  const createAgent = (sessionId, header = {}) => {
    const listeners = new Map();
    const agent = {
      session: { id: sessionId, header },
      ctx: {
        on(name, handler, options = {}) {
          const entries = listeners.get(name) || [];
          if (options.prepend) entries.unshift(handler);
          else entries.push(handler);
          listeners.set(name, entries);
          return () => listeners.set(
            name,
            (listeners.get(name) || []).filter((entry) => entry !== handler),
          );
        },
      },
      async waterfall(name, args, next) {
        const entries = [...(listeners.get(name) || [])];
        const invoke = async (index) => (
          index >= entries.length ? next() : entries[index](...args, () => invoke(index + 1))
        );
        return invoke(0);
      },
      listenerCount(name) {
        return (listeners.get(name) || []).length;
      },
    };
    agents.set(sessionId, agent);
    return agent;
  };

  applyModelInheritance(ctx);
  const parent = createAgent("parent-session");
  handlers.get("agent/created")({ agent: parent });
  const parentTarget = {
    provider: "deepseek-official",
    model: "deepseek-reasoner",
    maxTokens: 8192,
    reasoningEffort: "high",
  };
  assert.deepEqual(await parent.waterfall("agent/request", [{}], async () => parentTarget), parentTarget);

  const child = createAgent("child-session", { origin: "subagent", parentSession: "parent-session" });
  handlers.get("agent/created")({ agent: child });
  const assembled = await child.waterfall(
    "system-prompt/assemble",
    [{ variables: { session: "child-session" } }, {}],
    async () => ({ variables: { session: "child-session" } }),
  );
  assert.deepEqual(assembled.variables, {
    session: "child-session",
    provider: "deepseek-official",
    model: "deepseek-reasoner",
  });
  const childRequest = await child.waterfall("agent/request", [{}], async () => ({
    provider: "fallback",
    model: "fallback-model",
    maxTokens: 1024,
    reasoningEffort: "low",
    temperature: 0.2,
  }));
  assert.deepEqual(childRequest, {
    provider: "deepseek-official",
    model: "deepseek-reasoner",
    maxTokens: 8192,
    reasoningEffort: "high",
    temperature: 0.2,
  });

  const orphan = createAgent("orphan-session", { origin: "subagent", parentSession: "missing-parent" });
  handlers.get("agent/created")({ agent: orphan });
  assert.equal(orphan.listenerCount("system-prompt/assemble"), 0);
  const orphanRequest = {
    provider: "fallback",
    model: "fallback-model",
    reasoningEffort: "low",
  };
  assert.deepEqual(
    await orphan.waterfall("agent/request", [{}], async () => orphanRequest),
    orphanRequest,
  );

  handlers.get("agent/disposed")({ agent: orphan });
  handlers.get("agent/disposed")({ agent: child });
  handlers.get("agent/disposed")({ agent: parent });
  assert.equal(child.listenerCount("agent/request"), 0);
  assert.equal(child.listenerCount("system-prompt/assemble"), 0);
  assert.equal(parent.listenerCount("agent/request"), 0);
  assert.equal(orphan.listenerCount("agent/request"), 0);
  for (const dispose of effects) dispose();
});

test("session dispatcher routes concurrent DSH sessions to separate identities", async () => {
  const previous = overrideServices({
    listProjects: async (ctx) => ({ data: { items: [{ id: ctx.userId, name: ctx.userId }], total: 1 } }),
  });
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher, { dshSessionId: "dsh-s1", appSessionId: "app-s1", userId: "u1" });
  bindSession(dispatcher, { dshSessionId: "dsh-s2", appSessionId: "app-s2", userId: "u2" });
  const [one, two] = await Promise.all([
    dispatcher.handle({ id: "r11", sessionId: "dsh-s1", method: "projectList", payload: {} }),
    dispatcher.handle({ id: "r12", sessionId: "dsh-s2", method: "projectList", payload: {} }),
  ]);
  overrideServices(previous);
  assert.equal(one.result.value.items[0].id, "u1");
  assert.equal(two.result.value.items[0].id, "u2");
});

test("session dispatcher rejects identity changes for an existing DSH session", () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  assert.throws(
    () => bindSession(dispatcher, { appSessionId: "other-app", userId: "other-user" }),
    (error) => error?.code === "DSH_PRODUCT_HOST_IDENTITY_CONFLICT",
  );
});

test("session dispatcher rejects requests without a DSH sessionId", async () => {
  const dispatcher = createSessionProductHostDispatcher();
  bindSession(dispatcher);
  const reply = await dispatcher.handle({ id: "r13", method: "projectList", payload: {} });
  assert.equal(reply.result.ok, false);
  assert.equal(reply.result.error.code, "product-rejected");
});
