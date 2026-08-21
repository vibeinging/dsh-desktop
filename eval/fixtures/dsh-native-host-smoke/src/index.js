/** Test-only Bundle that drives the real session-bound Electron window Host. */

export const name = "dsh-native-host-smoke";
export const inject = ["agents", "tools", "fileDialogHost", "windowHost"];

function contextFor(agent, exec) {
  return {
    sessionId: exec.agent?.session.id || agent.session.id,
    signal: exec.signal,
  };
}

/** Register one non-release tool for the packaged native Host smoke. */
export function apply(ctx) {
  const fileDialogHost = ctx.get("fileDialogHost");
  const windowHost = ctx.get("windowHost");
  if (!fileDialogHost || !windowHost) {
    throw new Error("dsh-native-host-smoke requires fileDialogHost and windowHost");
  }
  const scopes = new Map();
  ctx.on("agent/created", ({ agent }) => {
    const tools = agent.ctx.get("tools");
    if (!tools) throw new Error(`native Host smoke tool registry is missing for ${agent.id}`);
    const disposeWindow = tools.register({
      name: "native_host_window_smoke",
      description: "Run the DSH Desktop session-bound native window Host smoke.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(_args, exec) {
        const context = contextFor(agent, exec);
        const initial = await windowHost.getState(context);
        const focused = await windowHost.focus(context);
        const minimized = await windowHost.minimize(context);
        const maximized = await windowHost.maximize(context);
        const restored = await windowHost.restore(context);
        const final = await windowHost.getState(context);
        return { initial, focused, minimized, maximized, restored, final };
      },
      timeoutMs: 30_000,
      presentCall() {
        return { card: "generic", title: "Native window Host smoke", kind: "execute" };
      },
      presentResult() {
        return { card: "generic", title: "Native window Host smoke" };
      },
    });
    const disposeDialogs = tools.register({
      name: "native_host_file_dialog_smoke",
      description: "Run the DSH Desktop session-bound native file and directory dialog smoke.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      output: {
        schema: { type: "object", additionalProperties: true },
        render(_args, value) {
          return [{ type: "text", text: JSON.stringify(value) }];
        },
      },
      async execute(_args, exec) {
        const context = contextFor(agent, exec);
        const files = await fileDialogHost.openFiles({
          title: "DSH Desktop file dialog smoke",
          multiple: false,
          filters: [{ name: "Text", extensions: ["txt"] }],
        }, context);
        const directory = await fileDialogHost.openDirectory({
          title: "DSH Desktop directory dialog smoke",
        }, context);
        return { files, directory };
      },
      timeoutMs: 180_000,
      presentCall() {
        return { card: "generic", title: "Native file dialog smoke", kind: "execute" };
      },
      presentResult() {
        return { card: "generic", title: "Native file dialog smoke" };
      },
    });
    scopes.set(agent, () => {
      disposeWindow();
      disposeDialogs();
    });
  });
  ctx.on("agent/disposed", ({ agent }) => {
    scopes.get(agent)?.();
    scopes.delete(agent);
  });
  ctx.effect(() => () => {
    for (const dispose of scopes.values()) dispose();
    scopes.clear();
  }, "dsh native Host smoke tool scopes");
}
