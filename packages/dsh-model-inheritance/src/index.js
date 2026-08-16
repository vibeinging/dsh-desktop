/**
 * Portable DSH Bundle that keeps sub-Agents on the model target resolved for their parent Agent.
 */

export const name = "dsh-model-inheritance";
export const inject = ["agents"];

/** Return the stable model fields that a child Agent may inherit. */
export function modelTarget(config) {
  const provider = String(config?.provider || "").trim();
  const model = String(config?.model || "").trim();
  if (!provider || !model) return null;
  return Object.freeze({
    provider,
    model,
    ...(Number.isSafeInteger(config?.maxTokens) && config.maxTokens > 0 ? { maxTokens: config.maxTokens } : {}),
    ...(config?.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
  });
}

function trackAgentModelTarget(agent, state) {
  return agent.ctx.on("agent/request", async (_payload, next) => {
    const resolved = await next();
    state.modelTarget = modelTarget(resolved);
    return resolved;
  }, { prepend: true });
}

function pinInheritedModelTarget(agent, selected) {
  const target = { current: selected, assembled: null };
  const disposeAssembly = agent.ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
    const assembled = await next();
    target.assembled = target.current;
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: target.current.provider,
        model: target.current.model,
      },
    };
  }, { prepend: true });
  const disposeRequest = agent.ctx.on("agent/request", async (_payload, next) => {
    const resolved = await next();
    const selectedTarget = target.assembled || target.current;
    const { reasoningEffort: _reasoningEffort, ...withoutReasoningEffort } = resolved;
    return {
      ...withoutReasoningEffort,
      provider: selectedTarget.provider,
      model: selectedTarget.model,
      ...(selectedTarget.maxTokens ? { maxTokens: selectedTarget.maxTokens } : {}),
      ...(selectedTarget.reasoningEffort ? { reasoningEffort: selectedTarget.reasoningEffort } : {}),
    };
  }, { prepend: true });
  return () => {
    disposeRequest();
    disposeAssembly();
  };
}

/** Mount parent-to-child model inheritance on official DSH Agent seams. */
export function apply(ctx) {
  const agentScopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const parentId = String(agent.session?.header?.parentSession || "").trim();
    const parent = parentId ? ctx.agents.get(parentId) : null;
    const inheritedTarget = parent ? agentScopes.get(parent)?.modelTarget : null;
    const state = {
      modelTargetDisposer: () => {},
      modelTrackingDisposer: () => {},
      modelTarget: inheritedTarget || null,
    };
    agentScopes.set(agent, state);
    if (agent.session?.header?.origin === "subagent" && inheritedTarget) {
      state.modelTargetDisposer = pinInheritedModelTarget(agent, inheritedTarget);
    }
    state.modelTrackingDisposer = trackAgentModelTarget(agent, state);
  });

  ctx.on("agent/disposed", ({ agent }) => {
    const state = agentScopes.get(agent);
    agentScopes.delete(agent);
    state?.modelTrackingDisposer?.();
    state?.modelTargetDisposer?.();
  });

  ctx.effect(() => () => {
    for (const state of agentScopes.values()) {
      state.modelTrackingDisposer?.();
      state.modelTargetDisposer?.();
    }
    agentScopes.clear();
  }, "dsh model inheritance agent scopes");
}
