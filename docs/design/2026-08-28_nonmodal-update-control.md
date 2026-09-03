# Agent Note: Non-modal desktop update control

Status: implemented

## Problem

自动新版本对话框打断编辑，系统消息框还会把 Release notes 中的 HTML 当作普通字符显示。更新入口必须持续可用，不能取决于用户是否保留某个 Profile 插件。

## Decision

Electron Host 在独立、本地、沙箱化的 WebContentsView 中显示更新按钮与悬停日志。发现版本只推送状态，不抢焦点。下载和安装由明确的点击触发，并由主进程核对用户看到的版本与当前可用版本一致。完整行为合同见[应用更新设计](2026-08-25_app-update.md)。

官方 Web 不接收 preload 或更新 IPC。控件只显示经惰性解析后生成的文本，不挂载 Release 提供的 HTML 节点。独立视图的位置保持不变，仅调整高度，避免悬停展开时原生视图平移导致鼠标目标失效。

## Alternatives considered

**继续使用系统消息框。** 无法满足非阻塞的悬停阅读，也不能直接呈现 HTML Release notes。

**把按钮加入 Profile 标题栏插件。** 该插件可以卸载，已有 Profile 也不会在 App 升级时自动替换插件。更新能力因此可能对老用户不可见。

**在官方 Web 中添加更新 preload。** 扩大第三方 Client 能接触的原生权限，不符合桌面 Host 的信任边界。

**调整 BrowserWindow 内置 WebContentsView 的边界。** Electron 42 不把该视图暴露为 contentView 的子视图，也禁止重复接管已挂载的 WebContents。无标题栏插件时采用可移除的根容器留白 CSS，浏览器工作区继续使用实际 DOM 坐标。

## Consequences

App 更新入口独立于 Profile，代价是多一个小型本地渲染进程。Host 为默认窗口保留 36 像素更新栏；官方页面根容器的布局约定需要随官方 Web 兼容检查保留。

单元测试约束请求来源、版本校验和打包清单；真实 Electron smoke 约束显示、鼠标与键盘交互、安装前检查以及 CSS/监听器释放。Windows 的真实窗口验收和下一版本的打包升级仍属于发行验证，不由本地 UI smoke 代替。
