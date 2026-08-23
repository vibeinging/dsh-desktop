<h1 align="center">DSH Desktop</h1>

<p align="center">
  <strong>A curated DSH plugin distribution for desktop.</strong><br>
  It runs official Web unchanged and composes community plugins, product tools, and controlled native capabilities through a Profile.
</p>

<p align="center"><sub>An independent, community-maintained open-source project with no affiliation, partnership, authorization, or endorsement from DeepSeek.<br>English · <a href="README.md">中文</a> · <a href="README.anime.md">Anime README</a></sub></p>

<p align="center">
  <a href="https://github.com/vibeinging/dsh-desktop"><img src="https://img.shields.io/github/stars/vibeinging/dsh-desktop?style=flat&amp;label=stars&amp;color=2563EB" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat" alt="Electron runtime">
  <img src="https://img.shields.io/badge/interface-official%20DSH%20Web-2563EB?style=flat" alt="Official DSH Web">
  <img src="https://img.shields.io/badge/status-preview-F59E0B?style=flat" alt="Preview status">
</p>

<p align="center">
  <img src="docs/images/readme/dsh-community-task-board.png" alt="Community task board loaded through the official Profile in DSH Desktop" width="100%">
</p>

DSH Desktop is a community-maintained Electron desktop distribution. It pins and runs the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) npm runtime, bringing `dsh-web-app`, Session, Agent, Tool, Skill, MCP, and Profile Bundles into one local app. The project does not modify DSH source code or maintain a second Chat, home, settings, or plugin center. Its focus is not another similar interface, but a reproducible, removable, and recoverable desktop workspace composed from reviewed community plugins and independent product Bundles.

This repository has not released a signed installer. The verified artifact is an unsigned macOS Apple Silicon directory build; the Windows signed installer, macOS Developer ID and notarization, native Intel x64, and a formal DeepSeek live-model receipt bound to a signed artifact remain release acceptance items.

## Why this distribution

This project and [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) are both independent community Electron distributions. Both run official DSH Web, follow Profile composition, and avoid exposing Electron APIs directly to pages. The difference is not which one is “more official,” but the product tradeoff:

| Dimension | This repository | anywhere-labs DSH Desktop |
| --- | --- | --- |
| Primary goal | Curate, review, and verify a composable set of DSH Bundles, preferring community plugins | Provide a complete desktop Shell and a cross-platform client ready for direct download |
| DSH integration | Uses only a pinned official npm runtime and SDK, with no DSH source checkout | Pins the official DSH source as a submodule inside an outer Yarn project, with desktop code concentrated in `dsh-plugin-desktop` |
| Interface strategy | Official Web is the only primary interface; even the desktop safe bar is a regular `dshClient` Bundle, with no second Renderer | Offers compatible and advanced presentation modes; advanced mode can install a Desktop-owned layout, frame, and native materials |
| Default experience | Bundles community `dshmarket`, task-board, file/folder attachment input, plus independent Git Worktree, Project, Canvas/Site, Structured UI, Office, and model-inheritance Bundles | Bundles a unified Desktop plugin, terminal, tray, Profile, updater, and DSH Community Market; mobile remote control is listed as future work |
| Native boundary | Feature Bundles consume only Session-bound method allowlists; plugin installation still ends in the official DSH CLI | The third-party surface is similarly narrowed to `desktopProfiles` and `desktopPnpm`, while other native capabilities stay inside Desktop-owned plugins |
| Current maturity | Preview; real macOS arm64 Electron and plugin lifecycles are verified, but no signed installer has been released | Provides formal Windows x64 and macOS Universal installers, with a more mature download experience |

If you only want to download a mature desktop client today, the anywhere-labs project is the better fit. If you care about one official Web interface, community-first adoption, reproducible offline initialization for new Profiles, fine-grained product-tool Bundles, and per-capability release evidence, this repository follows a different path. See the [source-backed comparison](docs/research/2026-08-22_dsh-desktop-distribution-differences.md) for details.

