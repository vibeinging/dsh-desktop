const { app, BrowserWindow } = require("electron");

const RESULT_PREFIX = "DSH_OFFICIAL_WEB_RESULT ";
const surface = String(process.env.DSH_OFFICIAL_WEB_URL || "").trim();
const userData = String(process.env.DSH_OFFICIAL_WEB_USER_DATA || "").trim();

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(surface)) {
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
        modelInheritanceClientLoaded: resources.some((url) => url.includes("/plugins/@vibeinging/dsh-model-inheritance/client.js")),
        taskBoardClientLoaded: resources.some((url) => url.includes("/plugins/@linxin666/dsh-client-ui-task-board/client.js")),
        productShellLoaded: resources.some((url) => url.includes("/plugins/@vibeinging/dsh-work-shell/client.js")),
        bodyChildCount: document.body.childElementCount,
      };
    })()`, true);
    if (latest.officialWeb && latest.bodyChildCount > 0) return latest;
    await sleep(200);
  }
  throw new Error(`official Web Client graph did not start: ${JSON.stringify(latest)}`);
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
    const result = await inspectOfficialSurface(window);
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
