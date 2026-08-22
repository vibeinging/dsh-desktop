# 两套 DSH 社区桌面发行版的差异

本文说明本仓库与 [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 的当前定位差异。两者都是独立社区项目，均不是 DeepSeek 官方桌面客户端，也不是彼此的上游或下游。

## 共同基础

两者都使用 Electron 承载官方 DSH Web，通过 DSH Profile 组合 Host 与 Client 插件，并避免把 Electron、Node 或通用 IPC 直接暴露给普通 Web Client。两边公开给第三方的桌面包管理 contract 也都围绕 `desktopProfiles` 与 `desktopPnpm` 收窄。

## 不同取舍

| 维度 | 本仓库 | anywhere-labs DSH Desktop |
| --- | --- | --- |
| 产品定位 | 面向桌面的精选插件发行版；重点是社区插件采用、产品工具拆分和逐项验证 | 完整桌面客户端；重点是安装包、系统集成和统一 Desktop Shell |
| 上游依赖 | 固定官方 npm 运行时与 SDK，仓库和安装包不携带 DSH 源码 checkout | 固定 `deepseek-harness` 源码子模块，外层 Yarn 工程不修改子模块 |
| 主界面 | 只加载官方 Web Client 图；桌面安全条也是独立 `dshClient` Bundle | 兼容模式保留官方界面，高级模式增加 Desktop 自有 layout、frame 与原生材质 |
| 默认插件 | 固定社区 `dshmarket@1.17.1` 与 task-board，并提供 Project、Canvas/Site、Structured UI、Office、模型继承等独立 Bundle | 以 `dsh-plugin-desktop` 提供终端、托盘、Profile、更新等桌面能力，并内置 DSH Community Market |
| 原生能力 | 按 Session 绑定到 `windowHost`、`fileDialogHost`、`browserWorkspaceHost` 等方法白名单；业务 Bundle 不接触传输层 | 原生窗口、托盘、终端和更新属于 Desktop 内部 `desktopRuntime`；第三方只使用两个公开 service |
| Profile 策略 | 新 Profile 使用固定 tarball、完整依赖闭包和随包 pnpm 离线原子初始化；已有 Profile 在更新时只读 | Launcher 选择 Profile，在每个 Cordis generation 中提供 Profile 与 pnpm service，并支持 Profile/模式切换 |
| 恢复和验证 | 恢复页、last-known-good、官方卸载后重启、离线安装、包体预算、签名/公证/安装器/真实模型回执分别设门禁 | 提供本地服务恢复、generation 生命周期、打包闭包和跨平台安装包；公开 README 当前提供 Windows x64 与 macOS Universal 下载 |
| 当前交付 | Preview，未发布签名安装包 | 已发布可直接下载的正式安装包 |

## 结论

anywhere-labs 项目在直接下载、跨平台安装和完整 Desktop Shell 上更成熟。本仓库不应复制同一套产品叙事，而应坚持“精选插件发行版”：官方 Web 是唯一主界面，优先集成社区插件，缺失能力拆成独立 Bundle，原生权限保持窄边界，并让每个默认插件都有离线、安装、卸载、重启和发行证据。

这也意味着本仓库不能只展示一个 Chat 页面。README 和后续发布材料需要持续展示插件市场、社区工作台、Project/Canvas/Office 工具链、恢复能力以及真实 Profile 生命周期，才能让差异成为用户可见的产品体验。

## 依据

- anywhere-labs [README](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/README.md)：下载平台、主要功能、插件市场和项目定位。
- anywhere-labs [架构说明](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/docs/architecture.md)：兼容/高级模式、源码子模块、Host/Client/native runtime 和 generation 生命周期。
- anywhere-labs [插件 service contract](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/docs/plugin-services.zh.md)：`desktopProfiles`、`desktopPnpm` 与私有 `desktopRuntime` 边界。
- 本仓库 [`README.md`](../../README.md)、[`featured_plugins.json`](../../server/src/engine/dsh_runtime/featured_plugins.json) 与各 [`packages/`](../../packages/) Bundle：当前默认清单、产品工具、社区插件和 Host 边界。
