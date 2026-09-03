/** Closed desktop-update commands; Electron remains the installation authority. */

const UPDATE_METHODS = new Set(['state', 'check', 'install']);

/** Execute one update command without accepting paths, URLs, or installer arguments. */
function handleAppUpdateRequest(controller, method, payload = {}) {
  if (!UPDATE_METHODS.has(method) || !payload || typeof payload !== 'object'
    || Array.isArray(payload) || Object.keys(payload).some((key) => method !== 'install' || key !== 'version')) {
    throw new Error('更新请求无效');
  }
  if (!controller) throw new Error('更新服务尚未就绪');
  if (method === 'state') return controller.getState();
  if (method === 'check') {
    void controller.check();
    return controller.getState();
  }
  const state = controller.getState();
  if (typeof payload.version !== 'string' || payload.version !== state.latest?.version
    || state.status !== 'available' || state.latest?.update_available !== true) {
    throw new Error('可用版本已变化，请重新检查更新');
  }
  // Acknowledge before the eventual shutdown closes the caller's transport.
  void controller.downloadAndInstall();
  return controller.getState();
}

module.exports = { handleAppUpdateRequest };
