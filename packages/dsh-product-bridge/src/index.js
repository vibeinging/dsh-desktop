/**
 * App-local DSH Bundle bridge for parent-owned context and memory. The process wire carries only
 * a DSH Session id; dsh-work resolves the App identity and credentials in the parent process.
 */

import { randomUUID } from "node:crypto";

export const name = "product-bridge";
export const inject = ["agents", "productHost"];

function messageText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text || ""))
    .join("\n")
    .trim();
}

/** Build one logged DSH recall message from the parent-owned memory snapshot. */
export function createDshWorkMemoryMessage(snapshot) {
  const text = String(snapshot?.text || "").trim();
  const presentation = snapshot?.presentation;
  if (!text || !presentation || !["global_memory", "project_memory"].includes(presentation.type)) return null;
  const source = Object.freeze({
    kind: "plugin",
    plugin: "dsh-work-memory",
    form: "recall",
    dshWorkMemory: structuredClone(presentation),
  });
  const content = Object.freeze([Object.freeze({ type: "text", text })]);
  return Object.freeze({ id: randomUUID(), role: "user", content, source });
}

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

function registerConversationMemory(productHost, agent) {
  return agent.ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    if (decision?.kind !== "enter") return decision;
    const query = decision.messages
      .filter((message) => message?.source?.kind === "user")
      .map(messageText)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!query) return decision;
    try {
      const snapshot = await productHost.conversationMemory(
        { query },
        { sessionId: agent.session.id, signal: payload.signal },
      );
      const instructions = createDshWorkInstructionMessage(snapshot);
      const memory = createDshWorkMemoryMessage(snapshot);
      const additions = [instructions, memory].filter(Boolean);
      return additions.length ? { kind: "enter", messages: [...decision.messages, ...additions] } : decision;
    } catch (error) {
      agent.ctx.logger.warn(`dsh-work memory unavailable: ${error?.message || String(error)}`);
      return decision;
    }
  });
}

/** Mount dsh-work context and memory on DSH Agent seams. */
export function apply(ctx) {
  const productHost = ctx.get("productHost");
  if (typeof productHost?.conversationMemory !== "function") {
    throw new Error("dsh-product-bridge requires the productHost conversationMemory method");
  }
  const agentScopes = new Map();

  ctx.on("agent/created", ({ agent }) => {
    const state = {
      memoryDisposer: () => {},
    };
    agentScopes.set(agent, state);
    state.memoryDisposer = registerConversationMemory(productHost, agent);
  });

  ctx.on("agent/disposed", ({ agent }) => {
    const state = agentScopes.get(agent);
    agentScopes.delete(agent);
    state?.memoryDisposer?.();
  });

  ctx.effect(() => () => {
    for (const state of agentScopes.values()) {
      state.memoryDisposer?.();
    }
    agentScopes.clear();
  }, "dsh-work product bridge agent scopes");

}
