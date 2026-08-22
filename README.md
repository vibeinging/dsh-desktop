<h1 align="center">DSH Desktop</h1>

<p align="center">
  <strong>面向桌面的 DSH 精选插件发行版。</strong><br>
  原样运行官方 Web，以 Profile 组合社区插件、产品工具和受控原生能力。
</p>

<p align="center"><sub>独立的社区开源项目，与深度求索不存在隶属、合作、授权或背书关系。<br>中文 · <a href="README.en.md">English</a> · <a href="README.anime.md">二次元版 README</a></sub></p>

<p align="center">
  <a href="https://github.com/vibeinging/deepseek-harness-desktop-app"><img src="https://img.shields.io/github/stars/vibeinging/deepseek-harness-desktop-app?style=flat&amp;label=stars&amp;color=2563EB" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat" alt="Electron runtime">
  <img src="https://img.shields.io/badge/interface-official%20DSH%20Web-2563EB?style=flat" alt="Official DSH Web">
  <img src="https://img.shields.io/badge/status-preview-F59E0B?style=flat" alt="Preview status">
</p>

<p align="center">
  <img src="docs/images/readme/dsh-community-task-board.png" alt="DSH Desktop 中通过官方 Profile 加载的社区任务看板" width="100%">
</p>

DSH Desktop 是社区维护的 Electron 桌面发行版。它固定并运行官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) npm 运行时，把 `dsh-web-app`、Session、Agent、Tool、Skill、MCP 与 Profile Bundle 放进一个本地应用。项目不修改 DSH 源码，也不再维护第二套 Chat、首页、设置或插件中心。我们的重点不是再做一层相似界面，而是把经过审查的社区插件和独立产品 Bundle 组合成可复现、可卸载、可恢复的桌面工作环境。

当前仓库尚未发布签名安装包。已经验证的是 macOS Apple Silicon 未签名目录包；Windows 签名安装器、macOS Developer ID、公证、原生 Intel x64 和绑定签名产物的 DeepSeek live-model 正式回执仍属于发行验收项。

## 为什么是这个发行版

我们与 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 都是独立社区 Electron 发行版，也都运行官方 DSH Web、遵循 Profile，并避免把 Electron API 直接暴露给页面。区别不在“谁更官方”，而在产品取舍：

| 维度 | 本仓库 | anywhere-labs DSH Desktop |
| --- | --- | --- |
| 核心目标 | 精选、审查并验证一组可组合的 DSH Bundle，优先采用社区插件 | 提供完整桌面 Shell 与可直接下载安装的跨平台客户端 |
| DSH 接入 | 只使用固定的官方 npm 运行时与 SDK，不携带 DSH 源码 checkout | 外层 Yarn 工程固定官方 DSH 源码子模块，桌面代码集中在 `dsh-plugin-desktop` |
| 界面策略 | 官方 Web 是唯一主界面；桌面安全条也是普通 `dshClient` Bundle，不提供第二套 Renderer | 提供兼容与高级两种呈现模式；高级模式可安装 Desktop 自有 layout、frame 与原生材质 |
| 默认体验 | 内置社区 `dshmarket`、task-board，以及独立的 Project、Canvas/Site、Structured UI、Office 和模型继承 Bundle | 内置统一 Desktop 插件、终端、托盘、Profile、更新与 DSH Community Market；手机远程控制列为后续能力 |
| 原生边界 | 功能 Bundle 只消费按 Session 绑定的方法白名单；插件安装最终仍走官方 DSH CLI | 第三方公开面同样收窄为 `desktopProfiles` 与 `desktopPnpm`，其它原生能力由 Desktop 内部插件使用 |
| 当前成熟度 | Preview；真实 macOS arm64 Electron 和插件生命周期已验证，但还没有正式签名安装包 | 已提供 Windows x64 与 macOS Universal 正式安装包，下载体验更成熟 |

