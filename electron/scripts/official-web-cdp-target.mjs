/**
 * Finds the official loopback Web page among Electron CDP targets.
 *
 * @param {unknown[]} targets CDP target descriptors.
 * @returns {Record<string, unknown> | undefined} The trusted official Web target.
 */
export function findOfficialWebCdpTarget(targets) {
  if (!Array.isArray(targets)) return undefined
  return targets.find((target) => {
    if (target?.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false
    if (typeof target.url !== 'string') return false
    try {
      const url = new URL(target.url)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return false
      if (url.username || url.password || url.hash || url.pathname !== '/') return false
      if (url.searchParams.size === 0) return true
      return url.searchParams.size === 1 && Boolean(url.searchParams.get('token'))
    } catch {
      return false
    }
  })
}
