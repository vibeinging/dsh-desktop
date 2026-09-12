// DSH App — Electron main process.
//
// Responsibilities:
// 1. Create main window (size/background/custom title bar);
// 2. Start local Node backend (app/server); stop it when the app exits;
// 3. Keep native capabilities in the trusted main process; the official Web
//    surface never receives a product preload bridge;
// 4. Load the loopback surface published by the official DSH Web Profile.
//
// Backend process model: dev uses system node; prod runs local backend in Electron's Node mode.

const {
  app,
  BrowserWindow,
  WebContentsView,
  View,
  dialog,
  screen,
  shell,
  nativeImage,
  nativeTheme,
  Menu,
  net,
  session,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { normalizeWebSearchSettings, applyWebSearchEnv } = require('./web-search-settings');
const { normalizeProxyUrl } = require('./network-proxy-settings');
const { AppUpdateController } = require('./app-update-controller');
const { handleAppUpdateRequest } = require('./app-update-requests');
const { AppUpdateView } = require('./app-update-view');
const { loadOrCreateRendererSurfacePort } = require('./renderer-surface-port');
const { BROWSER_PARTITION, BrowserWorkspaceController } = require('./browser-workspace');
const {
  diagnosticsPayload,
  loadRecoveryState,
  normalizePluginName,
  profilePathForHome,
  recordRecoveryFailure,
  recordRecoveryResult,
  safeProfileHome,
  writeDiagnostics,
} = require('./runtime-recovery');

function ignoreClosedDiagnosticStream(stream) {
  stream?.on?.('error', (error) => {
    if (error?.code !== 'EPIPE') process.nextTick(() => { throw error; });
  });
}

ignoreClosedDiagnosticStream(process.stdout);
ignoreClosedDiagnosticStream(process.stderr);

const isDev = !app.isPackaged;
const APP_ROOT = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const SERVER_DIR = path.join(APP_ROOT, 'server');
const FEATURED_PLUGIN_ARTIFACT_DIR = isDev
  ? path.join(APP_ROOT, '.desktop-build', 'featured-plugins')
  : path.join(APP_ROOT, 'featured-plugins');
const PNPM_BIN_DIR = isDev
  ? path.join(APP_ROOT, '.desktop-build', 'pnpm-bin')
  : path.join(APP_ROOT, 'pnpm-bin');
const APP_ICON = path.join(__dirname, 'icons', 'icon.png'); // application icon
const APP_DISPLAY_NAME = 'DSH Desktop';
const USER_DATA_DIR_NAME = 'dsh-electron';
const DATA_ROOT = process.env.DSH_DATA_ROOT
  ? path.resolve(process.env.DSH_DATA_ROOT)
  : path.join(os.homedir(), '.dsh');
const DEFAULT_NO_PROXY = ['localhost', '127.0.0.1', '::1'];
const BACKEND_START_TIMEOUT_MS = Number(process.env.DSH_BACKEND_START_TIMEOUT_MS || 30_000);
const API_REQUEST_TIMEOUT_MS = Number(process.env.DSH_API_REQUEST_TIMEOUT_MS || 300_000);
const BACKEND_STOP_TIMEOUT_MS = Number(process.env.DSH_BACKEND_STOP_TIMEOUT_MS || 8_000);
const OFFICIAL_WEB_READY_TIMEOUT_MS = Number(process.env.DSH_OFFICIAL_WEB_READY_TIMEOUT_MS || 60_000);
const SMOKE_TEST = process.env.DSH_SMOKE_TEST === '1';
const SMOKE_UPDATE = process.env.DSH_SMOKE_UPDATE === '1';
const SMOKE_EXPECT_SELECTOR = String(process.env.DSH_SMOKE_EXPECT_SELECTOR || '').trim();
const SMOKE_REJECT_SELECTOR = String(process.env.DSH_SMOKE_REJECT_SELECTOR || '').trim();
const SMOKE_EXPECT_POST_JSON_OK = parseSmokePostJsonPath(process.env.DSH_SMOKE_EXPECT_POST_JSON_OK);
const SMOKE_CLICK_SELECTORS = parseSmokeClickSelectors(process.env.DSH_SMOKE_CLICK_SELECTORS);
const SMOKE_SCREENSHOT_DIR = String(process.env.DSH_SMOKE_SCREENSHOT_DIR || '').trim();
const SMOKE_SCREENSHOT_NAME = /^[A-Za-z0-9._-]+$/.test(String(process.env.DSH_SMOKE_SCREENSHOT_NAME || '').trim())
  ? String(process.env.DSH_SMOKE_SCREENSHOT_NAME).trim()
  : 'dsh-smoke.png';
const SMOKE_DISMISS_ONBOARDING = process.env.DSH_SMOKE_DISMISS_ONBOARDING === '1';
const SMOKE_WORKSPACE_PATH = String(process.env.DSH_SMOKE_WORKSPACE_PATH || '').trim();
const SMOKE_SMART_ATTACHMENT_PICKER = process.env.DSH_SMOKE_SMART_ATTACHMENT_PICKER === '1';
const UPDATE_API_BASE_URL = String(process.env.DSH_UPDATE_API_BASE_URL === undefined
  ? 'https://dshdesktopstation.com'
  : process.env.DSH_UPDATE_API_BASE_URL).trim();
const UPDATE_REPOSITORY = Object.freeze({ owner: 'vibeinging', repo: 'dsh-desktop' });
const RECOVERY_PAGE = path.join(__dirname, 'recovery.html');

function parseSmokeClickSelectors(raw) {
  const source = String(raw || '').trim();
  if (!source) return [];
  const parsed = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.some((selector) => typeof selector !== 'string' || !selector.trim())) {
    throw new Error('DSH_SMOKE_CLICK_SELECTORS 必须是非空 CSS selector 字符串数组');
  }
  return parsed.map((selector) => selector.trim());
}

function parseSmokePostJsonPath(raw) {
  const path = String(raw || '').trim();
  if (!path) return '';
  if (!/^\/[A-Za-z0-9./-]+$/.test(path)) {
    throw new Error('DSH_SMOKE_EXPECT_POST_JSON_OK 必须是站内绝对路径');
  }
  return path;
}