## Key capabilities

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Official DSH Web on desktop</h3>
      <p>Electron starts a local DSH Web Profile and manages the window, service startup, shutdown, and recovery. The main window loads the official Client graph directly, without the legacy Renderer or a product preload.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Default plugin market</h3>
      <p><code>dshmarket@1.17.1</code> mounts in the official settings Slot and provides discovery, compatibility diagnostics, installation, updates, and removal. The market, settings page, and command line read and write the same Profile.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Community-first curated workbench</h3>
      <p>The default uses the community task-board, dshmarket, and attachment-input plugin instead of rebuilding them in the Shell. Every release is pinned to a reviewed tarball and independently tested for installation, disabling, official removal, and restart recovery.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Product capabilities are Bundles</h3>
      <p>Git Worktree, Project, Conversation, Canvas/Site, Structured UI, Office, and model inheritance live in separate Bundles. Feature code imports neither Electron nor general IPC, so a Host provider can be replaced later without rewriting the Tools.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Narrow native Host</h3>
      <p>Window, file authorization, Browser Workspace, and update capabilities are exposed only through method allowlists and Session binding. Third-party Clients cannot access Electron, Node, or general IPC.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Offline initialization and recovery</h3>
      <p>A new Profile initializes atomically from pinned artifacts and the packaged pnpm runtime; existing Profiles remain unchanged during updates. Startup failures open recovery instead of a blank page or silently restoring plugins the user removed.</p>
    </td>
  </tr>
</table>

## Current interface

### Official Sessions, questions, and approvals

![Official DSH Web Session](docs/images/readme/dsh-official-web-session-loopback.png)

This screenshot comes from a normal user conversation with real DeepSeek-V4-Flash in the current packaged macOS arm64 Electron app. The showcase flow still verifies a non-empty `assistant/message`, `source.kind=model`, `provider=deepseek-official`, and `turn/end(completed)` through official `session.history`, but does not put a test UUID in the interface; the separate release smoke still requires a unique receipt marker. The key is injected only into the temporary process and is written to neither the Profile nor the screenshot. Because the current App is still an unsigned directory build, this development check does not replace a release receipt bound to a formally signed artifact.

### Plugin market in official settings

![Default plugin market in official Web settings](docs/images/readme/dsh-plugin-market.png)

The market mounts as an independent Client Bundle in the official settings Slot. The screenshot proves that the page and community catalog load; a separate packaged lifecycle test verifies installation, disabling, official removal, and restart recovery after removal.

### Git Worktree in an official Workspace

![Git Worktree Bundle in official Web](docs/images/readme/dsh-worktree-official-web.png)

Worktree is not the retired Renderer's project-settings page. It is an independently installable portable Bundle: the Host derives the Git main checkout only from the current DSH Session's fixed `cwd`; the Client contributes through the official `sidebar.footer.action`, `shell.overlay`, and `conversation.view` Slots and opens isolated Sessions through official Workspaces. The screenshot comes from the fixed-tarball installation in packaged macOS arm64 Electron; the same smoke also verifies disabling, official removal, and restart recovery after removal.

## Quick start

Local development requires Node.js 24 or later:

```bash
git clone https://github.com/vibeinging/dsh-desktop.git
cd dsh-desktop
npm install
npm run doctor
npm run dev:electron
```

macOS Apple Silicon directory build:

```bash
npm run package:mac:dir
open "release/mac-arm64/DSH Desktop.app"
```

This command creates an unsigned development build, not a signed installer ready for distribution.

## Plugin ecosystem

The DSH Profile is the sole authority for plugin state. A new Profile installs the default Bundles atomically through the official `dsh plugin --profile web` command. Existing Profiles remain read-only during app updates: the app does not restore, remove, or rewrite user choices. Bundles disabled or removed by the user stay disabled or removed after restarts and upgrades.

Most users can open **Settings → Plugin Market**. The command line uses the same Profile:

```bash
dsh plugin --profile web add -w <package>@<exact-version> --save-exact --ignore-scripts
dsh plugin --profile web remove <package>
```

