<h1 align="center">DSH Desktop</h1>

<p align="center">
  <strong>Official DSH Web, community plugins, and desktop capabilities in one ready-to-use app.</strong><br>
  Conversations, files, Git, terminals, tasks, Worktrees, and the plugin market share one DSH Profile.
</p>

<p align="center"><a href="README.md">中文</a> · <a href="README.anime.md">Anime README</a></p>

<p align="center">
  <a href="https://github.com/vibeinging/dsh-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/vibeinging/dsh-desktop?display_name=tag&amp;style=flat&amp;color=2563EB" alt="Latest release"></a>
  <a href="https://github.com/vibeinging/dsh-desktop"><img src="https://img.shields.io/github/stars/vibeinging/dsh-desktop?style=flat&amp;label=stars&amp;color=2563EB" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-0.1.1--rc.2-7C3AED?style=flat" alt="DSH 0.1.1-rc.2">
  <img src="https://img.shields.io/badge/plugins-Profile%20Bundles-2563EB?style=flat" alt="Profile Bundles">
</p>

<p align="center">
  <img src="docs/images/readme/dsh-community-task-board.png" alt="DSH Desktop main interface" width="100%">
</p>

DSH Desktop is a community-maintained desktop distribution. It runs the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) npm runtime and `dsh-web-app` directly, with a curated set of pinned community Bundles. There is no second Chat implementation or separate plugin database to maintain: the app starts from one official DSH Profile.

<p align="center">
  <a href="https://github.com/vibeinging/dsh-desktop/releases/latest"><strong>Download the latest release</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#getting-started">Get started</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#installing-more-plugins">Install plugins</a>
</p>

## Download

| Platform | Install | Status |
| --- | --- | --- |
| macOS Apple Silicon | Download the `.dmg` and drag it to Applications | Developer ID signed and Apple notarized |
| Windows x64 | Download the `.exe` installer | Use the artifacts published on the current [Release](https://github.com/vibeinging/dsh-desktop/releases/latest) page |
| macOS Intel / Linux | No formal installer yet | Run from source |

## Ready on first launch

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Official conversations and Agents</h3>
      <p>The main window is official DSH Web. DSH owns Sessions, Agents, Tools, Skills, MCP, settings, and history; the app does not maintain a second Chat surface.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Better Sidebar workbench</h3>
      <p>Files, code and Markdown editing, Git, terminals, web pages, and extension tabs are built in. Version 0.16.0 adds multi-repository and Worktree support, Vue editing, and local Markdown images.</p>
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

### Default plugins

New Profiles include Better Sidebar, dshmarket, the task board, attachment input, Git Worktree, project tools, Canvas, Office output, structured results, and model inheritance. Every manageable Bundle can be disabled or removed.

<details>
<summary>View the 14 Bundles installed in a new Profile</summary>

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
| `dsh-better-sidebar` | portable | read, search, create, modify, and delete files in the current Session workspace, run Git operations in the current Session workspace, start and stop local terminal processes; model-facing terminal tools are disabled by default, open user-entered web pages or external editors and receive files explicitly uploaded by the user, when enabled by the user, register the sidebar_open model tool to open workspace files, folders, or HTTP(S) pages in the current Session sidebar; disabled by default | `dsh plugin --profile web remove dsh-better-sidebar` | [upstream repository](https://github.com/omdsh-dev/DSH-better-sidebar) |
| `dshmarket` | portable | read and modify dependencies, Bundle order, and enabled state in the active DSH Profile, install, update, and remove user-confirmed plugins through controlled pnpm, access the plugin catalog, npm, GitHub, and user-configured WebDAV or Gist services, export or import backups that contain Profile configuration | `dsh plugin --profile web remove dshmarket` | [upstream repository](https://github.com/dsh-market/dsh-market) |
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

- Profiles, Sessions, and local runtime data are stored under `~/.dsh` by default.
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
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Agent, Session, Tool, Skill, MCP, Profile, and official Web runtime |
| [Cordis](https://github.com/cordiverse/cordis) | Plugin foundation |
| [DSH Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Default workspace sidebar, editor, Git, and terminal |
| [dsh-market](https://github.com/dsh-market/dsh-market) | Default plugin market |
| [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | Upstream community repository for the default task board |
| [dshfind](https://www.dshfind.com/zh) | DSH learning, sharing, and plugin discovery community |

## Relationship to DeepSeek Harness

DSH Desktop is an independent community project built on the DeepSeek Harness and Cordis plugin systems. “DeepSeek Harness” is used only to describe compatibility and technical origin. This project has no affiliation, partnership, authorization, or endorsement from DeepSeek.

## License

Project code is released under the [MIT License](LICENSE). Sources and redistribution terms for third-party components, pinned tarballs, native binaries, and visual assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
