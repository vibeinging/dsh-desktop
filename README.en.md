# DSH Desktop

[中文](README.md)

DSH Desktop is a community-maintained Electron distribution of DeepSeek Harness (DSH). It runs the official DSH Web, Profile, Session, Agent, Tool, Skill, and MCP runtime locally. The main window shows only the official `dsh-web-app`; this project does not maintain a second Chat, home, settings, or plugin-center surface.

Profiles, Sessions, and local runtime data are stored under `~/.dsh` by default. Opening history does not upload that data automatically.

## Use and development

A packaged build includes the DSH Web runtime, fixed tarballs for the curated Bundles, and a controlled pnpm runtime. A new user does not need system Node.js, pnpm, npm login, or a first-run network download.

Development requires Node.js 24 or later:

```bash
npm install
npm run doctor
npm run dev:electron
```

Build and release-boundary checks:

```bash
npm run check:release-boundary
npm run release:check:static
npm run package:mac:dir
npm run check:release-artifacts
npm run check:release:budgets
npm run smoke:official-web
npm run smoke:official-web:flow
npm run smoke:official-web:interactions
npm run smoke:updater
npm run smoke:browser-workspace
npm run test:release
npm run test:release:community
# Save the real community task-board Electron screenshot
DSH_COMMUNITY_SCREENSHOT_DIR=/path/to/evidence npm run test:release:community
```

## Profile and plugin state

The DSH Profile is the sole authority for plugin state. Startup, status queries, and application updates read the existing `dsh.profile.bundles`, dependencies, and patches. They do not restore, isolate, delete, or rewrite the user's choices. A Bundle disabled or removed by the user stays removed across restarts, application updates, and curated-list changes.

Only a new Profile is initialized in an isolated directory through the official `dsh plugin --profile web` commands. Install, update, and removal use the official DSH Profile commands with fixed tarballs, verified SHA-256 values, and the bundled pnpm runtime.

There is one curated input: [featured_plugins.json](server/src/engine/dsh_runtime/featured_plugins.json). It generates packaged tarballs, new-Profile installation input, permission summaries, third-party notices, and test expectations. Other code and documentation do not maintain another default package list.

The default set contains seven non-UI Bundles. Host, portable, and desktop-adapter capabilities enter through the official Profile without replacing the official Web page. First-party packages use the `@vibeinging/*` scope; official DSH SDK packages keep the `@deepseek-ai/*` scope.

## Optional plugins

The app does not create a second installation state. Discovery, installation, disabling, updating, and removal return to the official Profile commands or the official Web plugin-management surface.

Our portable candidate:

This package is currently maintained as a source candidate. Before it is published to npm, preflight it locally through the same official Profile commands:

```bash
dsh plugin --profile web add -w /path/to/dsh-work-references --save-exact --ignore-scripts
dsh plugin --profile web remove @vibeinging/dsh-work-references
```

It provides bounded relative file references under the current DSH Session workspace and never accepts an absolute path from the browser.

The independent community UI candidate `@linxin666/dsh-client-ui-task-board@0.1.20` has passed fixed-version network installation, official Web activation, real Electron startup, task-board entry and five-column board configuration checks, official removal, and restart checks. It remains optional and is not in the default curated set. Set `DSH_COMMUNITY_SCREENSHOT_DIR=/path` to save a real Electron board screenshot:

```bash
dsh plugin --profile web add -w @linxin666/dsh-client-ui-task-board@0.1.20 --save-exact --ignore-scripts
dsh plugin --profile web remove @linxin666/dsh-client-ui-task-board
```

`@linxin666/dsh-web-ui-all` is used only for conflict experiments and is not a release input. Better Sidebar, remote Web, SSH, image understanding, Agent presets, and community plugin managers are not in the default Profile. A community package does not enter the curated set without a fixed source, dependency review, real Electron evidence, and uninstall evidence.

The Skin Center and its `@linxin666/dsh-skins` dependency are not distributed with the app. A package-level Apache-2.0 license does not automatically cover every built-in visual asset; the upstream package identifies Maid Atelier assets as CC BY-NC-SA 4.0, so they cannot enter the release package without separate redistribution permission. The decision is recorded in the [community plugin registry](server/src/engine/dsh_runtime/community_plugin_registry.json), and the release boundary rejects unapproved visual assets from the curated set. The Skin Center can be reconsidered only after every asset has a verified license, attribution, and redistribution condition.

## Electron native boundary

The `webContents` that hosts the official Web has no product preload, Node access, or general IPC. The Electron main process retains only narrow native Host services for windows, updates, file authorization, and Browser Workspace. Browser navigation, tabs, downloads, history, find-in-page, zoom, page capture, and permission requests use an allowlisted method set, Session binding, and boundary validation. A third-party Client cannot access Electron objects or the Node filesystem.

## Startup recovery

When the DSH child, Profile parsing, or Client startup fails, the app opens a local recovery page instead of showing a blank window or silently changing the original Profile. The page supports retrying the original Profile, starting a safe Profile containing only the official `base` and `web-app` without modifying the original, opening the Profile directory, removing a named plugin after explicit confirmation, and exporting filtered diagnostics.

Diagnostics are bounded and omit environment variables, credentials, Session content, user-file content, and full stacks. The latest failure stage and action result are stored in restricted local recovery state to avoid an endless restart loop.

## Evidence levels

Source inspection and unit tests do not substitute for real release evidence. The repository keeps these levels separate:

- Source and Profile integration: official Web composition, read-only existing Profiles, fixed tarballs, offline initialization, and permission projection tests;
- Real Electron: official Web startup without preload, workspace, Session, Session log, history user flow, community task-board entry/five-column board/activation inside the official Web root, and Browser Workspace WebContentsView smoke. `smoke:official-web:flow` uses a temporary user directory without an API key and can save an official Web screenshot with `DSH_SCREENSHOT_DIR=/path npm run smoke:official-web:flow`; `DSH_COMMUNITY_SCREENSHOT_DIR=/path npm run test:release:community` saves a real task-board screenshot; `smoke:official-web:interactions` uses a loopback SSE test model inside the same packaged Electron run to drive the official LLM adapter, the question card, bash sandbox denial/escalation, approval panel, QueueDock, and Session history, and saves question/approval/queue screenshots with `DSH_SCREENSHOT_DIR=/path npm run smoke:official-web:interactions`; it verifies the official runtime and UI contracts but does not replace live-model evidence against the real DeepSeek service; `smoke:updater` also exercises update metadata, fixed-hash download, Profile preflight, temporary app replacement, and history replay through a local HTTPS feed, but complete replacement requires a Developer ID-signed package;
- Packaged app: `package:mac:dir` creates the packaged directory and `smoke:official-web` checks the packaged official Web. On the current machine Electron's Viz compositor cannot provide a WebContentsView screenshot, so the Browser Workspace smoke reports `compositor-unavailable` explicitly rather than treating the screenshot as passed. Signing, notarization, Windows hardware acceptance, and clean-user update/uninstall recovery remain gates for their release environments.

See the [distribution migration plan](docs/plans/2026-08-20_dsh-app-发行版转型最终方案.md), [privacy notice](PRIVACY.md), [security policy](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
