// Real Electron UI + real update controller; only downloads/installers are replaced.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, View, nativeTheme, session } = require('electron');
const { AppUpdateView } = require('../app-update-view');
const { AppUpdateController } = require('../app-update-controller');
const { BrowserWorkspaceController } = require('../browser-workspace');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-update-ui-smoke-'));
app.setName('DSHUpdateUISmoke');
app.setPath('userData', path.join(directory, 'user-data'));
app.commandLine.appendSwitch('use-angle', 'swiftshader');
// The last assertion checks parent-window destruction before writing the result.
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await check()) return;
    await pause(40);
  }
  throw new Error(`等待超时: ${label}`);
}

const notes = `<h1>DSH Desktop v0.2.0</h1><h2>本次更新</h2><ul>
  <li>默认加入多智能体团队插件 Agent Teams。</li>
  <li>随包默认 Bundle 从 14 个增加到 15 个，原有插件保持不变。</li></ul>
  <h2>下载与安装</h2><ul><li>macOS Apple Silicon：安装包已签名并通过 Apple 公证。</li>
  <li>Windows x64：提供 NSIS 安装器。</li></ul>
  <h2>验证与已知限制</h2><ul><li>更新保留本地 Profile、会话及插件选择。</li>
  <li>本次不提供 macOS Intel 或 Linux 安装包。</li></ul>
  <h2>更多说明</h2><p>${'更新不会替你修改插件配置。'.repeat(24)}</p>
  <script>window.releaseScriptRan=true</script><img src="https://invalid.example/tracker" onerror="window.releaseScriptRan=true">`;

class FakeUpdater extends EventEmitter {
  downloads = 0;
  installs = 0;
  setFeedURL() {}
  async checkForUpdates() { return { isUpdateAvailable: true, updateInfo: { version: '0.2.0', releaseNotes: notes } }; }
  downloadUpdate() { this.downloads++; return new Promise(resolve => { this.finish = resolve; }); }
  quitAndInstall() { this.installs++; }
}