如果你现在只想下载安装一个成熟桌面客户端，anywhere-labs 项目更合适；如果你关心官方 Web 单一界面、社区插件优先、离线可复现的新 Profile、细粒度产品工具 Bundle 和逐项发行证据，本仓库走的是另一条路线。完整依据见[两套社区桌面发行版对比](docs/research/2026-08-22_dsh-desktop-distribution-differences.md)。

## 主要能力

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>官方 DSH Web 桌面化</h3>
      <p>Electron 启动本地 DSH Web Profile，并管理窗口、服务启动、退出和恢复。主窗口直接加载官方 Client 图，不使用旧 Renderer 或产品 preload。</p>
    </td>
    <td width="50%" valign="top">
      <h3>默认插件市场</h3>
      <p><code>dshmarket@1.17.1</code> 挂在官方设置 Slot 内，提供发现、兼容性诊断、安装、更新和卸载。市场、设置页和命令行读写同一个 Profile。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>社区优先的精选工作台</h3>
      <p>默认采用社区 task-board 与 dshmarket，而不是在 Shell 内重复实现。每个版本都固定到审查过的 tarball，并单独验证安装、停用、官方卸载和重启恢复。</p>
    </td>
    <td width="50%" valign="top">
      <h3>产品能力也是 Bundle</h3>
      <p>Project、Conversation、Canvas/Site、Structured UI、Office 与模型继承分属独立 Bundle。功能代码不导入 Electron 或通用 IPC，未来可以替换 Host provider，而不用重写 Tool。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>窄原生 Host</h3>
      <p>窗口、文件授权、Browser Workspace 和更新能力只通过方法白名单与 Session 绑定开放。第三方 Client 不能取得 Electron、Node 或通用 IPC。</p>
    </td>
    <td width="50%" valign="top">
      <h3>离线初始化与失败恢复</h3>
      <p>新 Profile 使用固定产物和随包 pnpm 原子初始化；已有 Profile 在更新时不被重写。启动失败进入恢复页，而不是显示白屏或静默补回用户已卸载的插件。</p>
    </td>
  </tr>
</table>

## 当前界面

### 官方会话、问题与审批

![官方 DSH Web 会话](docs/images/readme/dsh-official-web-session-loopback.png)

截图来自当前 macOS arm64 打包 Electron 与真实 DeepSeek-V4-Flash 的正常用户对话。展示流程仍从官方 `session.history` 验证非空 `assistant/message`、`source.kind=model`、`provider=deepseek-official` 和 `turn/end(completed)`，但不会把测试 UUID 放进用户界面；独立的发行 smoke 继续要求唯一回执标记。密钥只注入本次临时进程，没有写入 Profile 或截图；由于当前 App 仍是未签名目录包，这条开发验证不替代绑定正式签名产物的发行回执。

### 官方设置中的插件市场

![官方 Web 设置中的默认插件市场](docs/images/readme/dsh-plugin-market.png)

市场作为独立 Client Bundle 挂在官方设置 Slot 内。截图证明页面和社区目录已经加载；另一条打包版生命周期测试负责验证安装、停用、官方卸载和卸载后重启恢复。

## 快速开始

本地开发要求 Node.js 24 或更高版本：

```bash
git clone https://github.com/vibeinging/deepseek-harness-desktop-app.git
cd deepseek-harness-desktop-app
npm install
npm run doctor
npm run dev:electron
```

macOS Apple Silicon 目录包：

```bash
npm run package:mac:dir
open "release/mac-arm64/DSH Desktop.app"
```

该命令生成未签名开发包，不等于可对外发布的签名安装包。

## 插件生态

DSH Profile 是插件状态的唯一权威。新 Profile 通过官方 `dsh plugin --profile web` 原子安装默认 Bundle；已有 Profile 在应用更新时保持只读，不会补回、删除或重写用户选择。用户停用或卸载的 Bundle 在重启和升级后仍保持停用或卸载。

普通用户可以直接打开“设置 → 插件市场”。命令行使用同一套 Profile：

