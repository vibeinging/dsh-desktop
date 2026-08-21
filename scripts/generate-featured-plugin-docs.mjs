import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const START_MARKER = "<!-- featured-plugins:start -->"
const END_MARKER = "<!-- featured-plugins:end -->"

function sourceLink(plugin, language) {
  const label = language === "zh" ? "本地包" : "local package"
  return `[${label}](${plugin.package_path})`
}

function permissions(plugin, language) {
  if (plugin.permissions.length > 0) return plugin.permissions.join(language === "zh" ? "、" : ", ")
  return language === "zh" ? "无 Host 权限" : "no Host permission"
}

function renderTable(manifest, language) {
  const rows = manifest.plugins.map((plugin) => [
    `\`${plugin.name}\``,
    plugin.portability,
    permissions(plugin, language),
    plugin.user_manageable
      ? `\`dsh plugin --profile ${manifest.profile} remove ${plugin.name}\``
      : language === "zh" ? "桌面基础服务，不提供卸载" : "desktop foundation; uninstall is not offered",
    sourceLink(plugin, language),
  ])
  const headers = language === "zh"
    ? ["默认 Bundle", "类型", "声明权限", "官方管理方式", "来源"]
    : ["Default Bundle", "Type", "Declared permissions", "Official management", "Source"]
  const lines = [
    START_MARKER,
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    END_MARKER,
  ]
  return lines.join("\n")
}

async function replaceGeneratedSection(path, section) {
  const text = await readFile(path, "utf8")
  const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`)
  if (!pattern.test(text)) throw new Error(`缺少精选插件文档标记: ${path}`)
  await writeFile(path, text.replace(pattern, section))
}

/**
 * Generate the bilingual public tables from the authoritative curated manifest.
 *
 * @param {{appRoot?: string}} options
 * @returns {Promise<string[]>} Names written to the generated tables.
 */
export async function generateFeaturedPluginDocs({ appRoot = SCRIPT_ROOT } = {}) {
  const root = resolve(appRoot)
  const manifest = JSON.parse(await readFile(join(root, "server", "src", "engine", "dsh_runtime", "featured_plugins.json"), "utf8"))
  const docs = [
    [join(root, "README.md"), renderTable(manifest, "zh")],
    [join(root, "README.en.md"), renderTable(manifest, "en")],
  ]
  for (const [path, section] of docs) await replaceGeneratedSection(path, section)
  return manifest.plugins.map((plugin) => plugin.name)
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const names = await generateFeaturedPluginDocs()
  console.log(`[docs] 精选插件明细已同步: ${names.length} 个`)
}
