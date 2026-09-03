# 应用更新设计

## 目标

DSH Desktop 的正式 macOS 和 Windows 安装包通过官网更新服务查询公开 GitHub Releases 的新版本，并用随机安装 ID 统计近期活跃客户端。发现新版本只更新右上角按钮，不弹出通知对话框，也不自动下载；用户点击按钮后才下载并安装。应用更新不修改 DSH Profile，也不替用户恢复已停用或卸载的插件。

## 所有权

应用更新属于 Electron Host，不属于 DSH Client 插件。替换签名 App、DMG 或 EXE 是操作系统级能力，不能交给运行在官方 Web 中的第三方 Client。官方 Web 继续没有 preload、Node 权限或通用 IPC；更新器也不向页面公开任意下载或执行接口。

macOS 在应用菜单提供“检查更新…”和可用时的“下载并安装更新…”。macOS 和 Windows 正式安装包都会在启动后检查一次，此后每六小时检查一次。开发版不执行自动更新，也不显示更新控件。

## 更新按钮和日志

按钮显示“更新 版本号”，悬停 180 毫秒或键盘聚焦时展开日志；指针可移入日志滚动阅读，移出后关闭，Escape 也可关闭。Command/Ctrl + Shift + U 可从官方页面、更新视图或浏览器工作区聚焦按钮。空闲或已是最新版时，按钮提供“检查更新”；下载期间显示百分比并禁止重复点击。检查和下载失败在日志区域显示原因，按钮变为“重试更新”。

控件跟随系统深浅色，保留键盘焦点提示，并遵循减少动态效果设置。Release HTML 只在未挂载的 template 中解析，再以纯文本展示；日志中的脚本、图片、外链和内嵌页面不会执行或加载。解析输入最多 64 KiB，畸形标签、链接和空白不触发重复扫描；无法简化的 Markdown 保留原文。

[更新控件](../../electron/app-update-view.js)是 Electron 创建的本地 WebContentsView，不依赖 Profile 标题栏插件是否安装或升级。本地页面有专用 preload，官方 DSH Web 没有该桥接。主进程只接受来自该本地页面主框架的状态、检查和指定版本安装请求；下载地址与安装参数仍由更新器决定。

macOS 已启用 Profile 标题栏时，控件复用其 36 像素留白；其他窗口通过 Host 插入的可移除 CSS 为官方 Web 的根容器预留同样高度，不改 SDK 源文件或用户 Profile。控件关闭时恢复留白和事件监听。折叠时原生视图只占右侧标题栏，悬停时向下展开且保持横向位置，防止鼠标目标因视图移动而失效。决策依据见 [Agent Note](2026-08-28_nonmodal-update-control.md)。

## 更新源和信任边界

公开发行通过 `https://dshdesktopstation.com` 查询更新元数据，资产固定来自 `vibeinging/dsh-desktop` 的 GitHub Release。托管 feed 必须与配置的 API 同源且路径固定；官网只跳转到该仓库已发布、匹配版本和平台的文件。客户端不读取或携带 GitHub 令牌，只接受正式 Release，不接受草稿、预发布或降级。

`DSH_UPDATE_API_BASE_URL` 可覆盖默认官网地址，用于受控部署和本地打包更新 smoke。该地址必须是无凭据、无查询参数的 HTTPS 地址；显式设置为空时只使用固定 GitHub provider。官网查询或 feed 检查失败时可退回固定 GitHub provider；下次检查仍先尝试官网，统计失败本身不会阻断更新。官网目标版本与真实 feed 不一致时不继续使用该 feed。

客户端只在正式更新通道启用且未退出统计时读取或创建 Electron userData 下的随机安装 ID；损坏文件不覆盖。ID 只进入 `X-DSH-Client-Id` 请求头，不进入 query、日志或页面状态。`DSH_UPDATE_STATS_DISABLED=1` 停止发送 ID。字段、保留期和统计口径见[隐私说明](../../PRIVACY.md#自动检查更新与客户端统计)。

## 生命周期

1. `electron-updater` 读取当前平台的 Release 元数据，自动下载保持关闭。
2. 有新版本时更新按钮文案，用户可悬停查看 Release notes，点击按钮才开始下载。
3. 下载进度同时显示在按钮和操作系统任务栏或 Dock；失败原因在日志区域展示。
4. 下载完成后调用 Server 的 Profile 只读预检。预检失败时不写待安装记录，也不退出应用；保留用户主动安装后的阻断提示，可处理插件、进入安全 Profile 或稍后更新。
5. 预检通过后记录当前版本、目标版本和需要保留的数据路径，优雅停止本地 Server，再由 `electron-updater` 替换应用。
6. 新版本启动后核对目标版本，并把结果写入本地更新历史。Profile、Session 和插件状态仍由 DSH 自己管理。

## 发行产物合同

macOS Release 必须同时包含 `latest-mac.yml`、ZIP 和对应 ZIP blockmap；Windows Release 必须同时包含 `latest.yml`、EXE 和对应 EXE blockmap。发行检查会验证元数据版本、文件名、文件存在性和 SHA-512。缺少任一文件都不能进入正式发布。

GitHub Release 必须把安装包、更新元数据和 blockmap 一起上传。正式 macOS 和 Windows 发行 workflow 会生成、校验并保存这些文件，但保持 GitHub `contents: read` 权限，不自动公开发布；发版操作必须把同一批已验收文件附加到当前 tag。未签名 Windows workflow 也只保存 Actions 临时产物。仅上传 DMG 或 EXE 会让用户可以手动安装，但应用内更新不可用。

## 验证边界

单元测试覆盖固定公开仓库、公开 provider、Release notes、按需下载、缓存、错误、Profile 阻断和安装历史，也覆盖 ID 持久化与隔离、退出统计、损坏文件保留、托管源回退与恢复。打包更新 smoke 使用本地 HTTPS feed 和真实 `electron-updater`，覆盖下载、Profile 预检、签名替换和新版本重启，并确认用户 Profile 不被改写。云端 API 验证与客户端元数据检查不能替代完整下载安装验收。

`npm --prefix electron run smoke:update-ui` 在独立临时数据目录运行真实 Electron 界面及 AppUpdateController，使用模拟下载器和安装器验证按钮、悬停日志、键盘、滚动、深浅色、进度、版本校验、Profile 阻断与视图清理。该检查不连接真实更新源、不替换正式 App，也不能代替打包升级验收；输出目录包含截图和 JSON 结果。

首个带更新器和更新元数据的公开版本只能建立生产基线。真实 GitHub Release 的端到端升级需要该版本发布后，再用下一版本从已安装基线完成一次在线更新，才能记为生产路径通过。

2026-08-28 官网统计／更新服务 v0.1.0 已上线。独立 Electron 进程使用真实 ElectronHttpExecutor、模拟当前版本 0.1.9，从正式托管 feed 识别到 0.2.0；测试关闭统计并禁止下载安装，未替换已安装 App。客户端接入和默认地址的 23 项相关测试通过，但新的桌面安装包尚未发布。服务部署与查询统计方式见[服务发布流程](https://github.com/vibeinging/dsh-website/blob/v0.1.0/docs/plans/2026-08-28_service-release-runbook.md)。
