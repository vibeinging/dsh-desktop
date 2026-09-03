import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DESKTOP_OVERLAY_MARGIN,
  DESKTOP_TITLEBAR_HEIGHT,
  DESKTOP_TITLEBAR_ID,
  desktopChromeCss,
  installDesktopChrome,
  supportsIntegratedDesktopChrome,
} from "../../packages/dsh-desktop-chrome/src/client/index.js";
import {
  desktopChromeEnabled,
  resolveDesktopClientSurface,
} from "../../server/src/app/agents/agent_runtime.js";

const packageRoot = new URL("../../packages/dsh-desktop-chrome/", import.meta.url);

function fakeDocument() {
  const head = [];
  const body = [];
  const documentElement = { dataset: {} };
  const createElement = (tagName) => ({
    tagName,
    dataset: {},
    id: "",
    textContent: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() {
      const list = tagName === "style" ? head : body;
      const index = list.indexOf(this);
      if (index >= 0) list.splice(index, 1);
    },
  });
  return {
    document: {
      documentElement,
      createElement,
      head: { append(node) { head.push(node); } },
      body: { prepend(node) { body.unshift(node); } },
    },
    documentElement,
    head,
    body,
  };
}

test("the desktop chrome is an official DSH Client Bundle", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
  const patch = readFileSync(new URL("cordis.patch.yml", packageRoot), "utf8");
  const source = readFileSync(new URL("src/client/index.js", packageRoot), "utf8");
  const built = readFileSync(new URL("lib/client.js", packageRoot), "utf8");

  assert.equal(manifest.name, "@vibeinging/dsh-desktop-chrome");
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal(manifest.exports["./client"], "./lib/client.js");
  assert.equal(manifest.dshWork.portability.level, "desktop-adapter");
  assert.deepEqual(manifest.dshWork.portability.hostRequirements, []);
  assert.match(patch, /id: dsh-desktop-chrome/);
  assert.match(source, /export function apply\(ctx\)/);
  assert.match(built, /^window\.__ModuleLoader__\.load\(\{/);
  assert.match(built, /id: "@vibeinging\/dsh-desktop-chrome"/);
  assert.match(built, /const overlayMargin = 12/);
  assert.match(built, /body > \[role="menu"\]/);
  assert.match(built, /return \{ apply, inject \};/);
  assert.doesNotMatch(built, /\bexport\s/);
});

test("the compact title bar only activates in macOS Electron", () => {
  assert.equal(supportsIntegratedDesktopChrome({
    userAgent: "Mozilla/5.0 Electron/42.4.1",
    platform: "MacIntel",
  }), true);
  assert.equal(supportsIntegratedDesktopChrome({
    userAgent: "Mozilla/5.0 Chrome/142.0.0.0",
    platform: "MacIntel",
  }), false);
  assert.equal(supportsIntegratedDesktopChrome({
    userAgent: "Mozilla/5.0 Electron/42.4.1",
    platform: "Win32",
  }), false);
});

test("the title bar reserves one compact drag strip and cleans up with the Client lifecycle", () => {
  const fake = fakeDocument();
  const dispose = installDesktopChrome({
    document: fake.document,
    navigator: { userAgent: "Electron/42.4.1", platform: "MacIntel" },
  });

  assert.equal(DESKTOP_TITLEBAR_HEIGHT, 36);
  assert.equal(DESKTOP_OVERLAY_MARGIN, 12);
  assert.equal(fake.documentElement.dataset.dshDesktopChrome, "mac");
  assert.equal(fake.head.length, 1);
  assert.equal(fake.body.length, 1);
  assert.equal(fake.body[0].id, DESKTOP_TITLEBAR_ID);
  assert.equal(fake.body[0].attributes["aria-hidden"], "true");
  assert.match(desktopChromeCss, /#root[\s\S]*padding-top: 36px/);
  assert.match(desktopChromeCss, /\[data-dsh-panel\][\s\S]*padding-top: 36px/);
  assert.match(desktopChromeCss, /\[data-dsh-toggle-cluster\][\s\S]*top: 39px/);
  assert.match(desktopChromeCss, /body > \[role="menu"\][\s\S]*max-height: calc\(100dvh - 60px\)/);
  assert.match(desktopChromeCss, /-webkit-app-region: drag/);

  dispose();
  assert.equal(fake.documentElement.dataset.dshDesktopChrome, undefined);
  assert.equal(fake.head.length, 0);
  assert.equal(fake.body.length, 0);
});

test("ordinary official Web keeps its original DOM", () => {
  const fake = fakeDocument();
  const dispose = installDesktopChrome({
    document: fake.document,
    navigator: { userAgent: "Chrome/142.0.0.0", platform: "MacIntel" },
  });
  assert.equal(fake.head.length, 0);
  assert.equal(fake.body.length, 0);
  assert.deepEqual(fake.documentElement.dataset, {});
  dispose();
});

test("Electron only selects integrated chrome from the authoritative enabled Client graph", () => {
  assert.equal(desktopChromeEnabled({
    plugins: [{
      id: "@vibeinging/dsh-desktop-chrome",
      enabled: true,
      ui_runtime: { client_graph: true },
    }],
  }), true);
  assert.equal(desktopChromeEnabled({
    plugins: [{
      id: "@vibeinging/dsh-desktop-chrome",
      enabled: false,
      ui_runtime: { client_graph: false },
    }],
  }), false);
  assert.equal(desktopChromeEnabled({ plugins: [] }), false);
});

test("new Profile initialization completes before desktop chrome reads the Client graph", async () => {
  const calls = [];
  const data = await resolveDesktopClientSurface({
    async waitForClientLaunchUrl() {
      calls.push("client-launch-url");
      return "http://127.0.0.1:3000/?token=launch-token";
    },
    async readProfileState() {
      calls.push("profile-state");
      return {
        plugins: [{
          id: "@vibeinging/dsh-desktop-chrome",
          enabled: true,
          ui_runtime: { client_graph: true },
        }],
      };
    },
  });

  assert.deepEqual(calls, ["client-launch-url", "profile-state"]);
  assert.deepEqual(data, {
    url: "http://127.0.0.1:3000/?token=launch-token",
    desktop_chrome: true,
  });
});
