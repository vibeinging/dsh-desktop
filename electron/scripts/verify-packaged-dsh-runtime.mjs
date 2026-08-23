import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePackagedLayout } from './packaged-layout.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)

/** Verify the official CLI inside the packaged Server dependency tree. */
export function verifyPackagedDshRuntime(appInput) {
  const { resourcesDir } = resolvePackagedLayout(appInput)
  const root = join(resourcesDir, 'server', 'node_modules', '@deepseek-ai', 'dsh')
  const manifestPath = join(root, 'package.json')
  const entryPath = join(root, 'lib', 'bin.js')
  if (!existsSync(manifestPath) || !existsSync(entryPath)) {
    throw new Error(`Windows 产物缺少官方 DSH CLI npm 依赖: ${root}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh') {
    throw new Error(`Windows 产物 DSH CLI 包名不正确: ${manifest.name || 'unknown'}`)
  }
  return { root, version: manifest.version || null }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const input = process.argv[2]
  const result = verifyPackagedDshRuntime(input)
  console.log(`[build] Windows 产物包含官方 DSH CLI: ${result.version || 'unknown'}`)
}