async function captureSmokeScreenshot(name = SMOKE_SCREENSHOT_NAME) {
  if (!SMOKE_SCREENSHOT_DIR || !mainWindow || mainWindow.isDestroyed()) return null;
  const targetDir = path.resolve(SMOKE_SCREENSHOT_DIR);
  const targetPath = path.join(targetDir, name);
  fs.mkdirSync(targetDir, { recursive: true });
  const debuggerAgent = mainWindow.webContents.debugger;
  let attached = false;
  try {
    if (!debuggerAgent.isAttached()) {
      debuggerAgent.attach('1.3');
      attached = true;
    }
    const result = await debuggerAgent.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const png = Buffer.from(String(result?.data || ''), 'base64');
    if (!png.length) throw new Error('DevTools 截图为空');
    fs.writeFileSync(targetPath, png);
  } finally {
    if (attached) {
      try { debuggerAgent.detach(); } catch { /* screenshot success owns the result */ }
    }
  }
  console.log(`[smoke] screenshot=${targetPath}`);
  return targetPath;
}

async function smokeOnboardingState(win) {
  if (!SMOKE_DISMISS_ONBOARDING || !win || win.isDestroyed()) return { visible: false, dismissed: false };
  return win.webContents.executeJavaScript(`(() => {
    const body = document.body?.innerText || '';
    const visible = body.includes('内测声明') || body.includes('Internal testing')
      || body.includes('添加一个 API Key 开始使用') || body.includes('Add an API Key to get started');
    if (!visible) return { visible: false, dismissed: false };
    const labels = new Set(['继续', 'Continue', '稍后配置', 'Later']);
    const button = [...document.querySelectorAll('button,[role="button"]')]
      .find((element) => labels.has((element.innerText || element.textContent || '').trim()));
    if (!button) return { visible: true, dismissed: false };
    button.click();
    return { visible: true, dismissed: true };
  })()`);
}

async function smokeSmartAttachmentPicker(win) {
  if (!SMOKE_SMART_ATTACHMENT_PICKER || !win || win.isDestroyed()) return false;
  // 0.1.5 的 conversation.input.left 槽位不再注入 input 状态；发行适配以可选链守卫
  // 保证槽位条目渲染。Electron 级验证收敛到"附件按钮存在且可用"；更深的
  // 智能选择器菜单流由 eval 单测的发行适配断言覆盖。
  return win.webContents.executeJavaScript(`(() => {
    const attach = document.querySelector('.dshca-button[aria-label="Attach files or a folder"]');
    if (!attach) throw new Error('找不到附件菜单按钮');
    if (attach.disabled === true || attach.getAttribute('aria-disabled') === 'true') {
      throw new Error('附件菜单按钮被禁用');
    }
    return true;
  })()`);
}

async function applyRendererNetworkProxy(settings = loadNetworkSettings()) {
  const proxyUrl = normalizeProxyUrl(settings.httpProxy);
  const sessions = [session.defaultSession];
  await Promise.all(sessions.map(async (targetSession) => {
    try {
      if (!proxyUrl) {
        await targetSession.setProxy({ mode: 'direct' });
        return;
      }
      await targetSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: `http=${proxyUrl};https=${proxyUrl}`,
        proxyBypassRules: mergedNoProxy(settings.noProxy),
      });
    } catch (e) {
      console.warn('[electron] 应用渲染层代理失败:', e?.message || e);
    }
  }));
}

function configureProductionSecurityHeaders() {
  if (isDev) return;
  const policy = [
    "default-src 'self' data: blob:",
    // DSH modules injects the reviewed window.__DSH_BOOT__ graph as one inline
    // script into the App-owned index. Plugin code itself remains same-origin.
    // unsafe-eval: the DSH web client evaluates Cordis config __jsExpr via
    // new Function at module top level; without it the whole bundle fails.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
    "font-src 'self' data:",
    "connect-src 'self' https: http: wss: ws:",
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob: https: http:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function configureApplicationIdentity() {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: runtimeAppName,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      iconPath: APP_ICON,
    });
  }
}

function configureApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const closeBehavior = loadCloseBehavior();
  const setCloseBehavior = (behavior) => {
    saveCloseBehavior(behavior);
    configureApplicationMenu();
  };

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          label: '检查更新…',
          accelerator: 'CommandOrControl+Shift+U',
          enabled: app.isPackaged,
          click: () => { void checkForAppUpdatesManually(); },
        },
        {
          id: 'dsh-install-update',
          label: '下载并安装更新…',
          enabled: appUpdateController?.getState().status === 'available',
          click: () => {
            const controller = initializeAppUpdater();
            if (controller?.getState().status === 'available') {
              handleAppUpdateRequest(controller, 'install', { version: controller.getState().latest?.version });
            }
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: '关闭按钮行为',
          submenu: [
            {
              label: '每次询问',
              type: 'radio',
              checked: closeBehavior === 'ask',
              click: () => setCloseBehavior('ask'),
            },
            {
              label: '最小化',
              type: 'radio',
              checked: closeBehavior === 'minimize',
              click: () => setCloseBehavior('minimize'),
            },
            {
              label: '关闭应用',
              type: 'radio',
              checked: closeBehavior === 'quit',
              click: () => setCloseBehavior('quit'),
            },
          ],
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: isDev
        ? [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ]
        : [{ role: 'togglefullscreen' }],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Backend lifecycle ──
function startBackend() {
  if (backendState === 'ready') return Promise.resolve();
  if (backendState === 'starting' && backendReadyPromise) return backendReadyPromise;

  const entryRel = path.join('src', 'index.js');
  const entryAbs = path.join(SERVER_DIR, entryRel);
  if (!fs.existsSync(entryAbs)) return Promise.reject(new Error(`Server 入口不存在: ${entryAbs}`));
  // dev: system node; prod: Electron runs backend in Node mode (self-contained, requires electron-rebuild for native modules)
  const cmd = isDev ? (process.env.DSH_NODE_BIN || 'node') : process.execPath;
  const args = isDev ? [entryRel] : [entryAbs];
  const env = { ...process.env };
  env.DSH_DATA_ROOT = DATA_ROOT;
  env.DSH_APP_ROOT = APP_ROOT;
  env.DSH_RUNTIME_HOME = runtimeHomeOverride;
  env.DSH_DESKTOP_PROFILE_NAME = 'web';
  env.DSH_PROFILE_PLUGIN_LIBRARY = path.join(runtimeHomeOverride, 'plugin-library');
  env.DSH_FEATURED_PLUGIN_TARBALL_DIR = FEATURED_PLUGIN_ARTIFACT_DIR;
  env.DSH_FEATURED_PLUGIN_MANIFEST = path.join(FEATURED_PLUGIN_ARTIFACT_DIR, 'manifest.json');
  env.DSH_PNPM_BIN_DIR = PNPM_BIN_DIR;
  if (!isDev) env.DSH_PNPM_REQUIRED = '1';
  env.DSH_APP_VERSION = app.getVersion();
  env.DSH_APP_NAME = runtimeAppName; // 构建身份只用于 DSH 运行时标识，不接受用户输入
  env.DSH_RUNTIME_DISTRIBUTION = process.env.DSH_RUNTIME_DISTRIBUTION || 'npm';
  if (!isDev) env.DSH_NPM_PACKAGE_ROOT = path.join(SERVER_DIR, 'node_modules', '@deepseek-ai', 'dsh');
  env.DSH_DESKTOP_WEB_PORT = String(rendererSurfacePort);
  if (profileInitializationMode === 'safe') env.DSH_PROFILE_INITIALIZATION_MODE = 'safe';
  else delete env.DSH_PROFILE_INITIALIZATION_MODE;
  if (isDev) {
    env.DSH_SOURCE_ROOT = process.env.DSH_SOURCE_ROOT || path.resolve(APP_ROOT, '..', 'test-vibeinging');
    env.DSH_FEATURED_PLUGIN_SOURCE_ROOT = APP_ROOT;
    env.DSH_FEATURED_PLUGIN_ALLOW_SOURCE = '1';
  }
  applyNetworkEnv(env);
  if (isDev) env.DSH_TCP = '1'; // dev: backend also listens on TCP so eval can reuse running instance; prod: process channel only (portless)
  if (!isDev) env.ELECTRON_RUN_AS_NODE = '1';

  backendState = 'starting';
  backendReadyPromise = new Promise((resolve, reject) => {
    backendReadyResolve = resolve;
    backendReadyReject = reject;
  });
  backendReadyTimer = setTimeout(() => {
    const error = new Error(`本地 Server 启动超时(${BACKEND_START_TIMEOUT_MS}ms)`);
    backendReadyReject?.(error);
    backendReadyResolve = null;
    backendReadyReject = null;
    backendState = 'failed';
    forceKillBackend(backendProc);
  }, BACKEND_START_TIMEOUT_MS);

  try {
    // stdio fd 4 uses 'ipc' to build process message channel (process.send/on('message')), no socket or port transport
    const child = spawn(cmd, args, { cwd: SERVER_DIR, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    backendProc = child;
    child.on('error', (error) => {
      console.error('[electron] Server 启动失败:', error?.message || error);
      if (backendState === 'starting') backendReadyReject?.(error);
      rejectPending(error);
    });
    child.on('exit', (code, signal) => {
      if (backendProc !== child) {
        console.log(`[electron] 旧 Server 进程已退出 code=${code} signal=${signal}`);
        return;
      }
      const wasReady = backendState === 'ready';
      backendProc = null;
      clearTimeout(backendReadyTimer);
      backendReadyTimer = null;
      if (backendState === 'starting') {
        backendReadyReject?.(new Error(`本地 Server 提前退出(code=${code}, signal=${signal || 'none'})`));
      }
      backendReadyResolve = null;
      backendReadyReject = null;
      backendReadyPromise = null;
      backendState = isQuitting ? 'stopped' : 'failed';
      rejectPending(new Error('本地 Server 已退出'));
      backendShutdownResolve?.();
      backendShutdownResolve = null;
      notifyBackendState({ state: backendState, code, signal });
      console.log(`[electron] Server 退出 code=${code} signal=${signal}`);
      if (wasReady && !isQuitting) scheduleBackendRestart();
    });
    child.on('message', (message) => {
      if (message?.type === 'desktop-native-request') {
        void handleDesktopNativeRequest(child, message);
        return;
      }
      if (message?.type === 'desktop-native-cancel') {
        cancelDesktopNativeRequest(message);
        return;
      }
      if (message?.type === 'lifecycle') {
        if (message.event === 'ready') {
          clearTimeout(backendReadyTimer);
          backendReadyTimer = null;
          backendState = 'ready';
          backendReadyResolve?.();
          backendReadyResolve = null;
          backendReadyReject = null;
          clearTimeout(backendStableTimer);
          backendStableTimer = setTimeout(() => { backendRestartAttempts = 0; }, 60_000);
          backendStableTimer.unref?.();
          notifyBackendState({ state: 'ready', detail: message });
        } else if (message.event === 'startup-error') {
          backendReadyReject?.(new Error(message.error || '本地 Server 启动失败'));
        } else if (message.event === 'shutdown-complete') {
          // Resource cleanup is acknowledged before the child actually exits.
          // Keep waiting for the exit event so the app cannot tear down first.
          console.log('[electron] Server 资源关闭完成，等待进程退出');
        }
        return;
      }
      if (message && message.id != null) pending.get(message.id)?.handle(message);
    });
    console.log(`[electron] Server 进程已创建 (${cmd} ${args.join(' ')}, pid=${child.pid})`);
  } catch (e) {
    clearTimeout(backendReadyTimer);
    backendReadyTimer = null;
    backendState = 'failed';
    backendReadyReject?.(e);
    backendReadyResolve = null;
    backendReadyReject = null;
  }
  return backendReadyPromise;
}

function notifyBackendState(payload) {
  console.info('[electron] Server 状态:', JSON.stringify(payload));
}

function rejectPending(error) {
  for (const [, entry] of pending) entry.fail(error);
  pending.clear();
}

const desktopNativeInFlight = new Map();

function sendDesktopNativeResponse(child, id, result) {
  if (!child?.connected || typeof child.send !== 'function') return;
  try { child.send({ type: 'desktop-native-response', id, result }); } catch { /* the child is already stopping */ }
}

async function handleDesktopNativeRequest(child, message) {
  const id = typeof message?.id === 'string' ? message.id.slice(0, 160) : '';
  const sessionId = typeof message?.sessionId === 'string' ? message.sessionId.trim().slice(0, 160) : '';
  const method = typeof message?.method === 'string' ? message.method : '';
  if (!id || !sessionId || !Object.hasOwn(DESKTOP_NATIVE_HANDLERS, method)) {
    sendDesktopNativeResponse(child, id, {
      ok: false,
      error: { code: 'desktop-native-rejected', message: 'Native Host 请求缺少 Session、请求 ID 或使用了未知方法' },
    });
    return;
  }
  const request = { sessionId, canceled: false };
  desktopNativeInFlight.set(id, request);
  try {
    const value = await DESKTOP_NATIVE_HANDLERS[method](message.payload || {});
    if (!request.canceled) sendDesktopNativeResponse(child, id, { ok: true, value });
  } catch (error) {
    if (!request.canceled) {
      sendDesktopNativeResponse(child, id, {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code.slice(0, 80) : 'desktop-native-failed',
          message: String(error?.message || error).replace(/\s+/g, ' ').slice(0, 500),
        },
      });
    }
  } finally {
    desktopNativeInFlight.delete(id);
  }
}

function cancelDesktopNativeRequest(message) {
  const id = typeof message?.id === 'string' ? message.id : '';
  const request = desktopNativeInFlight.get(id);
  if (!request || request.sessionId !== String(message?.sessionId || '').trim()) return false;
  request.canceled = true;
  return true;
}

function scheduleBackendRestart() {
  clearTimeout(backendStableTimer);
  backendStableTimer = null;
  if (backendRestartAttempts >= 3) {
    notifyBackendState({ state: 'failed', error: '本地服务连续恢复失败，请重启应用' });
    if (mainWindowKind !== 'recovery') {
      showRecoveryFailure('backend_restart', new Error('本地服务连续恢复失败'));
    }
    return;
  }
  const delay = 1_000 * (2 ** backendRestartAttempts);
  backendRestartAttempts += 1;
  notifyBackendState({ state: 'restarting' });
  setTimeout(() => {
    if (isQuitting || backendState === 'ready' || backendState === 'starting') return;
    startBackend().catch((error) => {
      console.error('[electron] Server 自动恢复失败:', error?.message || error);
      notifyBackendState({ state: 'failed', error: error?.message || String(error) });
    });
  }, delay).unref?.();
}

function stopBackendGracefully() {
  if (backendStopPromise) return backendStopPromise;
  const child = backendProc;
  if (!child) return Promise.resolve();
  backendState = 'stopping';
  rejectPending(new Error('应用正在退出'));
  backendStopPromise = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      backendShutdownResolve = null;
      resolve();
    };
    backendShutdownResolve = finish;
    const timer = setTimeout(() => {
      console.warn(`[electron] Server 未在 ${BACKEND_STOP_TIMEOUT_MS}ms 内关闭，强制终止`);
      forceKillBackend(child);
      finish();
    }, BACKEND_STOP_TIMEOUT_MS);
    child.once('exit', finish);
    try {
      if (!child.connected) throw new Error('IPC 已断开');
      child.send({ type: 'lifecycle', event: 'shutdown' }, (error) => {
        if (!error) return;
        forceKillBackend(child);
      });
    } catch {
      forceKillBackend(child);
    }
  });
  return backendStopPromise.finally(() => { backendStopPromise = null; });
}

