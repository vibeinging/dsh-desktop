<h1 align="center">DSH Desktop</h1>

<p align="center">
  <strong>DSH Desktop Bundle Edition — official DSH Web, community plugins, and desktop capabilities in one ready-to-use app.</strong><br>
  Conversations, files, Git, terminals, tasks, Worktrees, and the plugin market share one DSH Profile.
</p>

<p align="center"><a href="README.md">中文</a></p>

<p align="center">
  <a href="https://dshdesktopstation.com/"><img src="https://img.shields.io/badge/website-dshdesktopstation.com-8B5CF6?style=flat" alt="Official website"></a>
  <a href="https://github.com/vibeinging/dsh-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/vibeinging/dsh-desktop?display_name=tag&amp;style=flat&amp;color=2563EB" alt="Latest release"></a>
  <a href="https://github.com/vibeinging/dsh-desktop"><img src="https://img.shields.io/github/stars/vibeinging/dsh-desktop?style=flat&amp;label=stars&amp;color=2563EB" alt="GitHub stars"></a>
  <a href="https://dshfind.com/en/plugins/vibeinging/dsh-desktop?ref=badge"><img src="https://dshfind.com/api/badge/vibeinging/dsh-desktop?lang=en" alt="dshfind"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-0.1.5--rc.1-7C3AED?style=flat" alt="DSH 0.1.5-rc.1">
  <img src="https://img.shields.io/badge/plugins-Profile%20Bundles-2563EB?style=flat" alt="Profile Bundles">
</p>

<p align="center">
  <img src="docs/images/readme/dsh-community-task-board.png" alt="DSH Desktop main interface" width="100%">
</p>

DSH Desktop (Bundle Edition) is a community-maintained desktop distribution. It runs the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) npm runtime and `dsh-web-app` directly, with a curated set of pinned community Bundles. There is no second Chat implementation or separate plugin database to maintain: the app starts from one official DSH Profile.