New Profiles install the fixed `dshmarket@1.17.1` release by default. The distribution includes a reviewed fixed tarball, its complete runtime dependency closure, and SHA-256 values; default initialization needs no npm network access and runs no upstream lifecycle scripts. Browsing the market reaches the community catalog, while installation and updates may reach npm or GitHub. WebDAV and Gist are used only after explicit user configuration. A plugin appearing in the market is not necessarily bundled or approved for the distribution.

New Profiles also install `dsh-multimedia-webui-input@0.1.0`. It contributes a file/folder picker through the official `conversation.input.left`, `conversation.input.dock`, `conversation.input.overlay`, and `settings.section` Slots. Files are copied into the active Session workspace only when the message is sent. Official DSH remains responsible for image paste and drop; the bundled adaptation removes the upstream generic drop listeners so images cannot enter both paths. The plugin does not modify official Chat or receive Electron or general IPC access. Enabling another attachment-input plugin at the same time may create duplicate buttons or uploads, so the default Profile keeps a single attachment surface.

On the desktop side, `@vibeinging/dsh-desktop-profile-host` exposes only two public structural services: `desktopProfiles` and `desktopPnpm`. The market delegates user-confirmed operations to the packaged pnpm runtime and the official DSH CLI; it cannot acquire Electron permissions or restart the app itself.

<details>
<summary>View the 13 Bundles installed in a new Profile</summary>