function sendAppUpdateState(state = appUpdateController?.getState()) {
  if (!state) return;
  appUpdateView?.setState(state);
  console.info('[updater] 状态:', JSON.stringify({ status: state.status, version: state.latest?.version || null }));
  if (mainWindow && !mainWindow.isDestroyed()) {
    const progress = state.status === 'downloading' && Number.isFinite(state.progress?.percent)
      ? Math.max(0, Math.min(1, state.progress.percent / 100))
      : -1;
    mainWindow.setProgressBar(progress);
  }
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('dsh-install-update');
  if (menuItem) menuItem.enabled = state.status === 'available';
}

async function checkForAppUpdatesManually() {
  const controller = initializeAppUpdater();
  appUpdateView?.focus();
  return controller ? controller.check() : null;
}

function initializeAppUpdater() {
  if (appUpdateController) return appUpdateController;
  try {
    const { autoUpdater } = require('electron-updater');
    appUpdateController = new AppUpdateController({
      app,
      updater: autoUpdater,
      fetch: (url, options) => net.fetch(url, options),
    apiBaseUrl: UPDATE_API_BASE_URL,
    collectAnonymousStats: process.env.DSH_UPDATE_STATS_DISABLED !== '1',
    allowGitHubFallback: true,
      repository: UPDATE_REPOSITORY,
      platform: process.platform,
      arch: process.arch,
      channel: String(process.env.DSH_UPDATE_CHANNEL || 'stable').trim() || 'stable',
      locale: app.getLocale() || 'zh-CN',
      userDataPath: app.getPath('userData'),
      dataRoot: DATA_ROOT,
      isPackaged: app.isPackaged,
      onStateChange: sendAppUpdateState,
      prepareToInstall: async () => {
        isQuitting = true;
        await stopBackendGracefully();
        allowFinalQuit = true;
      },
      preflightInstall: async ({ toVersion }) => {
        if (backendState !== 'ready') {
          return {
            ok: false,
            code: 'DSH_PROFILE_PREFLIGHT_UNAVAILABLE',
            message: '本地 DSH Profile 预检服务尚未就绪',
          };
        }
        try {
          const response = await requestBackend({
            method: 'GET',
            url: `/api/agents/runtime/profile-preflight?target_version=${encodeURIComponent(toVersion)}`,
          }, { timeoutMs: 120_000 });
          if (response.status === 200 && response.json?.success !== false && response.json?.data?.ok === true) {
            return response.json.data;
          }
          return {
            ok: false,
            code: response.json?.error?.code || 'DSH_PROFILE_PREFLIGHT_FAILED',
            message: response.json?.message || `DSH Profile 更新预检失败（HTTP ${response.status}）`,
          };
        } catch (error) {
          return {
            ok: false,
            code: error?.code || 'DSH_PROFILE_PREFLIGHT_FAILED',
            message: error?.message || String(error),
          };
        }
      },
      onInstallBlocked: async (gate) => {
        console.warn(`[updater] Profile 预检阻止更新: ${gate.message}`);
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '更新已暂停',
          message: '当前 Profile 需要先处理，应用不会替你修改插件选择。',
          detail: `${gate.message}\n\n可选操作：更新插件后重试、稍后更新，或进入独立安全 Profile。`,
          buttons: ['更新插件后重试', '进入安全 Profile', '稍后更新'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (result.response === 0) {
          mainWindow.show();
          mainWindow.focus();
        } else if (result.response === 1) {
          await stopBackendGracefully();
          forceStopBackend();
          runtimeHomeOverride = safeProfileHome(DATA_ROOT);
          profileInitializationMode = 'safe';
          destroyMainWindowImmediately();
          await startApplicationWindow({ runtimeHome: runtimeHomeOverride, profileMode: 'safe' });
        }
      },
      recoverInstallFailure: async () => {
        allowFinalQuit = false;
        isQuitting = false;
        if (backendState !== 'ready' && backendState !== 'starting') await startBackend();
      },
      logger: console,
    });
    appUpdateController.start();
    if (SMOKE_UPDATE) {
      setTimeout(() => {
        void appUpdateController.check()
          .then((state) => {
            if (state.status !== 'available') throw new Error(`updater smoke 没有发现可用版本: ${state.status}`);
            return appUpdateController.downloadAndInstall();
          })
          .then((state) => {
            if (!['installing', 'blocked'].includes(state.status)) {
              throw new Error(`updater smoke 未进入安装阶段: ${state.status}`);
            }
            console.info(`[smoke-update] 已完成下载和 Profile 预检，等待临时 App 替换: ${state.status}`);
          })
          .catch((error) => {
            console.error('[smoke-update] 失败:', error?.message || error);
            process.exitCode = 1;
            quitApplication();
          });
      }, 250);
    }
  } catch (error) {
    console.error('[updater] 初始化失败:', error?.message || error);
  }
  return appUpdateController;
}

function forceStopBackend() {
  clearTimeout(backendReadyTimer);
  clearTimeout(backendStableTimer);
  backendReadyTimer = null;
  backendStableTimer = null;
  forceKillBackend(backendProc);
  backendProc = null;
  backendReadyPromise = null;
  backendReadyResolve = null;
  backendReadyReject = null;
  backendState = 'stopped';
  rejectPending(new Error('本地 Server 已停止'));
}

function forceKillBackend(child) {
  if (!child || child.exitCode != null) return;
  try { child.kill('SIGKILL'); } catch { /* Server may have exited between the check and kill. */ }
}

function backendSend(msg) {
  if (backendState !== 'ready' || !backendProc?.connected) return false;
  try {
    backendProc.send(msg);
    return true;
  } catch {
    return false;
  }
}

function minimizeMainWindow(win = mainWindow) {
  try {
    if (win && !win.isDestroyed() && !win.isMinimized()) win.minimize();
  } catch {
    /* ignore */
  }
}

function quitApplication() {
  isQuitting = true;
  app.quit();
}

function recoveryPluginCandidates(dshHome = DATA_ROOT) {
  try {
    const manifestPath = path.join(profilePathForHome(dshHome), 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Object.keys(manifest.dependencies || {})
      .map((name) => normalizePluginName(name))
      .filter((name) => name && name !== '@deepseek-ai/dsh-base' && name !== '@deepseek-ai/dsh-web-app');
  } catch {
    return [];
  }
}

function destroyMainWindowImmediately() {
  const previous = mainWindow;
  appUpdateView?.dispose();
  appUpdateView = null;
  mainWindow = null;
  destroyBrowserWorkspace();
  try { previous?.destroy(); } catch { /* The window may already be closing. */ }
}

function recoveryQuery(info = {}) {
  const failure = info.failure || info;
  return {
    stage: String(failure.stage || 'unknown'),
    message: String(failure.message || '本地服务启动失败'),
    profile: String(failure.profile_path || profilePathForHome(DATA_ROOT)),
    plugins: JSON.stringify(Array.isArray(info.plugins) ? info.plugins : recoveryPluginCandidates(DATA_ROOT)),
    ...(info.result ? { result: String(info.result) } : {}),
  };
}

function openRecoveryPage({ failure, result = null } = {}) {
  const state = loadRecoveryState(app.getPath('userData'));
  const currentFailure = failure || state.last_failure || {
    stage: 'unknown',
    message: '本地服务启动失败',
    profile_path: profilePathForHome(DATA_ROOT),
  };
  destroyMainWindowImmediately();
  mainWindowKind = 'recovery';
  mainWindow = new BrowserWindow({
    width: 760,
    height: 700,
    minWidth: 600,
    minHeight: 540,
    title: `${runtimeAppName}启动恢复`,
    backgroundColor: '#f6f7f9',
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const recoveryWindow = mainWindow;
  recoveryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  recoveryWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('dsh-recovery:')) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void handleRecoveryNavigation(url);
  });
  recoveryWindow.on('closed', () => {
    if (mainWindow === recoveryWindow) mainWindow = null;
  });
  recoveryWindow.loadFile(RECOVERY_PAGE, { query: recoveryQuery({ failure: currentFailure, result }) });
  if (SMOKE_TEST && process.env.DSH_SMOKE_EXPECT_RECOVERY === '1') {
    recoveryWindow.webContents.once('did-finish-load', async () => {
      try {
        const state = await recoveryWindow.webContents.executeJavaScript(`({
          heading: document.querySelector('h1')?.textContent || '',
          stage: document.querySelector('#stage')?.textContent || '',
          retry: Boolean(document.querySelector('#retry')),
          safeProfile: Boolean(document.querySelector('#safe')),
          pluginCount: document.querySelectorAll('#plugin option').length,
        })`);
        const valid = /无法启动/.test(state.heading)
          && state.retry
          && state.safeProfile
          && state.stage !== '';
        console.log(`[smoke] 恢复页已加载 stage=${state.stage} plugins=${state.pluginCount}`);
        if (!valid) process.exitCode = 1;
      } catch (error) {
        console.error('[smoke] 恢复页验证失败:', error?.message || error);
        process.exitCode = 1;
      } finally {
        setTimeout(() => {
          if (recoveryWindow && !recoveryWindow.isDestroyed()) recoveryWindow.destroy();
          quitApplication();
        }, 100);
      }
    });
  }
}

function showRecoveryFailure(stage, error) {
  const failureState = recordRecoveryFailure({
    userDataPath: app.getPath('userData'),
    stage,
    error,
    profilePath: profilePathForHome(runtimeHomeOverride),
  });
  console.error(`[recovery] ${stage}: ${failureState.last_failure.message}`);
  openRecoveryPage({ failure: failureState.last_failure });
}

function showRecoveryResult(result) {
  const state = loadRecoveryState(app.getPath('userData'));
  openRecoveryPage({ failure: state.last_failure, result });
}

function exportRecoveryDiagnostics() {
  const state = loadRecoveryState(app.getPath('userData'));
  return writeDiagnostics({
    userDataPath: app.getPath('userData'),
    payload: diagnosticsPayload({
      state,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      backendState,
      runtimeHome: runtimeHomeOverride,
    }),
  });
}

async function handleRecoveryNavigation(rawUrl) {
  if (recoveryActionInFlight) return;
  let url;
  try { url = new URL(rawUrl); } catch { return; }
  const action = String(url.hostname || url.pathname.replace(/^\//, '') || '').trim();
  recoveryActionInFlight = true;
  try {
    if (action === 'open-profile') {
      const target = profilePathForHome(DATA_ROOT);
      const message = await shell.openPath(target);
      recordRecoveryResult({
        userDataPath: app.getPath('userData'),
        action,
        message: message || `已请求打开 ${target}`,
      });
      showRecoveryResult(message || `已请求打开 ${target}`);
      return;
    }
    if (action === 'export-diagnostics') {
      const file = exportRecoveryDiagnostics();
      recordRecoveryResult({ userDataPath: app.getPath('userData'), action, message: file });
      showRecoveryResult(`诊断已写入 ${file}`);
      return;
    }
    if (action === 'remove-plugin') {
      const packageName = normalizePluginName(url.searchParams.get('plugin'));
      if (!packageName || !recoveryPluginCandidates(DATA_ROOT).includes(packageName)) {
        throw new Error('只能移除当前 Profile 中可识别的插件');
      }
      runtimeHomeOverride = DATA_ROOT;
      profileInitializationMode = 'normal';
      await startBackend();
      const response = await requestBackend({
        method: 'DELETE',
        url: `/api/agent/profile-bundles/${encodeURIComponent(packageName)}`,
      }, { timeoutMs: 120_000 });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(response.json?.message || `官方 Profile 命令失败（HTTP ${response.status}）`);
      }
      await stopBackendGracefully();
      forceStopBackend();
      recordRecoveryResult({ userDataPath: app.getPath('userData'), action, message: packageName });
      destroyMainWindowImmediately();
      await startApplicationWindow({ runtimeHome: DATA_ROOT, profileMode: 'normal' });
      return;
    }
    if (action === 'retry' || action === 'safe-profile') {
      await stopBackendGracefully();
      forceStopBackend();
      const safe = action === 'safe-profile';
      runtimeHomeOverride = safe ? safeProfileHome(DATA_ROOT) : DATA_ROOT;
      profileInitializationMode = safe ? 'safe' : 'normal';
      recordRecoveryResult({ userDataPath: app.getPath('userData'), action });
      destroyMainWindowImmediately();
      await startApplicationWindow({ runtimeHome: runtimeHomeOverride, profileMode: profileInitializationMode });
      return;
    }
  } catch (error) {
    recordRecoveryResult({
      userDataPath: app.getPath('userData'),
      action,
      message: `处理失败：${error?.message || error}`,
    });
    showRecoveryResult(`处理失败：${error?.message || error}`);
  } finally {
    recoveryActionInFlight = false;
  }
}

async function handleMainWindowCloseRequest(win = mainWindow) {
  if (!win || win.isDestroyed() || closePromptOpen) return;
  const behavior = loadCloseBehavior();
  if (behavior === 'minimize') {
    minimizeMainWindow(win);
    return;
  }
  if (behavior === 'quit') {
    quitApplication();
    return;
  }

  closePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: `关闭${runtimeAppName}？`,
      message: '要关闭应用还是最小化到后台？',
      detail: '最小化会保留本地服务和当前会话；关闭应用会停止后台进程。',
      buttons: ['最小化', '关闭应用', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: '不再询问，记住我的选择',
      checkboxChecked: false,
    });
    if (result.response === 0) {
      if (result.checkboxChecked) {
        saveCloseBehavior('minimize');
        configureApplicationMenu();
      }
      minimizeMainWindow(win);
    } else if (result.response === 1) {
      if (result.checkboxChecked) {
        saveCloseBehavior('quit');
        configureApplicationMenu();
      }
      quitApplication();
    }
  } finally {
    closePromptOpen = false;
  }
}

