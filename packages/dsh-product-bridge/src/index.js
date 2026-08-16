/**
 * App-local DSH Bundle bridge for parent-owned instructions. The process wire carries only a DSH
 * Session id; dsh-work resolves the App identity in the parent process.
 */

import { randomUUID } from "node:crypto";

export const name = "product-bridge";
export const inject = ["agents", "productHost"];

/** Build one logged DSH context message from parent-owned application and project instructions. */
export function createDshWorkInstructionMessage(snapshot) {
  const text = String(snapshot?.instructions?.text || "").trim();
  const scopes = snapshot?.instructions?.scopes;
  if (!text || !scopes || typeof scopes !== "object") return null;
  const source = Object.freeze({
    kind: "plugin",
    plugin: "dsh-work-context",
    form: "instructions",
    dshWorkInstructions: Object.freeze({
      application: scopes.application === true,
      project: scopes.project === true,
      temporary: scopes.temporary === true,
    }),
  });
  const content = Object.freeze([Object.freeze({ type: "text", text })]);
  return Object.freeze({ id: randomUUID(), role: "user", content, source });
}

function registerConversationContext(productHost, agent) {
  return agent.ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    if (decision?.kind !== "enter") return decision;
    try {
      const snapshot = await productHost.conversationContext(
        {},
        { sessionId: agent.session.id, signal: payload.signal },
      );
      const instructions = createDshWorkInstructionMessage(snapshot);
      return instructions
        ? { kind: "enter", messages: [...decision.messages, instructions] }
        : decision;
    } catch (error) {
      agent.ctx.logger.warn(`dsh-work context unavailable: ${error?.message || String(error)}`);
      return decision;
    }
  });
}

/** Mount dsh-work instructions on DSH Agent seams. */
export function apply(ctx) {
  const productHost = ctx.get("productHost");
  if (typeof productHost?.conversationContext !== "function") {
    throw new Error("dsh-product-bridge requires the productHost conversationContext method");
  }
  const agentScopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const state = {
      contextDisposer: () => {},
    };
    agentScopes.set(agent, state);
    state.contextDisposer = registerConversationContext(productHost, agent);
  });

  ctx.on("agent/disposed", ({ agent }) => {
    const state = agentScopes.get(agent);
    agentScopes.delete(agent);
    state?.contextDisposer?.();
  });

  ctx.effect(() => () => {
    for (const state of agentScopes.values()) {
      state.contextDisposer?.();
    }
    agentScopes.clear();
  }, "dsh-work product bridge agent scopes");

}
