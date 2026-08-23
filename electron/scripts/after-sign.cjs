const copyPackagedDshRuntime = require('./after-pack.cjs');

/** Restore the official DSH CLI after Windows resource editing and before NSIS packaging. */
async function restoreWindowsDshRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;
  await copyPackagedDshRuntime(context);
}

module.exports = restoreWindowsDshRuntime;
module.exports.restoreWindowsDshRuntime = restoreWindowsDshRuntime;
