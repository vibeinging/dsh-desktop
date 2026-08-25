#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PLATFORM_CONTRACTS = Object.freeze({
  macos: Object.freeze({ metadata: 'latest-mac.yml', extension: '.zip' }),
  windows: Object.freeze({ metadata: 'latest.yml', extension: '.exe' }),
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
  if (!existsSync(`${artifactPath}.blockmap`)) {
    errors.push(`缺少差分更新文件：release/${artifactName}.blockmap`);
  }
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
