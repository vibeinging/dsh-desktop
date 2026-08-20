import { delimiter, join } from 'node:path'

/** Return a system-only PATH for packaged smoke processes. */
export function systemOnlyPath() {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
    return [
      join(systemRoot, 'System32'),
      join(systemRoot, 'System32', 'Wbem'),
      systemRoot,
    ].join(delimiter)
  }
  return ['/usr/bin', '/bin'].join(delimiter)
}

/** Prefix a packaged executable directory without inheriting the user's PATH. */
export function pathWithPackagedBin(directory) {
  return [directory, systemOnlyPath()].join(delimiter)
}
