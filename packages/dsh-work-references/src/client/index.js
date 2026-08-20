/** Browser half: one official @ input trigger and no private host state. */

export const inject = ["inputTriggers"];

const ROUTE_PATH = "/dsh-work-references/files";
const MAX_QUERY_LENGTH = 200;

function isItem(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.name === "string"
    && value.name.length > 0
    && typeof value.text === "string"
    && value.text.length > 0
    && !value.text.includes("..")
    && !value.text.startsWith("/");
}

export function apply(ctx) {
  const source = {
    trigger: "@",
    name: "dsh-work-references",
    order: 10,
    async candidates(session, { query, signal } = {}) {
      if (!session?.sessionId) return [];
      try {
        const response = await fetch(ROUTE_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            query: String(query || "").slice(0, MAX_QUERY_LENGTH),
          }),
          signal,
        });
        if (!response.ok) return [];
        const payload = await response.json();
        if (!Array.isArray(payload?.items)) return [];
        return payload.items.filter(isItem).map((item) => ({
          name: item.name,
          ...(typeof item.description === "string" && item.description
            ? { description: item.description }
            : {}),
          text: item.text,
        }));
      } catch (error) {
        if (signal?.aborted) return [];
        throw error;
      }
    },
    onPick({ candidate }) {
      return typeof candidate?.text === "string" && candidate.text
        ? { text: candidate.text }
        : undefined;
    },
  };
  ctx.effect(() => ctx.inputTriggers.registerSource(source), "dsh-work references: input source");
}