async function waitForOfficialWebSurface(win) {
  const deadline = Date.now() + OFFICIAL_WEB_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!win || win.isDestroyed()) throw new Error('官方 DSH Web 窗口已关闭');
    try {
      const ready = await win.webContents.executeJavaScript(
        'Boolean(document.querySelector("#root") && globalThis.__DSH_BOOT__)',
      );
      if (ready) return;
    } catch {
      // The page is still navigating; the next poll is the authoritative check.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const error = new Error(`官方 DSH Web 在 ${OFFICIAL_WEB_READY_TIMEOUT_MS}ms 内没有就绪`);
  error.code = 'DSH_CLIENT_WEB_NOT_READY';
  throw error;
}

// ── Main window (the Profile Client supplies compact chrome; native title bar is the safe fallback) ──
function createWindow(surfaceUrl = rendererSurfaceUrl) {
  if (!surfaceUrl) throw new Error('DSH Client 地址尚未就绪');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1400, Math.round(sw * 0.92));
  const height = Math.min(900, Math.round(sh * 0.92));
  const useIntegratedChrome = process.platform === 'darwin' && integratedDesktopChrome;
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#36313f',
    title: runtimeAppName,
    icon: APP_ICON, // Windows/Linux taskbar icon (on macOS icon is set by app.dock.setIcon below)
    titleBarStyle: useIntegratedChrome ? 'hiddenInset' : 'default',
    ...(useIntegratedChrome ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    webPreferences: {
      // The official DSH Web page and its Profile Client plugins run without
      // Node, ipcRenderer, or a product preload. Native capabilities must be
      // reached through an explicit DSH Host service or a trusted native page.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      navigateOnDragDrop: false,
    },
  });
  mainWindowKind = 'official-web';
  const officialWindow = mainWindow;
  if (initializeAppUpdater()?.getState().enabled) {
    const updateView = new AppUpdateView({
      window: officialWindow, WebContentsView, View, nativeTheme,
      getController: initializeAppUpdater,
      integratedChrome: useIntegratedChrome,
    });
    appUpdateView = updateView;
    void updateView.ready.catch((error) => {
      console.error('[updater] 更新控件加载失败:', error.message);
      updateView.dispose();
      if (appUpdateView === updateView) appUpdateView = null;
    });
    officialWindow.once('closed', () => {
      updateView.dispose();
      if (appUpdateView === updateView) appUpdateView = null;
    });
  }
  mainWindow.center();
  lockPageZoom(mainWindow);
  let surfaceLoadRetried = false;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (surfaceLoadRetried) {
      const error = new Error(`官方 DSH Web 加载失败（code=${errorCode}）`);
      error.code = 'DSH_CLIENT_SURFACE_LOAD_FAILED';
      showRecoveryFailure('client_surface_load', error);
      return;
    }
    surfaceLoadRetried = true;
    mainWindow?.loadURL(surfaceUrl);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() || '';
    let sameSurface = false;
    try { sameSurface = new URL(url).origin === new URL(surfaceUrl).origin; } catch { /* invalid navigation */ }
    if (url === current || sameSurface) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  // Local Site previews use opaque-origin srcdoc frames. They may run their own
  // scripts, but cannot turn the trusted app window into a remote page.
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    const current = String(details.frame?.url || '');
    if (!/^about:srcdoc(?:$|[#?])/i.test(current)) return;
    if (/^about:(?:srcdoc|blank)(?:$|[#?])/i.test(String(details.url || ''))) return;
    details.preventDefault();
  });
  const rendererErrors = [];
  if (!SMOKE_TEST) {
    mainWindow.webContents.once('did-finish-load', () => {
      void waitForOfficialWebSurface(officialWindow).catch((error) => {
        if (mainWindow === officialWindow && !officialWindow.isDestroyed()) {
          showRecoveryFailure('client_surface_ready', error);
        }
      });
    });
  }
  if (SMOKE_TEST) {
    mainWindow.webContents.on('console-message', (details) => {
      if (details?.level !== 'error') return;
      const location = details.location ? ` @${details.location.url || ''}:${details.location.line || 0}` : '';
      rendererErrors.push(String(details.message || '未知 Renderer 错误') + location);
    });
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const deadline = Date.now() + 90_000;
        let state = null;
        let nextClickIndex = 0;
        let onboardingSettled = !SMOKE_DISMISS_ONBOARDING;
        let workspaceCreated = !SMOKE_WORKSPACE_PATH;
        let smartAttachmentPickerVerified = !SMOKE_SMART_ATTACHMENT_PICKER;
        while (Date.now() < deadline) {
          state = await mainWindow.webContents.executeJavaScript(`({ title: document.title, officialWeb: Boolean(document.querySelector('#root') && globalThis.__DSH_BOOT__), bodyText: document.body?.innerText?.slice(0, 1200) || '', clientEntries: (globalThis.__DSH_BOOT__?.entries || []).map((entry) => entry.id), controls: [...document.querySelectorAll('button,[role="button"],[role="tab"]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).slice(0, 80).map((element) => ({ text: String(element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' '), aria: element.getAttribute('aria-label'), role: element.getAttribute('role') })), expectedSurface: ${JSON.stringify(SMOKE_EXPECT_SELECTOR)} === '' || document.querySelector(${JSON.stringify(SMOKE_EXPECT_SELECTOR)}) !== null, rejectedSurfaceAbsent: ${JSON.stringify(SMOKE_REJECT_SELECTOR)} === '' || document.querySelector(${JSON.stringify(SMOKE_REJECT_SELECTOR)}) === null })`);
          if (!onboardingSettled && state.officialWeb) {
            for (let attempt = 0; attempt < 30; attempt += 1) {
              await smokeOnboardingState(mainWindow);
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            onboardingSettled = true;
            continue;
          }
          if (state.officialWeb && onboardingSettled && !workspaceCreated) {
            const rpc = await mainWindow.webContents.executeJavaScript(`(() => {
              const request = {
                type: 'client-request',
                rpcId: crypto.randomUUID(),
                method: 'workspace/create',
                payload: { args: { request: { path: ${JSON.stringify(SMOKE_WORKSPACE_PATH)} } } },
              };
              return fetch('/api/workspace/create', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request),
              }).then(async (response) => ({ status: response.status, body: await response.text() }));
            })()`);
            const envelope = rpc?.status === 200 ? (() => { try { return JSON.parse(rpc.body); } catch { return null; } })() : null;
            if (envelope?.result?.ok) {
              workspaceCreated = true;
              continue;
            }
            // 首启安装默认精选插件时 /api 路由注册完成晚于页面加载，404 属预期内抖动，重试到死线
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            continue;
          }
          if (state.officialWeb && nextClickIndex < SMOKE_CLICK_SELECTORS.length) {
            const selector = SMOKE_CLICK_SELECTORS[nextClickIndex];
            const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
              const selector = ${JSON.stringify(selector)};
              let target = null;
              if (selector.startsWith('text:')) {
                const labels = new Set(selector.slice(5).split('|').map((value) => value.trim()).filter(Boolean));
                target = [...document.querySelectorAll('button,[role="button"]')].find((element) => {
                  const rect = element.getBoundingClientRect();
                  const text = String(element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ');
                  return rect.width > 0 && rect.height > 0 && labels.has(text);
                });
              } else {
                target = document.querySelector(selector);
              }
              if (!target) return false;
              target.click();
              return true;
            })()`);
            if (clicked) nextClickIndex += 1;
          }
          if (state.officialWeb && nextClickIndex === SMOKE_CLICK_SELECTORS.length && state.expectedSurface
            && !smartAttachmentPickerVerified) {
            smartAttachmentPickerVerified = await smokeSmartAttachmentPicker(mainWindow);
            continue;
          }
          if (state.officialWeb && nextClickIndex === SMOKE_CLICK_SELECTORS.length && state.expectedSurface
            && smartAttachmentPickerVerified) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (SMOKE_REJECT_SELECTOR && state?.officialWeb) {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          if (SMOKE_DISMISS_ONBOARDING) {
            for (let attempt = 0; attempt < 20; attempt += 1) {
              const onboarding = await smokeOnboardingState(mainWindow);
              if (!onboarding.visible) break;
              await new Promise((resolve) => setTimeout(resolve, onboarding.dismissed ? 150 : 250));
            }
          }
          state = await mainWindow.webContents.executeJavaScript(`({ title: document.title, officialWeb: Boolean(document.querySelector('#root') && globalThis.__DSH_BOOT__), expectedSurface: true, rejectedSurfaceAbsent: document.querySelector(${JSON.stringify(SMOKE_REJECT_SELECTOR)}) === null })`);
        }
        if (SMOKE_EXPECT_POST_JSON_OK && state?.officialWeb) {
          const apiProbe = await mainWindow.webContents.executeJavaScript(`fetch(${JSON.stringify(SMOKE_EXPECT_POST_JSON_OK)}, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }).then(async (response) => ({ status: response.status, body: await response.json() }))`);
          if (apiProbe?.status !== 200 || apiProbe?.body?.ok !== true || apiProbe?.body?.value?.ok !== true) {
            throw new Error(`Smoke JSON API 检查失败: ${JSON.stringify(apiProbe)}`);
          }
        }
        const clicksCompleted = nextClickIndex === SMOKE_CLICK_SELECTORS.length;
        if (state?.officialWeb && clicksCompleted && smartAttachmentPickerVerified
          && state.expectedSurface && state.rejectedSurfaceAbsent) {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          await captureSmokeScreenshot();
        }
        console.log(`[smoke] 官方 DSH Web 已加载 title=${state.title} officialWeb=${state.officialWeb} clicks=${nextClickIndex}/${SMOKE_CLICK_SELECTORS.length}`);
        if (!state.officialWeb || !clicksCompleted || !state.expectedSurface) {
          console.error(`[smoke] 官方 Web 页面摘要: ${String(state.bodyText || '').replace(/\s+/g, ' ').trim()}`);
          console.error(`[smoke] Client entries: ${JSON.stringify(state.clientEntries || [])}`);
          console.error(`[smoke] 可见控件: ${JSON.stringify(state.controls || [])}`);
        }
        if (rendererErrors.length) console.error(`[smoke] Renderer 控制台错误: ${rendererErrors.join(' | ')}`);
        if (!state.officialWeb || !clicksCompleted || !smartAttachmentPickerVerified
          || !state.expectedSurface || !state.rejectedSurfaceAbsent || rendererErrors.length) process.exitCode = 1;
      } catch (error) {
        console.error('[smoke] Renderer 验证失败:', error?.message || error);
        process.exitCode = 1;
      } finally {
        // Let startup IPC invoked by mounted React effects settle before the
        // smoke-only teardown makes their sender untrusted or stops Server.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        quitApplication();
      }
    });
  }
  mainWindow.loadURL(surfaceUrl);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    handleMainWindowCloseRequest(mainWindow);
  });
  mainWindow.on('closed', () => {
    if (mainWindow === officialWindow) mainWindow = null;
  });
}

function lockPageZoom(win) {
  const resetZoom = () => {
    try { win.webContents.setZoomLevel(0); } catch { /* ignore */ }
    try { win.webContents.setZoomFactor(1); } catch { /* ignore */ }
  };
  resetZoom();
  win.webContents.on('did-finish-load', resetZoom);
  win.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetZoom();
  });
  try {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  } catch {
    /* ignore */
  }
}

// Official Web and Client Bundles use DSH Host services. Electron does not
// expose a renderer IPC surface or a generic file/path bridge.

function requestBackend(req = {}, { timeoutMs = API_REQUEST_TIMEOUT_MS } = {}) {
  if (backendState !== 'ready') throw new Error('本地 Server 尚未就绪');
  const requestedTimeoutMs = Number(timeoutMs);
  const requestTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.max(1000, Math.min(requestedTimeoutMs, API_REQUEST_TIMEOUT_MS))
    : API_REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const id = `q${++reqSeq}`;
    let status = 0;
    let statusText = '';
    let headers = {};
    let binary = false;
    const chunks = [];
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`本地请求超时(${requestTimeoutMs}ms)`)));
      backendSend({ id, type: 'abort' });
    }, requestTimeoutMs);
    const entry = {
      timer,
      fail: (error) => finish(() => reject(error)),
      handle: (m) => {
        if (m.type === 'head') { status = m.status; statusText = m.statusText; headers = m.headers || {}; }
        else if (m.type === 'data') { if (m.b64) binary = true; chunks.push(m.chunk); }
        else if (m.type === 'error') { finish(() => reject(new Error(m.error || '本地请求失败'))); }
        else if (m.type === 'end') {
          if (binary) {
            // Binary blob download: decode each chunk and concatenate; encode once as base64 for renderer to rebuild Blob.
            const buf = Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64')));
            finish(() => resolve({ status, statusText, headers, bodyB64: buf.toString('base64') }));
            return;
          }
          const text = chunks.join('');
          const ct = String(headers['content-type'] || '');
          let json;
          let body;
          if (/application\/json/i.test(ct)) { try { json = JSON.parse(text); } catch { body = text; } }
          else body = text;
          finish(() => resolve({ status, statusText, headers, json, body }));
        }
      },
    };
    pending.set(id, entry);
    if (!backendSend({ id, method: (req.method || 'GET').toUpperCase(), url: req.url || '/', headers: req.headers || {}, body: req.body ?? null, bodyEncoding: req.bodyEncoding })) {
      entry.fail(new Error('本地 Server 不可用'));
    }
  });
}

function normalizeRendererSurface(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.pathname !== '/' || url.hash) {
    throw new Error('DSH Client 必须使用受信任的 loopback HTTP 启动地址');
  }
  const tokenNames = [...url.searchParams.keys()];
  const tokens = url.searchParams.getAll('token');
  if (tokenNames.some((name) => name !== 'token') || tokens.length > 1
    || (tokens.length === 1 && !tokens[0])) {
    throw new Error('DSH Client 启动地址包含无效认证参数');
  }
  return url.href;
}

async function resolveRendererSurface() {
  const response = await requestBackend({
    method: 'GET',
    url: '/api/agents/runtime/client-surface',
  }, { timeoutMs: 90_000 });
  if (response.status !== 200 || response.json?.success !== true) {
    throw new Error(response.json?.message || `DSH Client 启动失败（HTTP ${response.status}）`);
  }
  integratedDesktopChrome = response.json?.data?.desktop_chrome === true;
  return normalizeRendererSurface(response.json?.data?.url);
}

// Runtime API requests stay inside the official DSH Web connection. The
// Electron main process only uses this transport to resolve the trusted loopback
// Client surface and to perform explicit recovery actions.

// ── App lifecycle ──
async function startApplicationWindow({ runtimeHome = DATA_ROOT, profileMode = 'normal' } = {}) {
  runtimeHomeOverride = path.resolve(runtimeHome);
  profileInitializationMode = profileMode === 'safe' ? 'safe' : 'normal';
  try {
    await startBackend();
    rendererSurfaceUrl = await resolveRendererSurface();
    createWindow(rendererSurfaceUrl);
    recordRecoveryResult({
      userDataPath: app.getPath('userData'),
      action: profileInitializationMode === 'safe' ? 'safe-profile-started' : 'started',
    });
  } catch (error) {
    console.error('[electron] 应用启动失败:', error?.message || error);
    forceStopBackend();
    backendState = 'stopped';
    showRecoveryFailure(
      error?.code === 'DSH_CLIENT_WEB_NOT_READY' ? 'client_surface_ready' : 'backend_start',
      error,
    );
  }
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    try {
      if (mainWindow?.isMinimized()) mainWindow.restore();
      mainWindow?.show();
      mainWindow?.focus();
    } catch {
      // Main window may still be starting.
    }
  });

  app.whenReady().then(async () => {
    runtimeAppName = APP_DISPLAY_NAME;
    configureApplicationIdentity();
    configureApplicationMenu();
    configureProductionSecurityHeaders();
    // macOS dock icon; without setting in dev mode, default Electron icon is shown.
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(nativeImage.createFromPath(APP_ICON)); } catch { /* ignore */ }
    }
    await applyRendererNetworkProxy();
    await startApplicationWindow();
    initializeAppUpdater();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (backendState === 'ready' && rendererSurfaceUrl) createWindow(rendererSurfaceUrl);
        else void startApplicationWindow();
        return;
      }
      try {
        if (mainWindow?.isMinimized()) mainWindow.restore();
        mainWindow?.show();
        mainWindow?.focus();
      } catch {
        /* ignore */
      }
    });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (event) => {
  isQuitting = true;
  if (allowFinalQuit) return;
  event.preventDefault();
  void stopBackendGracefully().finally(() => {
    allowFinalQuit = true;
    if (SMOKE_TEST) app.exit(process.exitCode || 0);
    else app.quit();
  });
});
process.on('exit', () => {
  appUpdateController?.destroy();
  destroyBrowserWorkspace();
  forceStopBackend();
});
