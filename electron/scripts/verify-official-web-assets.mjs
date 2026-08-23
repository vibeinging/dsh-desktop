import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const serverNodeModules = join(appRoot, '.desktop-build', 'server', 'node_modules')
const packagedDshRuntime = join(serverNodeModules, '@deepseek-ai', 'dsh')

if (!existsSync(join(serverNodeModules, '@deepseek-ai', 'dsh-web-app'))) {
  throw new Error('随包官方 dsh-web-app 不存在；请先运行 prepare-package')
}
if (!existsSync(join(packagedDshRuntime, 'package.json'))
  || !existsSync(join(packagedDshRuntime, 'lib', 'bin.js'))) {
  throw new Error('随包官方 DSH CLI npm 依赖不存在；请先运行 prepare-package')
}

console.log('[build] 官方 dsh-web-app 已由随包 DSH Runtime 提供，不构建旧 Renderer 或自研 UI')
