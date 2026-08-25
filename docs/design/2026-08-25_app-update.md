# 应用更新设计

## 目标

DSH Desktop 的正式 macOS 和 Windows 安装包从公开 GitHub Releases 检查新版本。发现新版本后先询问用户，用户确认后才下载并安装。应用更新不修改 DSH Profile，也不替用户恢复已停用或卸载的插件。

## 所有权

应用更新属于 Electron Host，不属于 DSH Client 插件。替换签名 App、DMG 或 EXE 是操作系统级能力，不能交给运行在官方 Web 中的第三方 Client。官方 Web 继续没有 preload、Node 权限或通用 IPC；更新器也不向页面公开任意下载或执行接口。

macOS 在应用菜单提供“检查更新…”。macOS 和 Windows 正式安装包都会在启动后检查一次，此后每六小时检查一次。开发版不执行自动更新。

## 更新源和信任边界

公开发行固定使用 `vibeinging/dsh-desktop` 的 GitHub Release。客户端配置为公开 GitHub provider，不读取或携带 GitHub 令牌。只接受正式 Release，不接受草稿或预发布版本。

保留 `DSH_UPDATE_API_BASE_URL` 仅用于受控部署和本地打包更新 smoke。该地址必须是无凭据、无查询参数的 HTTPS 地址，元数据与下载源必须同源且路径固定。

## 生命周期

1. `electron-updater` 读取当前平台的 Release 元数据，自动下载保持关闭。
2. 有新版本时显示版本号和 Release notes，由用户选择“下载并安装”或“稍后再说”。
3. 下载进度投射到操作系统任务栏或 Dock；失败时显示明确错误。
4. 下载完成后调用 Server 的 Profile 只读预检。预检失败时不写待安装记录，也不退出应用。
5. 预检通过后记录当前版本、目标版本和需要保留的数据路径，优雅停止本地 Server，再由 `electron-updater` 替换应用。
6. 新版本启动后核对目标版本，并把结果写入本地更新历史。Profile、Session 和插件状态仍由 DSH 自己管理。

## 发行产物合同

macOS Release 必须同时包含 `latest-mac.yml`、ZIP 和对应 ZIP blockmap；Windows Release 必须同时包含 `latest.yml`、EXE 和对应 EXE blockmap。发行检查会验证元数据版本、文件名、文件存在性和 SHA-512。缺少任一文件都不能进入正式发布。

GitHub Release 必须把安装包、更新元数据和 blockmap 一起上传。正式 macOS 和 Windows 发行 workflow 会生成、校验并保存这些文件，但保持 GitHub `contents: read` 权限，不自动公开发布；发版操作必须把同一批已验收文件附加到当前 tag。未签名 Windows workflow 也只保存 Actions 临时产物。仅上传 DMG 或 EXE 会让用户可以手动安装，但应用内更新不可用。

## 验证边界

单元测试覆盖固定公开仓库、公开 provider、Release notes、按需下载、缓存、错误、Profile 阻断和安装历史。打包更新 smoke 使用本地 HTTPS feed 和真实 `electron-updater`，覆盖下载、Profile 预检、签名替换和新版本重启，并确认用户 Profile 不被改写。

首个带更新器和更新元数据的公开版本只能建立生产基线。真实 GitHub Release 的端到端升级需要该版本发布后，再用下一版本从已安装基线完成一次在线更新，才能记为生产路径通过。
