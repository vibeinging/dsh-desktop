import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  ASKABLE_BROWSER_PERMISSIONS,
  BrowserWorkspaceController,
  createBrowserTabState,
  closeBrowserTabState,
  normalizeBrowserHistory,
  normalizeBrowserBounds,
  normalizeBrowserPermissionRules,
  normalizeBrowserTarget,
  normalizeZoomFactor,
  permissionRuleKey,
  safeDownloadFilename,
  sanitizeHistoryUrl,
} = require('../../electron/browser-workspace.js');

test('browser navigation accepts web URLs and rejects dangerous schemes', () => {
  assert.equal(normalizeBrowserTarget('example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeBrowserTarget('http://localhost:4173/demo'), 'http://localhost:4173/demo');
  assert.equal(normalizeBrowserTarget('季度报告'), 'https://duckduckgo.com/?q=%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A');
  assert.equal(normalizeBrowserTarget('javascript:alert(1)'), null);
  assert.equal(normalizeBrowserTarget('file:///etc/passwd'), null);
  assert.equal(normalizeBrowserTarget('data:text/html,hello'), null);
});

test('browser state keeps bounded tabs, bounds, zoom and permissions', () => {
  let state = createBrowserTabState();
  state = createBrowserTabState(state, { id: 'tab-1', title: 'A'.repeat(500), url: 'https://example.com' });
  state = createBrowserTabState(state, { id: 'tab-2', title: '第二页', url: 'https://example.com/two' });
  assert.equal(state.activeTabId, 'tab-2');
  assert.equal(state.tabs[0].title.length <= 160, true);
  state = closeBrowserTabState(state, 'tab-2');
  assert.equal(state.activeTabId, 'tab-1');
  assert.deepEqual(normalizeBrowserBounds({ x: -20, y: 12.8, width: 9000, height: 700 }, { width: 1200, height: 800 }), {
    x: 0,
    y: 13,
    width: 1200,
    height: 700,
  });
  assert.equal(normalizeBrowserBounds({ x: 0, y: 0, width: 0, height: 20 }, { width: 1200, height: 800 }), null);
  assert.equal(normalizeZoomFactor(9), 2);
  assert.equal(normalizeZoomFactor(0.1), 0.5);
  assert.equal(normalizeZoomFactor(1.26), 1.3);
  assert.equal(ASKABLE_BROWSER_PERMISSIONS.has('media'), true);
  assert.equal(permissionRuleKey('https://example.com/path', 'geolocation'), 'https://example.com|geolocation');
  assert.equal(permissionRuleKey('file:///tmp/a', 'geolocation'), null);
  assert.deepEqual(normalizeBrowserPermissionRules({
    'https://example.com|geolocation': 'allow',
    'https://example.com|media': 'deny',
    'file://|media': 'allow',
    'https://example.com|notifications': 'maybe',
  }), {
    'https://example.com|geolocation': 'allow',
    'https://example.com|media': 'deny',
  });
  assert.equal(safeDownloadFilename('../../季度:报告?.pdf'), '季度_报告_.pdf');
});

test('browser history removes credentials and sensitive parameters', () => {
  assert.equal(
    sanitizeHistoryUrl('https://user:pass@example.com/report?token=secret&zipcode=200000&api_key=hidden#part'),
    'https://example.com/report?zipcode=200000',
  );
  assert.equal(sanitizeHistoryUrl('about:blank'), null);
  assert.deepEqual(normalizeBrowserHistory([
    { id: 'one', title: '第一页', url: 'https://example.com/?code=hidden&view=full', visitedAt: '2026-07-31T01:00:00.000Z', visitCount: 2 },
    { id: 'duplicate', title: '重复', url: 'https://example.com/?view=full', visitedAt: '2026-07-31T02:00:00.000Z' },
    { id: 'bad', title: '本地文件', url: 'file:///tmp/private', visitedAt: '2026-07-31T03:00:00.000Z' },
  ]), [{
    id: 'one',
    title: '第一页',
    url: 'https://example.com/?view=full',
    visitedAt: '2026-07-31T01:00:00.000Z',
    visitCount: 2,
  }]);
});

test('Browser Workspace persists only private history and permission state', (context) => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'browser-workspace-contract-'));
  context.after(() => rmSync(userDataPath, { recursive: true, force: true }));
  const browserSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    on() {},
    removeListener() {},
  };
  const controller = new BrowserWorkspaceController({
    WebContentsView: function FakeWebContentsView() {},
    browserSession,
    getParentWindow: () => null,
    userDataPath,
    sendEvent: () => {},
  });
  context.after(() => controller.destroy());
  assert.equal(controller.recordHistory('https://example.com/report?token=secret&view=full', '报告'), true);
  const historyPath = join(userDataPath, 'browser-history.json');
  assert.equal(statSync(historyPath).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(historyPath, 'utf8'), /secret/);
});

test('Browser Workspace falls back to the page screenshot protocol when Viz is unavailable', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'browser-workspace-screenshot-'));
  const browserSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    on() {},
    removeListener() {},
  };
  const controller = new BrowserWorkspaceController({
    WebContentsView: function FakeWebContentsView() {},
    browserSession,
    getParentWindow: () => null,
    userDataPath,
    sendEvent: () => {},
  });
  let detached = false;
  controller.tabs = [{
    id: 'tab-1',
    title: '截图页面',
    view: {
      webContents: {
        async capturePage() {
          throw new Error('UnknownVizError');
        },
        debugger: {
          isAttached: () => false,
          attach(version) {
            assert.equal(version, '1.3');
          },
          async sendCommand(method, params) {
            assert.equal(method, 'Page.captureScreenshot');
            assert.deepEqual(params.clip, { x: 0, y: 0, width: 700, height: 560, scale: 1 });
            return { data: Buffer.from('fallback-png').toString('base64') };
          },
          detach() {
            detached = true;
          },
        },
      },
    },
  }];
  controller.activeTabId = 'tab-1';
  try {
    const result = await controller.captureScreenshot('tab-1');
    assert.equal(result.title, '截图页面');
    assert.deepEqual(result.png, Buffer.from('fallback-png'));
    assert.equal(detached, true);
  } finally {
    controller.destroy();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Electron keeps Browser Workspace behind the trusted main-to-Server Host channel', () => {
  const main = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  const browserHost = readFileSync(new URL('../../electron/browser-workspace.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../../electron/package.json', import.meta.url), 'utf8'));

  assert.match(main, /WebContentsView/);
  assert.match(main, /BROWSER_PARTITION/);
  assert.match(main, /desktop-native-request/);
  assert.match(main, /BROWSER_NATIVE_HANDLERS/);
  assert.doesNotMatch(main, /\bipcMain\b/);
  assert.doesNotMatch(main, /preload\s*:/);
  assert.match(browserHost, /setPermissionCheckHandler/);
  assert.match(browserHost, /setPermissionRequestHandler/);
  assert.match(browserHost, /will-download/);
  assert.match(browserHost, /nodeIntegration:\s*false/);
  assert.match(browserHost, /contextIsolation:\s*true/);
  assert.match(browserHost, /sandbox:\s*true/);
  assert.equal(packageJson.build.files.includes('browser-workspace.js'), true);
  assert.equal(packageJson.build.files.includes('preload.js'), false);
});
