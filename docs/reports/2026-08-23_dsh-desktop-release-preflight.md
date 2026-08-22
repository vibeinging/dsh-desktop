# DSH Desktop 发行预检

## 目标

本次候选版本为 `v0.1.0`。macOS arm64 产物必须使用 Developer ID 签名并完成 App 公证、DMG 公证票据、最终 App Gatekeeper、安装器、Native Host、精选 Bundle 和真实模型回执；Windows x64 由 GitHub Actions 生成并完成安装、启动、Profile、恢复和卸载验收。仓库没有 Windows 代码签名证书，因此 Windows 产物只能明确标记为未签名，不能写成已签名或 SmartScreen 无提示。

## 已确认条件

- 当前产品名、包名和应用标识分别为 `DSH Desktop`、`dsh-desktop` 和 `com.vibeinging.dsh-desktop`。
- GitHub 仓库候选名 `vibeinging/dsh-desktop` 可用；旧仓库地址在 GitHub 改名后由平台保留跳转。
- Apple Team 为 `BB5VK42K87`，本机公证凭据已通过 `notarytool history` 只读验证。
- Developer ID 指纹 `26C311958B22397631A857D0482CD2F0EA0BF2AA` 有效期至 2031 年；workflow 使用唯一指纹，避免两个同名证书产生歧义。
- 本地 Apple 公证使用 `notarytool` Keychain profile；正式打包进程清除 Apple ID/password 环境变量，避免 app-specific password 出现在进程参数或日志中。
- npm 认证材料存在，但 GitHub Actions 仓库 Secret 尚未配置。
- 用户已授权本轮只在本机 smoke 进程中临时使用 `~/.dsh/.env` 的 DeepSeek 凭据；凭据不输出、不写入回执、不提交且不上传 GitHub Actions。
- Windows x64 签名证书不存在；`windows-release-evidence.yml` 保留为未来的正式签名入口，本轮只运行 `windows-release.yml`。

## DMG 公证验收

electron-builder 默认不对 DMG 容器另外签名，并明确说明 DMG 容器签名不是 Gatekeeper 必需条件。正式回执因此要求 Apple 接受 DMG 公证、DMG 票据附加与验证成功，然后挂载该 DMG，对其中实际分发的 App 执行 stapler 和 Gatekeeper 验证。只有另外签名的 DMG 容器才能通过 `spctl --type open --context context:primary-signature`；本项目不把该可选的企业分发能力写成必需发行门禁。

## Actions 用量

1. 候选提交只推送到 `dev` 一次，复用一次 `Desktop CI` 的 macOS arm64 与 Windows x64 目录包和 smoke。
2. `ci.yml` 只响应 `dev`、`main` 分支的代码改动；tag 和纯文档推送不重复运行双平台 CI。
3. CI 同一 SHA 通过后创建 `v0.1.0` tag。macOS 和 Windows 各只手动触发一次发行 workflow。
4. 两个发行 workflow 都先核对 tag 与包版本。macOS 还在安装依赖前核对全部 Secret，避免把缺凭据错误拖到打包或公证阶段。
5. macOS workflow 上传 DMG、ZIP 和完整回执；Windows workflow 只上传 NSIS 安装器与验收回执，不上传 `win-unpacked`。

## 发布判定

只有 `macos-release-evidence.yml` 的正式回执门禁全部通过，macOS DMG 和 ZIP 才能挂到 GitHub Release。Windows workflow 通过后可以附加未签名 NSIS，并在文件名和 Release 说明中保留未签名提示。任何 workflow 失败都先读原始日志和已上传证据，不重复触发同一 SHA；修复后产生新提交和新候选 tag。
