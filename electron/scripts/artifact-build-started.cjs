const path = require('node:path');
const { copyDshRuntime } = require('./after-pack.cjs');

const DEFAULT_SOURCE = path.resolve(__dirname, '../../.desktop-build/server/runtime/dsh');

/** Restore the pinned DSH CLI immediately before Electron Builder archives NSIS input. */
async function restoreDshRuntimeBeforeArtifact(event, options = {}) {
  const targetName = String(event.targetPresentableName || '').toLowerCase();
  if (!targetName.includes('nsis')) return;
  if (!event.file) {
    throw new Error('Windows NSIS 产物缺少输出路径');
  }
  const source = options.source || DEFAULT_SOURCE;
  const target = options.target || path.join(
    path.dirname(event.file),
    'win-unpacked',
    'resources',
    'server',
    'runtime',
    'dsh',
  );
  await copyDshRuntime(source, target);
}

module.exports = restoreDshRuntimeBeforeArtifact;
module.exports.restoreDshRuntimeBeforeArtifact = restoreDshRuntimeBeforeArtifact;