<!-- featured-plugins:start -->
| Default Bundle | Type | Declared permissions | Official management | Source |
|---|---|---|---|---|
| `@vibeinging/dsh-work-product-host-ipc` | desktop-adapter | dsh-work-parent-ipc, browser-workspace-host, file-dialog-host, window-host | desktop foundation; uninstall is not offered | [local package](packages/dsh-work-product-host-ipc) |
| `@vibeinging/dsh-desktop-profile-host` | desktop-adapter | dsh-profile-filesystem, controlled-pnpm-runtime, dsh-cli-runtime | desktop foundation; uninstall is not offered | [local package](packages/dsh-desktop-profile-host) |
| `@vibeinging/dsh-desktop-chrome` | desktop-adapter | no Host permission | `dsh plugin --profile web remove @vibeinging/dsh-desktop-chrome` | [local package](packages/dsh-desktop-chrome) |
| `@vibeinging/dsh-project-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-project-tools` | [local package](packages/dsh-project-tools) |
| `@vibeinging/dsh-canvas-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-canvas-tools` | [local package](packages/dsh-canvas-tools) |
| `@vibeinging/dsh-structured-ui-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-structured-ui-tools` | [local package](packages/dsh-structured-ui-tools) |
| `@vibeinging/dsh-model-inheritance` | portable | no Host permission | `dsh plugin --profile web remove @vibeinging/dsh-model-inheritance` | [local package](packages/dsh-model-inheritance) |
| `@vibeinging/dsh-product-bridge` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-product-bridge` | [local package](packages/dsh-product-bridge) |
| `@vibeinging/dsh-office-tools` | desktop-adapter | office-artifact-host | `dsh plugin --profile web remove @vibeinging/dsh-office-tools` | [local package](packages/dsh-office-tools) |
| `@vibeinging/dsh-client-ui-worktree` | portable | no Host permission | `dsh plugin --profile web remove @vibeinging/dsh-client-ui-worktree` | [local package](packages/dsh-worktree) |
| `@linxin666/dsh-client-ui-task-board` | portable | read current DSH Session, Workspace, and completion history, write task ledger and run records under DSH_HOME, start DSH Session tasks from user actions or Host cron, optionally start a fixed cross-platform sleep-prevention helper | `dsh plugin --profile web remove @linxin666/dsh-client-ui-task-board` | [upstream repository](https://github.com/zhu1090093659/dsh-web-ui) |
| `dsh-multimedia-webui-input` | portable | read files and folders explicitly selected by the user, write attachments under .dsh/tmp/attachments in the active Session workspace, remove only plugin-owned attachment directories after a second user confirmation | `dsh plugin --profile web remove dsh-multimedia-webui-input` | [upstream repository](https://github.com/LCYLYM/dsh-attachments) |
| `dshmarket` | portable | read and modify dependencies, Bundle order, and enabled state in the active DSH Profile, install, update, and remove user-confirmed plugins through controlled pnpm, access the plugin catalog, npm, GitHub, and user-configured WebDAV or Gist services, export or import backups that contain Profile configuration | `dsh plugin --profile web remove dshmarket` | [upstream repository](https://github.com/dsh-market/dsh-market) |
<!-- featured-plugins:end -->

</details>

## Developing plugins

App capabilities are split into two boundary types:

- A `portable` Bundle uses only official DSH services and can be installed in a compatible official Web Profile.
- A `desktop-adapter` Bundle uses the narrow Host contract provided by DSH Desktop and should report the missing capability directly when used outside the desktop host.

First-party Bundles live in [`packages/`](packages/). Prefer existing community plugins for new capabilities; add an independent Bundle only when the community has no reviewable implementation. Plugins must not modify official DSH source code directly or bypass the Profile by storing a second installation state.

For the plugin market integration, permissions, and offline boundary, see [Plugin market selection and desktop integration](docs/research/2026-08-22_dsh-plugin-market-selection.md). For the complete architecture and release sequence, see the [distribution migration plan](docs/plans/2026-08-20_dsh-app-发行版转型最终方案.md).

## Data and security

- Profiles, Sessions, and local runtime data are stored under `~/.dsh` by default; opening history does not upload that data automatically.
- Official Web `webContents` has no product preload, Node access, or general IPC.
- If Profile or Client startup fails, the app opens a local recovery page instead of showing a blank window or silently changing the original Profile.
- The recovery page can retry, start a safe Profile containing only the official `base` and `web-app`, open directories, remove a specified plugin after confirmation, and export filtered diagnostics.
- Project code, third-party Bundles, and visual assets each follow their own licenses and redistribution terms.

See the [privacy notice](PRIVACY.md), [security policy](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Development and verification

Common checks:

```bash
npm run test:release
npm run typecheck
npm run check:release-boundary
npm run check:release-artifacts
npm run check:release:budgets
npm run measure:featured-plugins
```

The latest local verification passed 175 of 178 release tests, with 3 conditional skips and no failures. All 12 default Bundles passed per-package Profile installation and lifecycle measurement. `dshmarket`, the task board, and Worktree also passed activation, disabling, official removal, and restart recovery in the current packaged macOS arm64 Electron app. A real DeepSeek-V4-Flash development smoke also passed official Web, Session history, provider-origin, and complete-response checks.

This evidence does not replace macOS Developer ID, notarization, a Windows signed installer, native Intel x64, or a live-model receipt bound to a formally signed artifact. Until the repository publishes a formal Release, the unsigned directory build is not described as a downloadable distribution.

## Related projects

| Project | Relationship |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Provides the core Agent, Session, Tool, Skill, MCP, Profile, and official Web |
| [Cordis](https://github.com/cordiverse/cordis) | Provides the plugin foundation |
| [dsh-market](https://github.com/dsh-market/dsh-market) | The visual plugin market bundled by default |
| [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | Upstream community repository for the current task board |
| [DSH Desktop by anywhere-labs](https://github.com/anywhere-labs/deepseek-harness-desktop) | An independent community distribution focused more on a complete desktop Shell, cross-platform installers, and direct downloads; see the comparison above |
| [dshfind](https://www.dshfind.com/en) | A community for learning, sharing, and discovering DSH plugins |

<p align="center"><a href="https://www.dshfind.com/en"><img src="https://dshfind.com/api/badge/vibeinging/dsh-work?lang=en" alt="dshfind listing card"></a></p>

## Relationship to DeepSeek Harness

DSH Desktop is an independent community project built on DeepSeek Harness and the Cordis plugin model. Upstream provides the core runtime, plugin system, and Web UI; this project provides the Electron wrapper, offline initialization for new Profiles, curated community Bundles, narrow native Host, recovery page, and desktop release verification.

This project has no affiliation, partnership, authorization, or endorsement from DeepSeek. “DeepSeek Harness” is used only to describe compatibility and technical origins accurately.

## License

Project code is available under the [MIT License](LICENSE). Sources and distribution terms for third-party components, fixed tarballs, native binaries, and visual assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
