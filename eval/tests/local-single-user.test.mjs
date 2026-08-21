import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts) => fs.readFileSync(path.join(appRoot, ...parts), 'utf8')

test('desktop transport uses a fixed local data owner without JWT', () => {
  const ipc = read('server', 'src', 'transport', 'ipc_server.js')
  const http = read('server', 'src', 'transport', 'http_server.js')
  const registry = read('server', 'src', 'transport', 'registry.js')
  const pkg = JSON.parse(read('server', 'package.json'))

  assert.match(ipc, /LOCAL_OWNER_ID/)
  assert.match(http, /LOCAL_OWNER_ID/)
  assert.match(http, /isLocalOrigin/)
  assert.doesNotMatch(ipc + http, /未登录或令牌缺失|verifyToken|resolveUserId/)
  assert.doesNotMatch(registry, /authRoutes|membersRoutes/)
  assert.equal(pkg.dependencies.jsonwebtoken, undefined)
})
