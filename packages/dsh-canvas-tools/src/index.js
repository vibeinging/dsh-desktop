/** Versioned Canvas and local Site tools over one session-addressed product Host. */

export const name = "dsh-work-canvas-tools";
export const inject = ["agents", "tools", "productHost"];

const TOOL_TIMEOUT_MS = 60_000;
const WRITE_TOOLS = new Set(["canvas_create", "canvas_edit", "canvas_suggest"]);

const CANVAS_OPERATION_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["replace_range", "replace_all"] },
    start: { type: "number", description: "UTF-16 start offset for replace_range." },
    end: { type: "number", description: "UTF-16 end offset for replace_range." },
    text: { type: "string", description: "Replacement text." },
  },
  required: ["type", "text"],
  additionalProperties: false,
};

const TOOL_SPECS = [{
  name: "canvas_inspect",
  hostMethod: "canvasInspect",
  title: "Inspect canvas",
  description: "Read a Canvas or local Site in the current conversation, including its content and immutable version id. Always inspect before editing or suggesting.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: { type: "string", description: "Canvas id in the current conversation." },
    },
    required: ["canvas_id"],
    additionalProperties: false,
  },
}, {
  name: "canvas_create",
  hostMethod: "canvasCreate",
  title: "Create canvas",
  description: "Create a versioned document, code Canvas, or local single-file HTML Site in the current conversation.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Optional title; derived from content when omitted." },
      kind: { type: "string", enum: ["document", "code", "site"], description: "Canvas kind; defaults to document." },
      language: { type: "string", description: "Code language; Sites always use html." },
      content: { type: "string", description: "Initial full content; a Site must be complete single-file HTML." },
      change_summary: { type: "string", description: "Creation summary." },
    },
    additionalProperties: false,
  },
}, {
  name: "canvas_edit",
  hostMethod: "canvasEdit",
  title: "Edit canvas",
  description: "Save a new immutable Canvas or Site version. Inspect first and provide the current base version; use either full content or non-overlapping operations.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: { type: "string", description: "Canvas id in the current conversation." },
      base_version_id: { type: "string", description: "Current version id returned by canvas_inspect." },
      content: { type: "string", description: "Replacement full content; mutually exclusive with operations." },
      operations: { type: "array", items: CANVAS_OPERATION_SCHEMA, description: "Precise edits against the same immutable base version." },
      change_summary: { type: "string", description: "Change summary." },
    },
    required: ["canvas_id", "base_version_id"],
    additionalProperties: false,
  },
}, {
  name: "canvas_suggest",
  hostMethod: "canvasSuggest",
  title: "Suggest canvas edit",
  description: "Create a reviewable inline suggestion against an exact selection in the current Canvas version without changing its content.",
  parameters: {
    type: "object",
    properties: {
      canvas_id: { type: "string", description: "Canvas id in the current conversation." },
      base_version_id: { type: "string", description: "Current version id returned by canvas_inspect." },
      start: { type: "number", description: "UTF-16 selection start offset." },
      end: { type: "number", description: "UTF-16 selection end offset." },
      selected_text: { type: "string", description: "Exact selected text; the parent verifies it byte-for-byte." },
      replacement_text: { type: "string", description: "Suggested replacement text." },
      instruction: { type: "string", description: "Reason or requested rewrite." },
    },
    required: ["canvas_id", "base_version_id", "start", "end", "selected_text", "replacement_text"],
    additionalProperties: false,
  },
}];

function canvasTool(productHost, agent, spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: structuredClone(spec.parameters),
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value) }];
      },
    },
    async execute(args, exec) {
      return productHost[spec.hostMethod](args, {
        sessionId: exec.agent?.session.id || agent.session.id,
        signal: exec.signal,
      });
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    presentCall(args) {
      return { card: "generic", title: spec.title, kind: "execute", rawInput: args };
    },
    presentResult() {
      return { card: "generic", title: spec.title };
    },
  };
}

/** Build the Canvas and local Site tools for one Agent scope. */
export function createCanvasProductTools(productHost, agent) {
  return new Map(TOOL_SPECS.map((spec) => [spec.name, {
    label: spec.title,
    definition: canvasTool(productHost, agent, spec),
  }]));
}

/** Register Canvas tools against the provided session-addressed Host. */
export function apply(ctx) {
  const productHost = ctx.get("productHost");
  if (!["canvasInspect", "canvasCreate", "canvasEdit", "canvasSuggest"]
    .every((method) => typeof productHost?.[method] === "function")) {
    throw new Error("dsh-canvas-tools requires the productHost Canvas methods");
  }
  const scopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const tools = agent.ctx.get("tools");
    if (!tools) throw new Error(`Canvas tools registry is not ready for agent ${agent.id}`);
    const disposers = new Map();
    try {
      for (const [toolName, tool] of createCanvasProductTools(productHost, agent)) {
        disposers.set(toolName, tools.register(tool.definition));
      }
      scopes.set(agent, disposers);
    } catch (error) {
      for (const dispose of disposers.values()) dispose();
      throw error;
    }
  });

  ctx.on("tools/pre-execute", (exec, next) => {
    if (!WRITE_TOOLS.has(exec.name)) return next();
    return Promise.resolve({
      kind: "ask",
      reason: `${exec.name} changes parent-owned DeepSeek Harness Desktop App product data`,
    });
  });

  ctx.on("agent/disposed", ({ agent }) => {
    for (const dispose of scopes.get(agent)?.values() || []) dispose();
    scopes.delete(agent);
  });

  ctx.effect(() => () => {
    for (const disposers of scopes.values()) {
      for (const dispose of disposers.values()) dispose();
    }
    scopes.clear();
  }, "dsh-work Canvas tool scopes");
}
