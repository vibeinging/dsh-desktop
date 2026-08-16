/** Read-only project and conversation tools over one session-addressed product Host. */

export const name = "dsh-work-project-tools";
export const inject = ["agents", "tools", "productHost"];

const TOOL_TIMEOUT_MS = 60_000;

const TOOL_SPECS = [{
  name: "project_list",
  hostMethod: "projectList",
  title: "List projects",
  description: "List DeepSeek Harness Desktop App projects available to the current user.",
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Optional project name search." },
    },
    additionalProperties: false,
  },
}, {
  name: "conversation_list",
  hostMethod: "conversationList",
  title: "List project conversations",
  description: "List conversations in the project bound to the current DSH Session.",
  parameters: {
    type: "object",
    properties: {
      archived: { type: "boolean", description: "Include archived conversations." },
    },
    additionalProperties: false,
  },
}];

function projectTool(productHost, agent, spec) {
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

/** Build the read-only project tools for one Agent scope. */
export function createProjectProductTools(productHost, agent) {
  return new Map(TOOL_SPECS.map((spec) => [spec.name, {
    label: spec.title,
    definition: projectTool(productHost, agent, spec),
  }]));
}

/** Register project tools against the provided session-addressed Host. */
export function apply(ctx) {
  const productHost = ctx.get("productHost");
  if (!["projectList", "conversationList"].every((method) => typeof productHost?.[method] === "function")) {
    throw new Error("dsh-project-tools requires the productHost project methods");
  }
  const scopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const tools = agent.ctx.get("tools");
    if (!tools) throw new Error(`project tools registry is not ready for agent ${agent.id}`);
    const disposers = new Map();
    try {
      for (const [toolName, tool] of createProjectProductTools(productHost, agent)) {
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
  }, "dsh-work project tool scopes");
}
