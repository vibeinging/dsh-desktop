// electron-builder 的 PublishManager 只在 dmg/zip target 的 afterPack 里写
// Resources/app-update.yml；macOS 发布流水线的第一阶段是 `--dir` 构建（没有
// dmg/zip target，钩子直接跳过），第二阶段 `--prepackaged` 不再执行任何 pack
// 钩子，因此安装包内永远缺少该文件，electron-updater 的 downloadUpdate()
// 一执行就 ENOENT。本钩子在 afterPack（代码签名之前）补齐缺失的配置；
// 官方机制已写入时不覆盖。Windows 完整构建由 PublishManager 覆盖，此处不处理。
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { buildAppUpdateConfigYaml } = require('../app-update-config.js');

const DEFAULT_UPDATE_API_BASE_URL = 'https://dshdesktopstation.com';

// electron-builder 传给 afterPack 的 arch 是 builder-util-runtime 的 Arch 枚举数字。
const ARCH_NAMES = new Map([[1, 'ia32'], [2, 'x64'], [3, 'arm64'], [4, 'universal']]);

function archName(arch) {
  if (typeof arch === 'number') return ARCH_NAMES.get(arch) || String(arch);
  return String(arch);
}

export default async function writeAppUpdateConfig(buildResult) {
  if (buildResult.electronPlatformName !== 'darwin') return;
  const configPath = join(buildResult.packager.getResourcesDir(buildResult.appOutDir), 'app-update.yml');
  if (existsSync(configPath)) return;
  const apiBaseUrl = process.env.DSH_UPDATE_API_BASE_URL === undefined
    ? DEFAULT_UPDATE_API_BASE_URL
    : String(process.env.DSH_UPDATE_API_BASE_URL).trim();
  const channel = String(process.env.DSH_UPDATE_CHANNEL || 'stable').trim() || 'stable';
  const yaml = buildAppUpdateConfigYaml({ apiBaseUrl, channel, platform: 'darwin', arch: archName(buildResult.arch) });
  if (!yaml) return;
  await writeFile(configPath, yaml);
  console.info(`[app-update-config] wrote ${configPath}`);
}
