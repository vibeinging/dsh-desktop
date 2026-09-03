const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { handleAppUpdateRequest } = require('./app-update-requests');

const TITLEBAR_HEIGHT = 36;
const UPDATE_PAGE = path.join(__dirname, 'app-update.html');
const UPDATE_URL = pathToFileURL(UPDATE_PAGE).href;

/** Accept IPC only from this view's local, top-level document. */
function isTrustedUpdateSender(event, contents) {
  return !contents.isDestroyed() && event.sender === contents
    && event.senderFrame === contents.mainFrame && event.senderFrame?.url === UPDATE_URL;
}

/** Reserve only the existing title strip until the notes panel is opened. */
function updateViewBounds(content, layout = {}) {
  const expanded = layout.expanded === true;
  // Keep x stable: moving a hovered native view would invalidate Chromium's pointer hit target.
  const width = Math.min(content.width, 384);
  const height = Math.min(content.height, expanded ? Math.max(180, Math.min(600, Math.ceil(layout.contentHeight || 530))) : TITLEBAR_HEIGHT);
  return { x: content.width - width, y: 0, width, height };
}

/** Own the update control independently of removable, non-auto-upgraded Profile plugins. */
class AppUpdateView {
  constructor({ window, WebContentsView, View, nativeTheme, getController, integratedChrome = false, logger = console }) {
    this.window = window;
    this.getController = getController;
    this.nativeTheme = nativeTheme;
    this.logger = logger;
    this.state = getController().getState();
    this.contentInset = integratedChrome ? 0 : TITLEBAR_HEIGHT;
    this.layout = {};
    this.loaded = false;
    this.disposed = false;
    this.pendingFocus = false;
    this.content = window.webContents;
    this.insetCssKey = null;
    this.onContentLoaded = () => {
      // Same layout reservation as Profile chrome, without changing DSH sources or giving Web a bridge.
      this.insetReady = this.content.insertCSS(`#root { box-sizing: border-box !important; height: 100vh !important; padding-top: ${TITLEBAR_HEIGHT}px !important; }`)
        .then((key) => {
          if (this.disposed) { if (!this.content.isDestroyed()) return this.content.removeInsertedCSS(key); }
          else this.insetCssKey = key;
        }).catch((error) => { if (!this.content.isDestroyed()) logger.warn('[updater] 更新栏布局加载失败:', error.message); });
    };
    this.view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, 'app-update-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `dsh-app-update-${window.id}`,
      navigateOnDragDrop: false,
    } });
    this.view.setBackgroundColor('#00000000');
    const contents = this.view.webContents;
    contents.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-frame-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.ipc.handle('dsh-app-update:command', (event, method, payload) => {
      if (!isTrustedUpdateSender(event, contents)) throw new Error('更新请求来源不可信');
      return handleAppUpdateRequest(getController(), method, payload);
    });
    contents.ipc.on('dsh-app-update:layout', (event, layout) => {
      if (!isTrustedUpdateSender(event, contents) || !layout || typeof layout.expanded !== 'boolean'
        || !Number.isFinite(layout.contentHeight)) return;
      this.layout = layout;
      if (layout.expanded) window.contentView.addChildView(this.view);
      this.resize();
    });
    this.resize = this.resize.bind(this);
    this.dismiss = () => this.send('dsh-app-update:dismiss');
    this.onContentInput = (_event, input) => {
      if (input.type === 'keyDown' && input.key?.toLowerCase() === 'u' && input.shift && (input.meta || input.control)) {
        _event.preventDefault();
        this.focus();
      }
    };
    this.onMouseInput = (_event, input) => { if (input.type === 'mouseDown') this.dismiss(); };
    this.onTheme = () => this.backdrop?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#19191d' : '#f4f5f8');
    if (this.contentInset) {
      this.backdrop = new View();
      this.onTheme();
      window.contentView.addChildView(this.backdrop);
      this.content.on('did-finish-load', this.onContentLoaded);
      if (this.content.getURL() && !this.content.isLoading()) this.onContentLoaded();
    }
    window.contentView.addChildView(this.view);
    window.on('resize', this.resize);
    window.on('blur', this.dismiss);
    window.webContents.on('before-input-event', this.onContentInput);
    contents.on('before-input-event', this.onContentInput);
    window.webContents.on('before-mouse-event', this.onMouseInput);
    contents.on('blur', this.dismiss);
    nativeTheme.on('updated', this.onTheme);
    this.resize();
    this.ready = contents.loadFile(UPDATE_PAGE).then(() => {
      if (this.disposed) return;
      this.loaded = true;
      this.setState(getController().getState());
      if (this.pendingFocus) this.focus();
    });
  }

  resize() {
    if (this.disposed || this.window.isDestroyed()) return;
    const content = this.window.getContentBounds();
    if (this.contentInset) {
      this.backdrop.setBounds({ x: 0, y: 0, width: content.width, height: this.contentInset });
    }
    this.view.setBounds(updateViewBounds(content, this.layout));
  }

  send(channel, value) {
    if (this.loaded && !this.disposed && !this.view.webContents.isDestroyed()) this.view.webContents.send(channel, value);
  }

  setState(state) {
    this.state = state;
    if (this.disposed) return;
    this.view.setVisible(Boolean(state?.enabled));
    this.send('dsh-app-update:state', state);
  }

  focus() {
    if (!this.loaded) { this.pendingFocus = true; return; }
    if (this.disposed || !this.state?.enabled) return;
    this.pendingFocus = false;
    this.window.show();
    this.window.focus();
    this.view.webContents.focus();
    this.send('dsh-app-update:focus');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.nativeTheme.removeListener('updated', this.onTheme);
    this.window.removeListener('resize', this.resize);
    this.window.removeListener('blur', this.dismiss);
    this.content.removeListener('before-input-event', this.onContentInput);
    this.content.removeListener('before-mouse-event', this.onMouseInput);
    this.content.removeListener('did-finish-load', this.onContentLoaded);
    if (this.insetCssKey && !this.content.isDestroyed()) {
      void this.content.removeInsertedCSS(this.insetCssKey).catch((error) => {
        if (!this.content.isDestroyed()) this.logger.warn('[updater] 更新栏布局清理失败:', error.message);
      });
    }
    if (!this.window.isDestroyed()) {
      this.window.contentView.removeChildView(this.view);
      if (this.backdrop) this.window.contentView.removeChildView(this.backdrop);
    }
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.ipc.removeHandler('dsh-app-update:command');
      this.view.webContents.ipc.removeAllListeners('dsh-app-update:layout');
      this.view.webContents.removeListener('blur', this.dismiss);
      this.view.webContents.removeListener('before-input-event', this.onContentInput);
      this.view.webContents.close();
    }
  }
}

module.exports = { AppUpdateView, TITLEBAR_HEIGHT, UPDATE_URL, isTrustedUpdateSender, updateViewBounds };
