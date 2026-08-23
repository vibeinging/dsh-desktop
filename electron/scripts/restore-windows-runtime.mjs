import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(SCRIPT_PATH)
const APP_ROOT = resolve(SCRIPT_DIR, '../..')
const require = createRequire(import.meta.url)
const { copyDshRuntime } = require('./after-pack.cjs')

/** Restore and verify the pinned DSH CLI after Electron Builder has fully exited. */
export async function restorePackagedWindowsRuntime({
  source = join(APP_ROOT, '.desktop-build', 'server', 'runtime', 'dsh'),
  target = join(APP_ROOT, 'release', 'win-unpacked', 'resources', 'server', 'runtime', 'dsh'),
} = {}) {
  await copyDshRuntime(source, target)
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await restorePackagedWindowsRuntime()
}