```bash
dsh plugin --profile web add -w <package>@<exact-version> --save-exact --ignore-scripts
dsh plugin --profile web remove <package>
```

新 Profile 默认安装固定的 `dshmarket@1.17.1`。发行包携带经过审查的固定 tarball、完整运行依赖闭包和 SHA-256；默认初始化不需要 npm 网络，也不执行上游生命周期脚本。浏览市场会访问社区目录，安装与更新可能访问 npm 或 GitHub；WebDAV 和 Gist 只有用户主动配置后才会使用。市场内展示的插件并不等于已经内置或通过发行审查。

桌面侧的 `@vibeinging/dsh-desktop-profile-host` 只提供 `desktopProfiles` 和 `desktopPnpm` 两个公开结构服务。市场把用户确认的操作交给随包 pnpm 和官方 DSH CLI；它不能自行取得 Electron 权限或重启应用。

<details>
<summary>查看新 Profile 默认安装的 11 个 Bundle</summary>

<!-- featured-plugins:start -->
| 默认 Bundle | 类型 | 声明权限 | 官方管理方式 | 来源 |
|---|---|---|---|---|
| `@vibeinging/dsh-work-product-host-ipc` | desktop-adapter | dsh-work-parent-ipc、browser-workspace-host、file-dialog-host、window-host | 桌面基础服务，不提供卸载 | [本地包](packages/dsh-work-product-host-ipc) |
| `@vibeinging/dsh-desktop-profile-host` | desktop-adapter | dsh-profile-filesystem、controlled-pnpm-runtime、dsh-cli-runtime | 桌面基础服务，不提供卸载 | [本地包](packages/dsh-desktop-profile-host) |
| `@vibeinging/dsh-desktop-chrome` | desktop-adapter | 无 Host 权限 | `dsh plugin --profile web remove @vibeinging/dsh-desktop-chrome` | [本地包](packages/dsh-desktop-chrome) |
| `@vibeinging/dsh-project-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-project-tools` | [本地包](packages/dsh-project-tools) |
| `@vibeinging/dsh-canvas-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-canvas-tools` | [本地包](packages/dsh-canvas-tools) |
| `@vibeinging/dsh-structured-ui-tools` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-structured-ui-tools` | [本地包](packages/dsh-structured-ui-tools) |
| `@vibeinging/dsh-model-inheritance` | portable | 无 Host 权限 | `dsh plugin --profile web remove @vibeinging/dsh-model-inheritance` | [本地包](packages/dsh-model-inheritance) |
| `@vibeinging/dsh-product-bridge` | desktop-adapter | product-host | `dsh plugin --profile web remove @vibeinging/dsh-product-bridge` | [本地包](packages/dsh-product-bridge) |
| `@vibeinging/dsh-office-tools` | desktop-adapter | office-artifact-host | `dsh plugin --profile web remove @vibeinging/dsh-office-tools` | [本地包](packages/dsh-office-tools) |
| `@linxin666/dsh-client-ui-task-board` | portable | 读取当前 DSH Session、Workspace 与完成历史、在 DSH_HOME 写入任务账本和执行记录、按用户操作或 Host cron 启动 DSH Session 任务、可选启动固定的跨平台防休眠 helper | `dsh plugin --profile web remove @linxin666/dsh-client-ui-task-board` | [上游仓库](https://github.com/zhu1090093659/dsh-web-ui) |
| `dshmarket` | portable | 读取和修改当前 DSH Profile 的依赖、Bundle 顺序和启停状态、通过受控 pnpm 安装、更新和卸载用户确认的插件、访问插件目录、npm、GitHub 以及用户配置的 WebDAV 或 Gist、导出或导入包含 Profile 配置的备份 | `dsh plugin --profile web remove dshmarket` | [上游仓库](https://github.com/dsh-market/dsh-market) |
<!-- featured-plugins:end -->

</details>

## 开发插件

应用能力按边界拆成两类：

- `portable` Bundle 只使用官方 DSH 服务，可以安装到兼容的官方 Web Profile；
- `desktop-adapter` Bundle 使用 DSH Desktop 提供的窄 Host 合同，离开桌面宿主时应直接报告缺少能力。

自研 Bundle 位于 [`packages/`](packages/)。新增功能优先复用社区插件；只有社区没有可审查的实现时才增加独立 Bundle。插件不得直接修改官方 DSH 源码，也不能绕过 Profile 保存第二套安装状态。

插件市场接入、权限和离线边界见[插件市场选择与桌面接入](docs/research/2026-08-22_dsh-plugin-market-selection.md)。完整架构与发行顺序见[发行版转型方案](docs/plans/2026-08-20_dsh-app-发行版转型最终方案.md)。

## 数据与安全

- Profile、Session 和本地运行数据默认保存在 `~/.dsh`；打开历史不会自动上传这些内容；
- 官方 Web `webContents` 没有产品 preload、Node 或通用 IPC；
- Profile 或 Client 启动失败时进入本地恢复页，不会白屏或静默修改原 Profile；
- 恢复页可以重试、启动只含官方 `base` 与 `web-app` 的安全 Profile、打开目录、确认后移除指定插件并导出过滤后的诊断；
- 项目代码、第三方 Bundle 和视觉资产分别遵守自己的许可证与再分发条件。

详见[隐私说明](PRIVACY.md)、[安全说明](SECURITY.md)和[第三方说明](THIRD_PARTY_NOTICES.md)。

## 开发与验证

常用门禁：

```bash
npm run test:release
npm run typecheck
npm run check:release-boundary
npm run check:release-artifacts
npm run check:release:budgets
npm run measure:featured-plugins
```

最近一次本地验证为 173 项 release 测试中 170 项通过、3 项条件跳过、0 项失败；11 个默认 Bundle 均通过逐包 Profile 安装与生命周期测量。`dshmarket` 和 task-board 还通过当前 macOS arm64 打包 Electron 的激活、停用、官方卸载和重启恢复。真实 DeepSeek-V4-Flash 开发 smoke 也已通过官方 Web、Session history、provider 来源和完整响应校验。

这些证据仍不替代 macOS Developer ID、公证、Windows 签名安装器、原生 Intel x64 或绑定正式签名产物的 live-model 回执。仓库没有正式 Release 前，不把未签名目录包描述为可下载发行版。

## 相关项目

| 项目 | 关系 |
| --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 提供核心 Agent、Session、Tool、Skill、MCP、Profile 与官方 Web |
| [Cordis](https://github.com/cordiverse/cordis) | 提供插件化基础 |
| [dsh-market](https://github.com/dsh-market/dsh-market) | 当前默认内置的可视化插件市场 |
| [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | 当前 task-board 的上游社区仓库 |
| [DSH Desktop by anywhere-labs](https://github.com/anywhere-labs/deepseek-harness-desktop) | 更侧重完整桌面 Shell、跨平台安装包和直接下载体验的独立社区发行版；与本项目的差异见上文 |
| [dshfind](https://www.dshfind.com/zh) | DSH 学习、分享与插件发现社区 |

<p align="center"><a href="https://www.dshfind.com/zh"><img src="https://dshfind.com/api/badge/vibeinging/dsh-work?lang=zh" alt="dshfind 收录卡片"></a></p>

## 与 DeepSeek Harness 的关系

DSH Desktop 是基于 DeepSeek Harness 与 Cordis 插件思想构建的独立社区项目。上游提供核心运行时、插件系统和 Web UI；本项目负责 Electron 封装、新 Profile 的离线初始化、精选社区 Bundle、窄原生 Host、恢复页和桌面发行验证。

本项目与深度求索不存在隶属、合作、授权或背书关系。“DeepSeek Harness”仅用于真实、准确地说明兼容性和技术来源。

## 许可证

项目代码使用 [MIT License](LICENSE)。第三方组件、固定 tarball、原生二进制和视觉资产的来源与分发条件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
