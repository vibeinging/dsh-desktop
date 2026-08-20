import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

import { resolvePackagedLayout } from "../electron/scripts/packaged-layout.mjs"

const ROOT = resolve(import.meta.dirname, "..")
const appInput = process.argv[2] || join(ROOT, "release", "mac-arm64", "DSH Desktop.app")
const budgetPath = join(ROOT, "scripts", "release-budgets.json")
const budgets = JSON.parse(await readFile(budgetPath, "utf8"))
const target = "macos-arm64"
const budget = budgets[target]
if (!budget) throw new Error(`没有 ${target} 的发行预算`)

async function directoryBytes(path) {
  if (!existsSync(path)) throw new Error(`预算输入不存在: ${path}`)
  const info = await lstat(path)
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(path)) bytes += await directoryBytes(join(path, name))
  return bytes
}

async function fileBytes(path) {
  if (!existsSync(path)) throw new Error(`预算输入不存在: ${path}`)
  return (await lstat(path)).size
}

function assertBudget(name, actual, maximum) {
  if (!Number.isFinite(actual) || actual > maximum) {
    throw new Error(`[budget] ${name} 超出预算: actual=${actual} maximum=${maximum}`)
  }
  return `${name}=${actual}/${maximum}`
}

const layout = resolvePackagedLayout(appInput)
const appPath = layout.appPath || resolve(appInput)
const resourcesDir = layout.resourcesDir
const artifactDir = join(resourcesDir, "featured-plugins")
const tarballs = (await readdir(artifactDir)).filter((name) => name.endsWith(".tgz"))
const staticMeasurements = {
  app_bytes: await directoryBytes(appPath),
  server_bytes: await directoryBytes(join(resourcesDir, "server")),
  pnpm_runtime_bytes: await directoryBytes(join(resourcesDir, "pnpm-runtime")),
  featured_tarballs_bytes: 0,
}
for (const name of tarballs) staticMeasurements.featured_tarballs_bytes += await fileBytes(join(artifactDir, name))

const resultDir = await mkdtemp(join(tmpdir(), "dsh-release-budget-"))
const resultPath = join(resultDir, "offline-smoke.json")
try {
  const env = { ...process.env, DSH_SMOKE_RESULT_FILE: resultPath }
  for (const key of ["DEEPSEEK_API_KEY", "ELECTRON_RUN_AS_NODE", "DB_SQLITE_PATH", "INTERMEDIATE_DIR", "DSH_AGENT_SESSION_DIR", "DSH_YITRACE_DIR"]) {
    delete env[key]
  }
  const smoke = spawnSync(process.execPath, [
    join(ROOT, "electron", "scripts", "smoke-packaged-offline.mjs"),
    appPath,
  ], { cwd: ROOT, env, encoding: "utf8", stdio: "inherit" })
  if (smoke.status !== 0) throw new Error(`断网预算 smoke 失败: code=${smoke.status} signal=${smoke.signal || "none"}`)
  const runtime = JSON.parse(await readFile(resultPath, "utf8"))
  const measurements = { ...staticMeasurements, ...runtime }
  const checks = Object.entries(budget).map(([name, maximum]) => assertBudget(name, measurements[name], maximum))
  console.log(`[budget] PASS ${target}; ${checks.join("; ")}`)
} finally {
  await rm(resultDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