let win;
let view;
let controller;
let browser;
let stage = 'startup';
let exitCode = 0;
let diagnose = async () => ({});
const updater = new FakeUpdater();
const rendererErrors = [];
const evidence = [];
async function run() {
  nativeTheme.themeSource = 'light';
  win = new BrowserWindow({ show: false, width: 1000, height: 700, title: 'DSH Update UI Test',
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  await win.loadURL('data:text/html,<title>Update UI fixture</title><body style="margin:0;background:%23f4f5f8"><div id="root"><button id="content">Main content</button></div></body>');
  let gateAllowed = false;
  controller = new AppUpdateController({
    app: { getVersion: () => '0.1.9' }, updater, repository: { owner: 'vibeinging', repo: 'dsh-desktop' },
    platform: 'darwin', arch: 'arm64', isPackaged: true,
    userDataPath: app.getPath('userData'), dataRoot: path.join(directory, 'data'),
    onStateChange: state => view?.setState(state),
    preflightInstall: async () => ({ ok: gateAllowed, message: '测试 Profile 需要处理' }),
    prepareToInstall: async () => {}, logger: { info() {}, warn() {}, error() {} },
  });
  view = new AppUpdateView({ window: win, WebContentsView, View, nativeTheme, getController: () => controller, integratedChrome: true });
  view.view.webContents.on('console-message', (_event, ...args) => {
    const details = typeof _event.message === 'string' ? _event : { level: args[0], message: args[1] };
    if (details.level === 'error' || details.level === 3) rendererErrors.push(details.message);
  });
  await view.ready;
  app.focus({ steal: true });
  win.show();
  win.focus();
  await waitFor(() => win.isFocused(), 'native test window focus');
  let contents = view.view.webContents;
  // Chromium input targets this isolated view even if the user changes system focus.
  contents.debugger.attach('1.3');
  const js = code => contents.executeJavaScript(code);
  await js(`globalThis.updateUiEvents = [];
    for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) {
      document.querySelector('.dsh-update').addEventListener(type, () => {
        updateUiEvents.push({ type, open: document.querySelector('.dsh-update').dataset.open });
      });
    }`);
  diagnose = async () => ({ directory, focused: win?.isFocused(), bounds: view?.view.getBounds(),
    ui: await js(`({ events: globalThis.updateUiEvents, open: document.querySelector('.dsh-update')?.dataset.open,
      notes: (() => { const e = document.querySelector('.dsh-update-notes'); const r = e.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, height:r.height, scroll:e.scrollTop, scrollHeight:e.scrollHeight,
          maxHeight:getComputedStyle(e).maxHeight, visibility:getComputedStyle(e).visibility }; })() })`) });
  const inspect = () => js(`({ label: document.querySelector('.dsh-update-label')?.textContent,
    open: document.querySelector('.dsh-update')?.dataset.open,
    notes: document.querySelector('.dsh-update-notes')?.textContent,
    disabled: document.querySelector('button')?.disabled })`);
  const moveTo = async selector => {
    const point = await js(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.min(r.height/2,30))}; })()`);
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    return point;
  };
  const clickButton = async () => {
    const point = await moveTo('button');
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const capture = async name => {
    await pause(250);
    const { data } = await contents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(data, 'base64'));
  };

  stage = 'nonmodal-availability';
  await controller.check();
  await waitFor(async () => (await inspect()).label === '更新 0.2.0', stage);
  assert.equal((await inspect()).open, 'false');
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(updater.downloads, 0);
  assert.equal(view.view.getBounds().height, 36);
  assert.equal(await win.webContents.executeJavaScript('typeof window.dshAppUpdate'), 'undefined');
  assert.equal(await js('typeof process'), 'undefined');
  await capture('button-light');
  evidence.push(stage);

  stage = 'hover-safe-notes';
  await moveTo('button');
  await waitFor(async () => (await inspect()).open === 'true', stage);
  await waitFor(() => view.view.getBounds().width === 384, 'expanded bounds');
  const text = (await inspect()).notes;
  assert.match(text, /本次更新/);
  assert.match(text, /默认加入/);
  assert.doesNotMatch(text, /<h1>|<li>|releaseScriptRan|tracker/);
  assert.equal(await js('window.releaseScriptRan'), undefined);
  assert.equal(await js('document.querySelectorAll(".dsh-update-notes img, .dsh-update-notes iframe, .dsh-update-notes script, .dsh-update-notes style, .dsh-update-notes svg, .dsh-update-notes object, .dsh-update-notes embed").length'), 0);
  assert.equal(await js('document.querySelector(".dsh-update-notes h1, .dsh-update-notes h2, .dsh-update-notes li, .dsh-update-notes p, .dsh-update-notes ul") !== null'), true);
  assert.equal(updater.downloads, 0);
  await capture('notes-light');
  const notePoint = await moveTo('.dsh-update-notes');
  await waitFor(async () => (await inspect()).open === 'true', 'notes remain open before scroll');
  await pause(180);
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...notePoint, deltaY: 180, deltaX: 0 });
  await waitFor(() => js('document.querySelector(".dsh-update-notes").scrollTop > 0'), 'notes scroll');
  await pause(220);
  assert.equal((await inspect()).open, 'true');
  await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 34 });
  await waitFor(async () => (await inspect()).open === 'false', 'pointer leave');
  assert.equal(view.view.getBounds().height, 36);
  evidence.push(stage);

  stage = 'keyboard-and-dismiss';
  view.focus();
  await waitFor(() => js('document.activeElement.tagName === "BUTTON"'), 'button focus');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(async () => (await inspect()).open === 'false', 'escape');
  assert.equal(view.view.getBounds().height, 36);
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control', 'shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'U', modifiers: ['control', 'shift'] });
  await waitFor(async () => (await inspect()).open === 'true', 'keyboard shortcut');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor(() => js('document.activeElement.className === "dsh-update-notes"'), 'keyboard notes focus');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(async () => (await inspect()).open === 'false', 'escape from notes');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control', 'shift'] });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'U', modifiers: ['control', 'shift'] });
  await waitFor(async () => (await inspect()).open === 'true', 'keyboard reopen while update view has focus');
  nativeTheme.themeSource = 'dark';
  await js('document.querySelector(".dsh-update-notes").scrollTop=0');
  await capture('notes-dark');
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await js('getComputedStyle(document.querySelector(".dsh-update-popover")).transitionDuration'), '0s');
  evidence.push(stage);

  stage = 'explicit-download-progress-and-profile-gate';
  await assert.rejects(js('window.dshAppUpdate.install({version:"9.9.9"})'));
  assert.equal(updater.downloads, 0);
  await clickButton();
  await waitFor(() => updater.downloads === 1, 'download only after click');
  updater.emit('download-progress', { percent: 48.5 });
  await waitFor(async () => (await inspect()).label === '下载中 49%', 'progress');
  assert.equal((await inspect()).disabled, true);
  await clickButton();
  assert.equal(updater.downloads, 1);
  await capture('progress-dark');
  updater.emit('error', new Error('测试下载网络中断'));
  updater.finish([]);
  await waitFor(async () => (await inspect()).label === '重试更新', 'inline download failure');
  assert.match((await inspect()).notes, /测试下载网络中断/);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await clickButton();
  await waitFor(async () => (await inspect()).label === '更新 0.2.0', 'retry after error');
  await clickButton();
  await waitFor(() => updater.downloads === 2, 'explicit download retry');
  updater.emit('update-downloaded', { version: '0.2.0' });
  updater.finish([]);
  await waitFor(async () => (await inspect()).label === '更新已暂停', 'Profile block');
  assert.equal(updater.installs, 0);
  assert.equal(fs.existsSync(path.join(app.getPath('userData'), 'pending-app-update.json')), false);
  await clickButton();
  await waitFor(async () => (await inspect()).label === '更新 0.2.0', 'check after block');
  gateAllowed = true;
  await clickButton();
  await waitFor(() => updater.downloads === 3, 'explicit retry');
  updater.emit('update-downloaded', { version: '0.2.0' });
  updater.finish([]);
  await waitFor(() => updater.installs === 1, 'installation after gate');
  evidence.push(stage);

  stage = 'fallback-inset-resize-and-cleanup';
  view.dispose();
  view.dispose();
  await waitFor(() => contents.isDestroyed(), 'view closed');
  view = new AppUpdateView({ window: win, WebContentsView, View, nativeTheme, getController: () => controller });
  await view.ready;
  await view.insetReady;
  contents = view.view.webContents;
  const contentTop = () => win.webContents.executeJavaScript('document.querySelector("#content").getBoundingClientRect().y');
  assert.equal(await contentTop(), 36);
  await win.webContents.reload();
  await waitFor(async () => !win.webContents.isLoading() && await contentTop() === 36, 'inset after official Web reload');
  browser = new BrowserWorkspaceController({ WebContentsView, browserSession: session.fromPartition('update-ui-browser-fixture'),
    getParentWindow: () => win,
    onBeforeInput: (event, input) => view.onContentInput(event, input),
    userDataPath: app.getPath('userData'), sendEvent: () => {} });
  browser.setBounds({ x: 20, y: 50 + await contentTop(), width: 500, height: 400 });
  browser.setVisible(true);
  assert.equal(browser.attachedView.getBounds().y, 86);
  const browserContents = browser.attachedView.webContents;
  await waitFor(() => !browserContents.isLoading(), 'browser fixture loaded');
  browserContents.focus();
  browserContents.sendInputEvent({ type: 'keyDown', keyCode: 'U', modifiers: ['control', 'shift'] });
  browserContents.sendInputEvent({ type: 'keyUp', keyCode: 'U', modifiers: ['control', 'shift'] });
  await waitFor(async () => (await inspect()).open === 'true', 'keyboard shortcut while browser has focus');
  browser.destroy();
  browser = null;
  win.setSize(900, 600);
  await pause(200);
  assert.equal(await contentTop(), 36);
  view.dispose();
  await waitFor(async () => await contentTop() === 0, 'inset cleanup');
  assert.equal(win.webContents.listenerCount('before-input-event'), 0);
  view = new AppUpdateView({ window: win, WebContentsView, View, nativeTheme, getController: () => controller });
  await view.ready;
  const finalContents = view.view.webContents;
  win.once('closed', () => view.dispose());
  win.destroy();
  await waitFor(() => finalContents.isDestroyed(), 'view cleanup after parent destruction');
  evidence.push(stage);
  assert.deepEqual(rendererErrors, []);
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: evidence, downloads: updater.downloads, simulatedInstalls: updater.installs, directory }, null, 2));
  console.log(JSON.stringify({ ok: true, passed: evidence, directory }));
}

app.whenReady().then(run).catch(async error => {
  exitCode = 1;
  console.error(`[update-ui-smoke:${stage}]`, error.stack || error);
  console.error('[update-ui-smoke:diagnostics]', JSON.stringify(await diagnose().catch(() => ({ directory }))));
}).finally(() => {
  browser?.destroy();
  view?.dispose();
  controller?.destroy();
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(exitCode);
});
