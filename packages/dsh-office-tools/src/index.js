/** Office artifact tools over one session-addressed product Host service. */

export const name = "dsh-work-office-tools";
export const inject = ["agents", "tools", "officeArtifactHost"];

const TOOL_TIMEOUT_MS = 60_000;
const WRITE_TOOLS = new Set(["artifact_office_create", "artifact_office_edit"]);

const OFFICE_OPERATION_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: "replace_text | replace_range | set_cell | clear_cell | set_range | annotate_region | cover_text",
    },
    anchor: { type: "string", description: "Stable anchor returned by artifact_office_inspect." },
    text: { type: "string" },
    start: {},
    end: { type: "number" },
    sheet: { type: "string" },
    address: { type: "string" },
    value: {},
    formula: { type: "string" },
    values: { type: "array", items: { type: "array", items: {} } },
    page: { type: "number" },
    rect: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["x", "y", "width", "height"],
      additionalProperties: false,
    },
    color: { type: "string" },
  },
  required: ["type"],
  additionalProperties: true,
};

const TOOL_SPECS = [
  {
    name: "artifact_office_inspect",
    hostMethod: "inspect",
    title: "Inspect office artifact",
    description: "Read the current editable structure and stable anchors of a Markdown, DOCX, XLSX, PPTX, or PDF artifact. Always inspect before editing.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Current project id; omit to use the bound DSH Session project." },
        artifact_id: { type: "string", description: "Stable project artifact id." },
        version_id: { type: "string", description: "Version to inspect; omit for the current version." },
      },
      required: ["artifact_id"],
      additionalProperties: false,
    },
  },
  {
    name: "artifact_office_create",
    hostMethod: "create",
    title: "Create office artifact",
    description: "Create a Markdown, DOCX, XLSX, PPTX, or PDF artifact in the current project Library and version history.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Current project id; omit to use the bound DSH Session project." },
        format: { type: "string", enum: ["markdown", "docx", "xlsx", "pptx", "pdf"] },
        name: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        description: { type: "string" },
        specification: { type: "object", additionalProperties: true },
      },
      required: ["format"],
      additionalProperties: false,
    },
  },
  {
    name: "artifact_office_edit",
    hostMethod: "edit",
    title: "Edit office artifact",
    description: "Edit an office artifact at stable anchors returned by artifact_office_inspect. Saving creates an immutable new version and rejects a stale base version.",
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Current project id; omit to use the bound DSH Session project." },
        artifact_id: { type: "string", description: "Stable project artifact id." },
        base_version_id: { type: "string", description: "Current version id returned by artifact_office_inspect." },
        operations: { type: "array", items: OFFICE_OPERATION_SCHEMA },
        change_summary: { type: "string" },
      },
      required: ["artifact_id", "base_version_id", "operations"],
      additionalProperties: false,
    },
  },
];

function officeTool(officeArtifactHost, agent, spec) {
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
      return officeArtifactHost[spec.hostMethod](args, {
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

/** Build the Office tool definitions for one Agent scope. */
export function createOfficeProductTools(officeArtifactHost, agent) {
  return new Map(TOOL_SPECS.map((spec) => [spec.name, {
    label: spec.title,
    definition: officeTool(officeArtifactHost, agent, spec),
  }]));
}

/** Register Office tools against the provided session-addressed Host. */
export function apply(ctx) {
  const officeArtifactHost = ctx.get("officeArtifactHost");
  if (!["inspect", "create", "edit"].every((method) => typeof officeArtifactHost?.[method] === "function")) {
    throw new Error("dsh-office-tools requires the officeArtifactHost service");
  }
  const scopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const tools = agent.ctx.get("tools");
    if (!tools) throw new Error(`office tools registry is not ready for agent ${agent.id}`);
    const disposers = new Map();
    try {
      for (const [toolName, tool] of createOfficeProductTools(officeArtifactHost, agent)) {
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
      reason: `${exec.name} changes parent-owned DSH Desktop product data`,
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
  }, "dsh-work office tool scopes");
}
