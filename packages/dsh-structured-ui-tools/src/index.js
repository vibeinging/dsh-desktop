/** Safe structured UI Tool over one session-addressed product Host. */

export const name = "dsh-work-structured-ui-tools";
export const inject = ["agents", "tools", "productHost"];

const TOOL_TIMEOUT_MS = 60_000;

const UI_RENDER_SPEC = {
  name: "ui_render",
  title: "Render structured UI",
  description: "Render one safe, schema-validated interactive surface in the conversation. Buttons and forms submit a visible next user message and do not execute hidden actions.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "surface_id", "revision", "summary", "root"],
    properties: {
      schema_version: { type: "number", enum: [1] },
      surface_id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" },
      revision: { type: "integer", minimum: 1, maximum: 1_000_000 },
      title: { type: "string", minLength: 1, maxLength: 120 },
      summary: { type: "string", minLength: 1, maxLength: 1_000 },
      root: {
        type: "object",
        required: ["id", "type"],
        description: "Complete component tree using stack, grid, section, text, markdown, metric, alert, state, divider, table, chart, image, button, form, text_input, select, or checkbox nodes.",
      },
    },
  },
};

function structuredUiTool(productHost, agent) {
  return {
    name: UI_RENDER_SPEC.name,
    description: UI_RENDER_SPEC.description,
    parameters: structuredClone(UI_RENDER_SPEC.parameters),
    output: {
      schema: { type: "object", additionalProperties: true },
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value) }];
      },
    },
    async execute(args, exec) {
      return productHost.uiRender(args, {
        sessionId: exec.agent?.session.id || agent.session.id,
        signal: exec.signal,
      });
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    presentCall(args) {
      return { card: "generic", title: UI_RENDER_SPEC.title, kind: "execute", rawInput: args };
    },
    presentResult() {
      return { card: "generic", title: UI_RENDER_SPEC.title };
    },
  };
}

/** Build the structured UI tools for one Agent scope. */
export function createStructuredUiProductTools(productHost, agent) {
  return new Map([[UI_RENDER_SPEC.name, {
    label: UI_RENDER_SPEC.title,
    definition: structuredUiTool(productHost, agent),
  }]]);
}

/** Register structured UI tools against the provided session-addressed Host. */
export function apply(ctx) {
  const productHost = ctx.get("productHost");
  if (typeof productHost?.uiRender !== "function") {
    throw new Error("dsh-structured-ui-tools requires the productHost uiRender method");
  }
  const scopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const tools = agent.ctx.get("tools");
    if (!tools) throw new Error(`structured UI tools registry is not ready for agent ${agent.id}`);
    const disposers = new Map();
    try {
      for (const [toolName, tool] of createStructuredUiProductTools(productHost, agent)) {
        disposers.set(toolName, tools.register(tool.definition));
      }
      scopes.set(agent, disposers);
    } catch (error) {
      for (const dispose of disposers.values()) dispose();
      throw error;
    }
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
  }, "dsh-work structured UI tool scopes");
}
