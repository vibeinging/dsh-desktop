const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const { app, BrowserWindow } = require("electron");

const RESULT_PREFIX = "DSH_OFFICIAL_WEB_RESULT ";
const surface = String(process.env.DSH_OFFICIAL_WEB_URL || "").trim();
const userData = String(process.env.DSH_OFFICIAL_WEB_USER_DATA || "").trim();
const communityUi = String(process.env.DSH_OFFICIAL_WEB_COMMUNITY_UI || "").trim();
const screenshotPath = String(process.env.DSH_OFFICIAL_WEB_SCREENSHOT || "").trim();

let surfaceUrl;
try {
  surfaceUrl = new URL(surface);
} catch {
  surfaceUrl = null;
}
const surfaceTokenNames = surfaceUrl ? [...surfaceUrl.searchParams.keys()] : [];
const surfaceTokens = surfaceUrl ? surfaceUrl.searchParams.getAll("token") : [];
if (!surfaceUrl
  || surfaceUrl.protocol !== "http:"
  || surfaceUrl.hostname !== "127.0.0.1"
  || !surfaceUrl.port
  || surfaceUrl.username
  || surfaceUrl.password
  || surfaceUrl.pathname !== "/"
  || surfaceUrl.hash
  || surfaceTokenNames.some((name) => name !== "token")
  || surfaceTokens.length > 1
  || (surfaceTokens.length === 1 && !surfaceTokens[0])) {
  throw new Error("DSH_OFFICIAL_WEB_URL must be an isolated loopback surface");
}
if (userData) app.setPath("userData", userData);
app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspectOfficialSurface(window) {
  const deadline = Date.now() + 30_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => {
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
      return {
        officialWeb: Boolean(document.querySelector("#root") && globalThis.__DSH_BOOT__),
        modelInheritanceClientLoaded: resources.some((url) => url.includes("@vibeinging/dsh-model-inheritance/client.js")),
        taskBoardClientLoaded: resources.some((url) => url.includes("@linxin666/dsh-client-ui-task-board/client.js")),
        betterSidebarClientLoaded: resources.some((url) => url.includes("dsh-better-sidebar/client.js")),
        compatClientLoaded: resources.some((url) => url.includes("@linxin666/dsh-web-ui-all/client.js")),
        productShellLoaded: resources.some((url) => url.includes("@vibeinging/dsh-work-shell/client.js")),
        bodyChildCount: document.body.childElementCount,
      };
    })()`, true);
    if (latest.officialWeb && latest.bodyChildCount > 0) return latest;
    await sleep(200);
  }
  throw new Error(`official Web Client graph did not start: ${JSON.stringify(latest)}`);
}

async function dismissPrompt(window, { labels, bodyNeedles, description, timeoutMs = 10_000 }) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => {
      const labels = new Set(${JSON.stringify(labels)});
      const bodyNeedles = ${JSON.stringify(bodyNeedles)};
      const body = document.body.innerText || '';
      const present = bodyNeedles.some((needle) => body.includes(needle));
      if (!present) return { dismissed: true, buttons: [] };
      const buttons = [...document.querySelectorAll('button,[role="button"]')]
        .map((element) => ({
          element,
          text: (element.innerText || element.textContent || '').trim(),
          rect: element.getBoundingClientRect(),
        }))
        .filter(({ element, text, rect }) => (
          labels.has(text) && !element.disabled && rect.width > 0 && rect.height > 0
        ));
      buttons[0]?.element.click();
      return { dismissed: false, buttons: buttons.map(({ text }) => text) };
    })()`, true).catch(() => null);
    if (latest?.dismissed) return;
    await sleep(200);
  }
  throw new Error(`${description}没有关闭: ${JSON.stringify(latest)}`);
}

async function dismissOfficialPrompts(window) {
  await dismissPrompt(window, {
    labels: ['继续', 'Continue'],
    bodyNeedles: ['内测声明', 'Internal testing'],
    description: '官方 Web 首次提示',
  });
  await dismissPrompt(window, {
    labels: ['稍后配置', 'Later'],
    bodyNeedles: ['添加一个 API Key 开始使用', 'Add an API Key to get started'],
    description: '官方 Web 模型配置提示',
  });
}

