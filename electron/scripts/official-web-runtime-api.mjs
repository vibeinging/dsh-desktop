/**
 * Builds one unary request for the current official Web Remote protocol.
 *
 * @param {string} method Legacy dotted method used by the smoke scenario.
 * @param {Record<string, unknown>} payload Method payload.
 * @param {string} rpcId Correlation id.
 * @returns {{ endpoint: string, body: Record<string, unknown> }} Wire request.
 */
export function createOfficialWebUnaryRequest(method, payload = {}, rpcId) {
  const [namespace, name, ...rest] = String(method).split('.')
  if (!namespace || !name || rest.length || !rpcId) throw new Error(`不支持的官方 Web smoke RPC：${method}`)
  const endpoint = `${namespace}/${name}`
  const request = method === 'session.prompt'
    ? { ...payload, requestId: payload.requestId || rpcId }
    : payload
  const argumentName = method === 'session.list' ? '_request' : 'request'
  return {
    endpoint,
    body: {
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { args: { [argumentName]: request } },
    },
  }
}

/**
 * Builds the first logical stream frame for a Session snapshot.
 *
 * @param {{ sessionId: string, maxMessages?: number, streamId: string }} options Stream options.
 * @returns {Record<string, unknown>} Remote mux open frame.
 */
export function createOfficialWebSessionFollowFrame({ sessionId, maxMessages, streamId }) {
  if (!sessionId || !streamId) throw new Error('Session follow smoke 缺少标识')
  return {
    type: 'open',
    streamId,
    endpoint: 'session/follow',
    payload: {
      args: {
        request: {
          address: { kind: 'session', sessionId },
          ...(maxMessages === undefined ? {} : { maxMessages }),
        },
      },
    },
  }
}
