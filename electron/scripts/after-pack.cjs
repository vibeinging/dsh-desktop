const { cp, mkdir, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');

/** Copy and verify the pinned official DSH CLI at an Electron artifact boundary. */
async function copyDshRuntime(source, target) {
  const sourceManifest = path.join(source, 'package.json');
  const sourceEntry = path.join(source, 'lib', 'bin.js');
  if (!existsSync(sourceManifest) || !existsSync(sourceEntry)) {
    throw new Error(`官方 DSH CLI 稳定运行时不完整: ${source}`);
  }
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  if (!existsSync(path.join(target, 'package.json')) || !existsSync(path.join(target, 'lib', 'bin.js'))) {
    throw new Error(`官方 DSH CLI 未进入 Electron 产物: ${target}`);
  }
  console.log(`[package] 官方 DSH CLI 已固定到 Electron 产物: ${target}`);
}

/** Copy the pinned official DSH CLI after Electron Builder finishes resource filtering. */
async function copyPackagedDshRuntime(context) {
  const source = path.resolve(context.packager.projectDir, '../.desktop-build/server/runtime/dsh');
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const target = path.join(resources, 'server', 'runtime', 'dsh');
  await copyDshRuntime(source, target);
}

module.exports = copyPackagedDshRuntime;
module.exports.copyDshRuntime = copyDshRuntime;
module.exports.copyPackagedDshRuntime = copyPackagedDshRuntime;