async function inspectBetterSidebar(window) {
  await dismissOfficialPrompts(window);
  const deadline = Date.now() + 30_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => {
      const host = document.querySelector('[data-dsh-panel-host]');
      const toggle = host?.querySelector('[data-dsh-toggle-cluster]');
      const rect = host?.getBoundingClientRect();
      return {
        host: Boolean(host),
        toggle: Boolean(toggle),
        visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        mounted: Boolean(document.querySelector('[data-dsh-better-sidebar]')),
      };
    })()`, true).catch(() => null);
    if (latest?.host && latest.toggle && latest.visible && latest.mounted) break;
    await sleep(200);
  }
  if (!latest?.host || !latest.toggle || !latest.visible || !latest.mounted) {
    throw new Error(`Better Sidebar Client 没有挂到官方 Web: ${JSON.stringify(latest)}`);
  }
  const terminalDeps = await window.webContents.executeJavaScript(`fetch('/sidebar/api/terminal.deps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then(async (response) => ({ status: response.status, body: await response.json() }))`, true);
  if (terminalDeps?.status !== 200 || terminalDeps?.body?.ok !== true || terminalDeps?.body?.value?.ok !== true) {
    throw new Error(`Better Sidebar node-pty 依赖不可用: ${JSON.stringify(terminalDeps)}`);
  }
  await dismissOfficialPrompts(window);
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  }
  return {
    betterSidebarHostVisible: latest.visible,
    betterSidebarToggleVisible: latest.toggle,
    betterSidebarMounted: latest.mounted,
    betterSidebarTerminalDeps: true,
    screenshot: screenshotPath || null,
  };
}

async function inspectCompat(window) {
  const deadline = Date.now() + 30_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => {
      const panes = ['sidebar', 'conversation', 'details'];
      return {
        paneHooks: panes.every((pane) => Boolean(document.querySelector('[data-pane="' + pane + '"]'))),
        frame: Boolean(document.querySelector('[data-dsh-frame]')),
      };
    })()`, true).catch(() => null);
    if (latest?.paneHooks && latest.frame) break;
    await sleep(200);
  }
  if (!latest?.paneHooks || !latest.frame) {
    throw new Error(`web-ui compat Client did not stamp the official AppFrame: ${JSON.stringify(latest)}`);
  }
  return {
    compatPaneHooks: latest.paneHooks,
    compatFrame: latest.frame,
  };
}

async function inspectTaskBoard(window) {
  const deadline = Date.now() + 30_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => ({
      entry: document.querySelector('[data-dsh-taskboard-entry]'),
      board: document.querySelector('[data-dsh-taskboard-board]'),
      frame: document.querySelector('[data-dsh-frame]'),
    }))()`, true).then((value) => ({
      entry: Boolean(value?.entry),
      board: Boolean(value?.board),
      frame: Boolean(value?.frame),
    })).catch(() => null);
    if (latest?.entry) break;
    await sleep(200);
  }
  if (!latest?.entry) throw new Error(`task-board Client 没有显示官方 Web 入口: ${JSON.stringify(latest)}`);
  await dismissOfficialPrompts(window);
  await window.webContents.executeJavaScript("document.querySelector('[data-dsh-taskboard-entry]')?.click()", true);
  while (Date.now() < deadline) {
    latest = await window.webContents.executeJavaScript(`(() => {
      const board = document.querySelector('[data-dsh-taskboard-board]');
      const frame = document.querySelector('[data-dsh-frame]');
      const rect = board?.getBoundingClientRect();
      const style = board ? getComputedStyle(board) : null;
      return {
        entry: Boolean(document.querySelector('[data-dsh-taskboard-entry]')),
        active: document.documentElement.hasAttribute('data-dsh-taskboard-active'),
        board: Boolean(board && rect && rect.width > 350 && rect.height > 220 && style?.display !== 'none' && style?.visibility !== 'hidden'),
        columns: board ? [...board.querySelectorAll('[data-status]')].filter((element) => element.tagName === 'SECTION').length : 0,
        boardRect: rect ? { width: rect.width, height: rect.height } : null,
        insideOfficialWebRoot: Boolean(board?.closest('#root')),
        frame: Boolean(frame),
      };
    })()`, true).catch(() => null);
    if (latest?.active && latest.board) break;
    await sleep(200);
  }
  if (!latest?.active || !latest.board) throw new Error(`task-board Client 没有接管官方 Web 工作区: ${JSON.stringify(latest)}`);
  if (screenshotPath) {
    mkdirSync(dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  }
  return {
    taskBoardEntryVisible: latest.entry,
    taskBoardActive: latest.active,
    taskBoardBoardVisible: latest.board,
    taskBoardColumns: latest.columns,
    taskBoardInsideOfficialWebRoot: latest.insideOfficialWebRoot,
    screenshot: screenshotPath || null,
  };
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await window.loadURL(surface);
    const result = {
      ...(await inspectOfficialSurface(window)),
      ...(communityUi === "task-board" ? await inspectTaskBoard(window) : {}),
      ...(communityUi === "better-sidebar" ? await inspectBetterSidebar(window) : {}),
      ...(communityUi === "compat" ? await inspectCompat(window) : {}),
    };
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
    app.quit();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  }
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