[Website](https://dshdesktopstation.com/) · [Download the latest release](https://github.com/vibeinging/dsh-desktop/releases/latest) · [Mobile remote](https://dshdesktopstation.com/en/remote/) · [Get started](#getting-started) · [Install plugins](#installing-more-plugins)

## Download

| Platform | Install | Status |
| --- | --- | --- |
| macOS Apple Silicon | Download the `.dmg` and drag it to Applications | Developer ID signed and Apple notarized |
| Windows x64 | Download the `.exe`, then choose the install scope and app directory | Use the artifacts published on the current [Release](https://github.com/vibeinging/dsh-desktop/releases/latest) page |
| macOS Intel / Linux | No formal installer yet | Run from source |

Direct download links and file sizes are listed on the [website download page](https://dshdesktopstation.com/#download); first-run questions (Gatekeeper, SmartScreen, API keys, slow downloads) are covered in the [website FAQ](https://dshdesktopstation.com/#faq).

The app directory contains only the installed application. Profiles, plugins, Sessions, and other DSH data use a separate data directory; changing the app location does not move or delete that data.

## Ready on first launch

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Official conversations and Agents</h3>
      <p>The main window is official DSH Web. DSH owns Sessions, Agents, Tools, Skills, MCP, settings, and history; the app does not maintain a second Chat surface.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Better Sidebar workbench</h3>
      <p>Files, code and Markdown editing, Git, terminals, web pages, and extension tabs are built in. Version 0.18.0-alpha.0 targets the current alpha SDK while retaining multi-repository and Worktree support, Vue editing, and local Markdown images.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Plugin market</h3>
      <p>Discover, install, update, disable, and remove plugins from official settings. The UI, CLI, and app restart all use the same Profile state.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Tasks, attachments, and Worktrees</h3>
      <p>A task board, file and folder attachments, Git Worktrees, project tools, Office output, and structured results are independent Bundles that can be composed as needed.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Desktop Host and recovery</h3>
      <p>The app owns windows, native file selection, updates, startup, and recovery. Formal builds ask before downloading, check the Profile, and install; Profile or Client failures open recovery.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Reproducible defaults</h3>
      <p>New Profiles initialize offline from pinned packaged artifacts. Normal startup does not rewrite an existing Profile or silently restore plugins the user removed.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Mobile remote access</h3>
      <p>After signing in and enabling this computer, continue the same Workspace and Session from Android, Remote Web, or another Desktop. The Host creates outbound connections only and opens no public listening port.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Explicit service boundary</h3>
      <p>A third-party service currently provides accounts, the device directory, signaling, and relay. See the <a href="https://dshdesktopstation.com/en/remote/">mobile remote guide</a> for connection methods, security boundaries, and removal.</p>
    </td>
  </tr>
</table>

## Interface

### Conversations, questions, and approvals

![Official DSH Web Session](docs/images/readme/dsh-official-web-session-loopback.png)

Conversations, tool approvals, question cards, queued messages, and history replay stay in the official Session.

### Plugin market in official settings

![Plugin market in official Web settings](docs/images/readme/dsh-plugin-market.png)

The market uses the official settings Slot. It neither replaces settings nor creates a second plugin database.

### Git Worktree workspace

![Git Worktree in official Web](docs/images/readme/dsh-worktree-official-web.png)

Create an isolated Worktree from the active Session directory and open an official Session for the new workspace.

## Bundled by default: mobile remote access

New Profiles include the exactly pinned [`ds-harness-remote@0.4.1`](https://github.com/liguobao/ds-harness-remote/tree/v0.4.1), shipped alongside the DSH `0.1.5-rc.1` trial line. Open Remote in the sidebar, sign in, and enable remote access for this computer. You can then use [Remote Web](https://dsh.r2049.cn/app), the Android app, or another Desktop to open the same Host Workspaces and Sessions, continue conversations, send images, and respond to permission requests.

- **Network boundary**: the Host creates outbound connections only and opens no public listening port; Remote tries LAN, P2P, TURN, and Relay in order, and every path carries Noise IK encrypted application traffic.
- **Account and data**: the default currently uses the third-party `dsh.r2049.cn` account, device directory, signaling, and relay service; device identity and credentials stay under `DSH_HOME`. Remote access is unavailable until you sign in and enable the current computer.
- **Authorized devices**: they control the Harness through a fixed API allowlist while the Agent can still run tools under its normal permissions; no direct Shell, PTY, or general file RPC is exposed.
- **Removal**: existing Profiles receive this default once after an upgrade; disabling or removing it prevents later app updates from restoring it.

```bash
dsh plugin --profile web remove ds-harness-remote
```

> The project does not yet provide a supported self-hosted Server, and its independent cryptographic review, real cross-network two-device coverage, and long-running stability validation remain incomplete. Remove the Bundle if remote access is not needed. The desktop package applies a SHA-256-bound compatibility projection to that fixed tarball without modifying official DSH or the upstream repository source. See the [remote access guide](https://dshdesktopstation.com/remote/) for connection, security, and removal details.

Special thanks to [DeepSeek Harness Remote Web](https://dsh.r2049.cn/app) for providing the remote entry point and supporting services currently available to the community, allowing DSH Desktop users to continue working from a phone or browser.

## Bundled by default: conversation window teams

New Profiles include [`@vibeinging/dsh-session-teams@0.1.1`](https://github.com/vibeinging/dsh-session-teams). It lets DSH conversation windows collaborate directly:

- **Message another window**: tell the current window "hand this to `window name`", and the message lands as a real DSH message in the target window — visible there, durable, and clickable back to its source.
- **Make a window the captain**: create a set of role windows, assign them tasks and dependencies, let members report back as real messages, and adjust work in plain language without tracking IDs.

All team and window state is read and written through the official Session API in the current Profile; the plugin opens no external network connections. Remove it when not needed:

```bash
dsh plugin --profile web remove @vibeinging/dsh-session-teams
```

## Why this route

| Concern | DSH Desktop approach |
| --- | --- |
| Depending on a private front end | Load official Web and the official npm runtime directly, without a private Chat fork |
| Using community plugins | UI, Tools, and workflows keep using official Bundles, Services, and Slots |
| Avoiding split plugin state | The official Profile is the sole authority for the market, settings, and CLI |
| Trusting the defaults | Pin versions, integrity, permissions, dependencies, licenses, and offline artifacts |
| Limiting native access | Files, windows, and Browser Workspace use a small Session-bound method surface |
| Preserving configuration at startup | Existing Profiles keep user choices; failures preserve the Profile and open recovery |
| Preserving plugins during app updates | A read-only Profile check runs first; disabled or removed Bundles are not restored |

Electron is a thin desktop Host. Agents, Sessions, and the plugin system remain in DSH, while product capabilities are Bundles whenever possible. Portable plugins can therefore serve compatible official Web Profiles and DSH Desktop; only operating-system features require an explicit `desktop-adapter`.

## Getting started

1. Download a supported installer from [Releases](https://github.com/vibeinging/dsh-desktop/releases/latest).
2. Start the app and choose a working directory or create a Session directly.
3. Open files, Git, or a terminal from the sidebar, and attach files or folders from the composer.
4. Open **Settings → Plugin Market** when you need more capabilities.

Model credentials are managed by DSH settings and the local environment. API keys are never written to this README, screenshots, or the plugin manifest.

## Installing more plugins

Most users should use **Settings → Plugin Market**. The market shows source, version, compatibility, and permissions. A visible listing is not automatically reviewed or bundled by this project, so inspect upstream documentation before installation.

The official CLI operates on the same Profile:

```bash
dsh plugin --profile web add -w <package>@<exact-version> --save-exact --ignore-scripts
dsh plugin --profile web remove <package>
```

A plugin that follows the official DSH Bundle and `dshClient` contracts does not need a DSH Desktop rewrite. Plugins that require windows, native dialogs, or Browser Workspace must explicitly use the narrow desktop Host and report missing capabilities in other hosts.

### Optional example: skin center

![DSH Desktop running the Blue Fantasy dark skin from the skin center](docs/images/readme/dsh-skin-blue-fantasy-applied.png)

The app keeps the official Web look by default. For a personalized interface, install the community-maintained [skin center](https://github.com/zhu1090093659/dsh-web) (`@linxin666/dsh-client-ui-skin-center`) from the plugin market: dozens of skins can be tried instantly, applied to disk, and reverted to the official look at any time.

```bash
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
```

Skin assets carry their own upstream licenses (some CC BY-NC-SA or including character copyrights), so the skin center is not bundled by default; users opt in via the plugin market.

### Default plugins

New Profiles include Better Sidebar, dshmarket, the task board, attachment input, Git Worktree, mobile remote access, session window teams, project tools, Canvas, Office output, structured results, and model inheritance. Every manageable Bundle can be disabled or removed.

<details>
<summary>View the 16 Bundles installed in a new Profile</summary>

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
| `@linxin666/dsh-client-ui-task-board` | portable | read current DSH Session, Workspace, and completion history, write task ledger and run records under DSH_HOME, start DSH Session tasks from user actions or Host cron, optionally start a fixed cross-platform sleep-prevention helper | `dsh plugin --profile web remove @linxin666/dsh-client-ui-task-board` | [upstream repository](https://github.com/zhu1090093659/dsh-web) |
| `ds-harness-remote` | portable | connect to the external dsh.r2049.cn account, device directory, signaling, TURN, and Relay services, allow authorized Web, Android, or Desktop devices on the same account to read and control the current Harness Workspace, Session, models, permissions, settings, and credential writes, store long-lived X25519 device identity keys and device credentials under DSH_HOME, serve remote requests through a fixed Harness API allowlist without direct Shell, PTY, or general file RPC; the Harness Agent can still run tools under its normal permissions | `dsh plugin --profile web remove ds-harness-remote` | [upstream repository](https://github.com/liguobao/ds-harness-remote) |
| `dsh-multimedia-webui-input` | portable | read files and folders explicitly selected by the user, write attachments under .dsh/tmp/attachments in the active Session workspace, remove only plugin-owned attachment directories after a second user confirmation | `dsh plugin --profile web remove dsh-multimedia-webui-input` | [upstream repository](https://github.com/LCYLYM/dsh-attachments) |
| `dsh-better-sidebar` | portable | read, search, create, modify, and delete files in the current Session workspace, run Git operations in the current Session workspace, start and stop local terminal processes; model-facing terminal tools are disabled by default, open user-entered web pages or external editors and receive files explicitly uploaded by the user, when enabled by the user, register the sidebar_open model tool to open workspace files, folders, or HTTP(S) pages in the current Session sidebar; disabled by default | `dsh plugin --profile web remove dsh-better-sidebar` | [upstream repository](https://github.com/omdsh-dev/DSH-better-sidebar) |
| `dshmarket` | portable | read and modify dependencies, Bundle order, and enabled state in the active DSH Profile, install, update, and remove user-confirmed plugins through controlled pnpm, access the plugin catalog, npm, GitHub, and user-configured WebDAV or Gist services, export or import backups that contain Profile configuration | `dsh plugin --profile web remove dshmarket` | [upstream repository](https://github.com/dsh-market/dsh-market) |
| `@vibeinging/dsh-session-teams` | portable | read, route and relay messages and tasks across visible conversation windows in the current profile, including sub-agent handoff, write team, task and visible-window relay state through the official Session API in the Profile session store, create top-level conversation windows on demand and compose sub-agent teams scheduled with the current workspace, model, and permissions | `dsh plugin --profile web remove @vibeinging/dsh-session-teams` | [upstream repository](https://github.com/vibeinging/dsh-session-teams) |
<!-- featured-plugins:end -->

</details>

See [Plugin market selection and desktop integration](docs/research/2026-08-22_dsh-plugin-market-selection.md) for the selection, permission, and offline boundaries.

## Run from source

Node.js 24 or later is required:

```bash
git clone https://github.com/vibeinging/dsh-desktop.git
cd dsh-desktop
npm install
npm run doctor
npm run dev:electron
```

Build a local macOS Apple Silicon app:

```bash
npm run package:mac:dir
open "release/mac-arm64/DSH Desktop.app"
```

Local directory builds are for development. End-user signed installers are published through GitHub Releases.

## Data and permissions

- Profiles, plugins, Sessions, and local runtime data are stored under `~/.dsh` by default, can be changed with `DSH_DATA_ROOT`, and remain independent of the app directory.
- Official Web has no product preload, Node access, or general IPC.
- Files and directories enter the active Session only after explicit user selection or a declared plugin permission.
- Plugin startup failure does not silently rewrite the original Profile; recovery can retry, start safely, remove a problem plugin, and export filtered diagnostics.
- Formal builds check this project's public GitHub Releases and download or install only after user confirmation.
- Third-party Bundles, native binaries, and visual assets retain their upstream licenses and redistribution terms.

See the [privacy notice](PRIVACY.md), [security policy](SECURITY.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Difference from other community desktop projects

DSH Desktop chooses one official Web interface, one official Profile authority, curated community Bundles, and a narrow Native Host. It does not build a second full front end; it makes the desktop experience a reliable distribution of the DSH plugin ecosystem.

[DSH Desktop by anywhere-labs](https://github.com/anywhere-labs/deepseek-harness-desktop) is another independent community distribution with more emphasis on a complete desktop shell and cross-platform client experience. [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) is also an independent community project. Their code, releases, and product routes are separate; users can choose by interface, plugin model, and available platform artifacts.

## Related projects

| Project | Relationship |
| --- | --- |
| [dsh-website](https://github.com/vibeinging/dsh-website) | Official website of this project (DSH Desktop Station · [dshdesktopstation.com](https://dshdesktopstation.com/)) |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Agent, Session, Tool, Skill, MCP, Profile, and official Web runtime |
| [Cordis](https://github.com/cordiverse/cordis) | Plugin foundation |
| [DSH Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Default workspace sidebar, editor, Git, and terminal |
| [dsh-market](https://github.com/dsh-market/dsh-market) | Default plugin market |
| [dsh-session-teams](https://github.com/vibeinging/dsh-session-teams) | Default conversation window teams Bundle (maintained here, `@vibeinging/dsh-session-teams`) |
| [dsh-web](https://github.com/zhu1090093659/dsh-web) | Upstream community ecosystem repository for the task board and skin center (Apache-2.0) |
| [dshfind](https://www.dshfind.com/zh) | DSH learning, sharing, and plugin discovery community |

## Relationship to DeepSeek Harness

DSH Desktop is an independent community project built on the DeepSeek Harness and Cordis plugin systems. “DeepSeek Harness” is used only to describe compatibility and technical origin. This project has no affiliation, partnership, authorization, or endorsement from DeepSeek.

## License

Project code is released under the [MIT License](LICENSE). Sources and redistribution terms for third-party components, pinned tarballs, native binaries, and visual assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
