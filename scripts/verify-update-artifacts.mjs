#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLATFORM_CONTRACTS = Object.freeze({
  macos: Object.freeze({ metadata: 'latest-mac.yml', extension: '.zip' }),
  windows: Object.freeze({ metadata: 'latest.yml', extension: '.exe' }),
  linux: Object.freeze({ metadata: 'latest-linux.yml', extension: '.AppImage' }),
});

function yamlScalar(text, key) {
  const match = String(text).match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return '';
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function sha512Base64(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64');
}

/** Locate the packaged app directory the update archive was built from. */
function packagedAppRoots(releaseRoot, platform) {
  if (platform === 'macos') {
    return [join(releaseRoot, 'mac-arm64', 'DSH Desktop.app'), join(releaseRoot, 'mac', 'DSH Desktop.app')];
  }
  if (platform === 'linux') return [join(releaseRoot, 'linux-unpacked')];
  return [join(releaseRoot, 'win-unpacked')];
}

/** Read CFBundleShortVersionString from an XML Info.plist without a plist parser. */
function macAppBundleVersion(appDir) {
  try {
    const plist = readFileSync(join(appDir, 'Contents', 'Info.plist'), 'utf8');
    const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * electron-updater 的 downloadUpdate() 运行时读取安装包内 app-update.yml；
 * 缺失则更新按钮永远停在下载失败（v0.2.4 及之前的 macOS 包即此问题）。
 * 这里保证打进 zip/exe 的应用目录真的带有该文件。
 * release 目录里可能残留其它架构或旧版本的 app 目录（例如上一次 x64 构建
 * 留下的 release/mac），只有版本与本次一致的目录才代表当前产物，才需要校验。
 */
function inspectPackagedUpdaterConfig(releaseRoot, platform, projectVersion) {
  const roots = packagedAppRoots(releaseRoot, platform)
    .filter(existsSync)
    .filter((root) => platform !== 'macos' || macAppBundleVersion(root) === String(projectVersion || ''));
  if (roots.length === 0) {
    return [`缺少与版本 ${projectVersion || '?'} 对应的已打包应用目录，无法确认 app-update.yml 已随包分发`];
  }
  const errors = [];
  for (const root of roots) {
    const configPath = platform === 'macos'
      ? join(root, 'Contents', 'Resources', 'app-update.yml')
      : join(root, 'resources', 'app-update.yml');
    if (!existsSync(configPath)) {
      errors.push(`安装包缺少 ${platform === 'macos' ? 'Contents/Resources/' : 'resources/'}app-update.yml：${root}`);
      continue;
    }
    const content = readFileSync(configPath, 'utf8');
    if (!/^provider:\s*\S+/m.test(content)) {
      errors.push(`app-update.yml 缺少 provider 配置：${configPath}`);
    }
  }
  return errors;
}

/** Validate electron-builder metadata and the exact downloadable artifact it names. */
export function inspectUpdateArtifacts(root = DEFAULT_ROOT, platform) {
  const contract = PLATFORM_CONTRACTS[platform];
  if (!contract) return [`未知更新产物平台：${platform}`];
  const appRoot = resolve(root);
  const releaseRoot = join(appRoot, 'release');
  const metadataPath = join(releaseRoot, contract.metadata);
  if (!existsSync(metadataPath)) return [`缺少更新元数据：release/${contract.metadata}`];

  const errors = [];
  const project = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  const metadata = readFileSync(metadataPath, 'utf8');
  const version = yamlScalar(metadata, 'version');
  const artifactName = yamlScalar(metadata, 'path');
  const expectedSha512 = yamlScalar(metadata, 'sha512');

  if (version !== String(project.version || '')) {
    errors.push(`更新元数据版本 ${version || '缺失'} 与应用版本 ${project.version || '缺失'} 不一致`);
  }
  if (!artifactName || basename(artifactName) !== artifactName || !artifactName.endsWith(contract.extension)) {
    errors.push(`更新元数据 path 必须是 release 目录内的 ${contract.extension} 文件`);
    return errors;
  }
  const artifactPath = join(dirname(metadataPath), artifactName);
  if (!existsSync(artifactPath)) {
    errors.push(`更新元数据引用的产物不存在：release/${artifactName}`);
    return errors;
  }
  if (!expectedSha512 || expectedSha512 !== sha512Base64(artifactPath)) {
    errors.push(`更新元数据 SHA-512 与产物不一致：release/${artifactName}`);
  }
  // AppImage 的差分数据内嵌在文件尾部（AppImageUpdater 走
  // FileWithEmbeddedBlockMapDifferentialDownloader），没有也不需要外部 blockmap；
  // macOS zip 与 Windows NSIS 仍要求外部 .blockmap。
  if (platform !== 'linux' && !existsSync(`${artifactPath}.blockmap`)) {
    errors.push(`缺少差分更新文件：release/${artifactName}.blockmap`);
  }
  errors.push(...inspectPackagedUpdaterConfig(releaseRoot, platform, project.version));
  return errors;
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const platform = argument('platform');
  const root = resolve(argument('root', DEFAULT_ROOT));
  const errors = inspectUpdateArtifacts(root, platform);
  if (errors.length > 0) {
    for (const error of errors) console.error(`[update-artifacts] ${error}`);
    process.exitCode = 1;
  } else {
    console.info(`[update-artifacts] ${platform} PASS`);
  }
}
