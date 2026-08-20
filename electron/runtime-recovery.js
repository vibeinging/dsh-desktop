const fs = require('node:fs');
const path = require('node:path');

const STATE_VERSION = 1;
const MAX_FAILURE_MESSAGE_LENGTH = 600;
const PACKAGE_NAME = /^@?[a-z0-9][a-z0-9._~-]*(?:\/[a-z0-9][a-z0-9._~-]*)?$/i;

function text(value, limit = MAX_FAILURE_MESSAGE_LENGTH) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\b(api[_-]?key|token|password|secret|authorization|cookie|credential)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/ig, (_match, key) => `${key}=[redacted]`)
    .replace(/\bBearer\s+[^\s]+/ig, 'Bearer [redacted]')
    .replace(/\b(DEEPSEEK_API_KEY|NPM_TOKEN|DSH_[A-Z0-9_]+)\s*=\s*[^\s,;]+/g, (_match, key) => `${key}=[redacted]`)
    .trim()
    .slice(0, limit);
}

function statePath(userDataPath) {
  return path.join(userDataPath, 'runtime-recovery.json');
}

function emptyState() {
  return {
    schema_version: STATE_VERSION,
    status: 'none',
    attempts: 0,
    last_failure: null,
    last_result: null,
  };
}

function loadRecoveryState(userDataPath, fsImpl = fs) {
  try {
    const value = JSON.parse(fsImpl.readFileSync(statePath(userDataPath), 'utf8'));
    if (!value || value.schema_version !== STATE_VERSION) return emptyState();
    return {
      ...emptyState(),
      ...value,
      attempts: Number.isSafeInteger(value.attempts) && value.attempts >= 0 ? value.attempts : 0,
    };
  } catch {
    return emptyState();
  }
}

function saveRecoveryState(userDataPath, value, fsImpl = fs) {
  const target = statePath(userDataPath);
  const temporary = `${target}.${process.pid}.tmp`;
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { fsImpl.chmodSync(temporary, 0o600); } catch { /* Windows has no POSIX mode bits. */ }
  fsImpl.renameSync(temporary, target);
  return value;
}

function failureView({ stage, error, profilePath = null, at = new Date().toISOString() }) {
  return {
    stage: text(stage, 80) || 'unknown',
    code: text(error?.code, 120) || 'DSH_STARTUP_FAILED',
    message: text(error?.message || error, MAX_FAILURE_MESSAGE_LENGTH) || '本地服务启动失败',
    profile_path: profilePath ? text(profilePath, 400) : null,
    at,
  };
}

function recordRecoveryFailure({ userDataPath, stage, error, profilePath = null, fsImpl = fs }) {
  const previous = loadRecoveryState(userDataPath, fsImpl);
  const failure = failureView({ stage, error, profilePath });
  const sameFailure = previous.last_failure
    && previous.last_failure.stage === failure.stage
    && previous.last_failure.code === failure.code;
  return saveRecoveryState(userDataPath, {
    ...previous,
    status: 'failed',
    attempts: sameFailure ? previous.attempts + 1 : 1,
    last_failure: failure,
    last_result: null,
  }, fsImpl);
}

function recordRecoveryResult({ userDataPath, action, message = null, fsImpl = fs }) {
  const previous = loadRecoveryState(userDataPath, fsImpl);
  return saveRecoveryState(userDataPath, {
    ...previous,
    status: 'resolved',
    last_result: {
      action: text(action, 80) || 'unknown',
      message: message ? text(message, MAX_FAILURE_MESSAGE_LENGTH) : null,
      at: new Date().toISOString(),
    },
  }, fsImpl);
}

function safeProfileHome(dataRoot) {
  return path.join(path.resolve(dataRoot), 'safe-profile');
}

function profilePathForHome(dshHome) {
  return path.join(path.resolve(dshHome), 'profiles', 'web');
}

function normalizePluginName(value) {
  const name = String(value || '').trim();
  return PACKAGE_NAME.test(name) ? name : null;
}

function diagnosticsPayload({ state, appVersion, platform, arch, backendState, runtimeHome }) {
  return {
    schema_version: STATE_VERSION,
    generated_at: new Date().toISOString(),
    product: 'DSH Desktop',
    app_version: text(appVersion, 80) || null,
    platform: text(platform, 40) || null,
    arch: text(arch, 40) || null,
    backend_state: text(backendState, 40) || null,
    runtime_home_name: runtimeHome ? path.basename(path.resolve(runtimeHome)) : null,
    recovery: {
      status: state?.status || 'none',
      attempts: state?.attempts || 0,
      last_failure: state?.last_failure || null,
      last_result: state?.last_result || null,
    },
    omitted: ['环境变量', '凭据', 'Session 内容', '用户文件内容', '完整堆栈'],
  };
}

function writeDiagnostics({ userDataPath, payload, fsImpl = fs }) {
  const directory = path.join(userDataPath, 'diagnostics');
  fsImpl.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `runtime-${Date.now()}.json`);
  fsImpl.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try { fsImpl.chmodSync(file, 0o600); } catch { /* Windows has no POSIX mode bits. */ }
  return file;
}

module.exports = {
  diagnosticsPayload,
  failureView,
  loadRecoveryState,
  normalizePluginName,
  profilePathForHome,
  recordRecoveryFailure,
  recordRecoveryResult,
  safeProfileHome,
  saveRecoveryState,
  statePath,
  writeDiagnostics,
};
