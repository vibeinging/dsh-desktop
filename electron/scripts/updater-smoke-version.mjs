/**
 * Returns a stable patch version newer than the packaged App under test.
 *
 * @param {string} version Packaged App version.
 * @returns {string} The next stable patch version.
 */
export function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(version))
  if (!match) throw new Error(`不支持的 App 版本：${version}`)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}
