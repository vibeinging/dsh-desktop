# DSH Desktop 发行预检

## 目标

macOS arm64 `v0.1.0` 已发布。当前 Windows 修复候选为 `v0.1.3`；NSIS 安装器必须通过随包 Server、随包 App、真实安装、启动、断网 Profile、恢复、权限边界、卸载和清理验收后才能上传。仓库尚未配置 Authenticode 证书，因此本轮产物明确为 unsigned，不等同于正式签名发行。

## 已确认条件

- 当前产品名、包名和应用标识分别为 `DSH Desktop`、`dsh-desktop` 和 `com.vibeinging.dsh-desktop`。
- GitHub 仓库候选名 `vibeinging/dsh-desktop` 可用；旧仓库地址在 GitHub 改名后由平台保留跳转。
- Apple Team 为 `BB5VK42K87`，本机公证凭据已通过 `notarytool history` 只读验证。
- Developer ID 指纹 `26C311958B22397631A857D0482CD2F0EA0BF2AA` 有效期至 2031 年；workflow 使用唯一指纹，避免两个同名证书产生歧义。
- 本地 Apple 公证使用 `notarytool` Keychain profile；正式打包进程清除 Apple ID/password 环境变量，避免 app-specific password 出现在进程参数或日志中。
- npm 认证材料存在，但 GitHub Actions 仓库 Secret 尚未配置。
- 用户已授权本轮只在本机 smoke 进程中临时使用 `~/.dsh/.env` 的 DeepSeek 凭据；凭据不输出、不写入回执、不提交且不上传 GitHub Actions。
- Windows x64 签名证书不存在；`windows-release-evidence.yml` 保留为未来的正式签名入口，本轮只运行 `windows-release.yml`。
- macOS、Windows 的目录包与正式包脚本都先准备随包 DSH 运行时，再验证官方 Web 资源；干净 runner 不依赖本机残留的 `.desktop-build`。
- Electron 先启动应用自有的最小 NPM runtime child，再在进程内注册 Profile loader，并通过 `file://` 动态导入官方 DSH CLI；Windows 盘符路径不会再由自定义 loader 当作主模块说明符处理。
- Windows 验证证明 Electron Builder 的打包钩子新增目录不能作为稳定运行时来源。应用不再复制第二份 CLI，生产环境直接使用随 Server `package-lock.json` 固定并由 `extraResources` 打包的 `server/node_modules/@deepseek-ai/dsh`；Builder 完全退出后会校验包清单和 `lib/bin.js`，缺失时立即阻断。
- 官方 `dsh plugin` 命令的工作目录固定为用户的 DSH Home，不再使用只读的应用安装目录。Profile、插件库和 pnpm store 仍位于用户数据目录，官方 CLI 与依赖只从安装包读取。
- 新 Profile 的原子初始化会在临时 `profiles/node_modules` 建立指向安装包依赖的 fallback 链接。清理临时目录前必须先解除这些 symlink 或 Windows junction，禁止递归清理沿链接触及应用安装目录。
- 正式 macOS/Windows 证据 Workflow 的 job 级回执路径不再引用该阶段不可用的 `runner.temp` 上下文，避免手动 Workflow 在创建 job 前失败；回执统一写入 `.desktop-build/release-evidence` 并随产物上传。
- `v0.1.0` 候选 `30f9dd8` 的 macOS arm64 CI 完整通过；Windows x64 在目录包和随包 Server smoke 通过后，随包 App smoke 因重复 CLI 目录缺失而超时。安装验收和上传因此被阻断。`v0.1.1` 收敛到随包 npm 依赖这个唯一来源，完成针对性回归后才允许再次运行 Actions。
- `v0.1.1` 候选 `a6c4a33` 已生成 unsigned NSIS，随包 Server 和随包 App smoke 均通过；真实安装后的官方 Web 交互验收发现测试模型固定调用 `bash`，而官方 DSH 在 Windows 只暴露 `pwsh`，因此审批面板没有出现，安装器未上传。`v0.1.1` 标签保持不动且不创建 Release。
- `v0.1.2` 验收模型从官方工具清单选择 `bash` 或 `pwsh`，分别生成 POSIX 和 PowerShell 命令，并继续要求真实审批、临时标记落盘和卸载清理全部通过。现有打包 macOS App 的同一交互链已通过；Windows 结果只以新的安装验收回执为准。
- `v0.1.2` Windows 复验确认官方 Web 的 `pwsh` 问题、沙箱、审批和队列链、断网 Profile 与恢复页均通过；后续官方卸载暴露出原子初始化遗留的临时 pnpm virtual store 绝对路径。Profile 发布时现在会把 Windows pnpm junction 和 `.modules.yaml` 从暂存路径改到正式路径，再删除暂存目录；virtual store 仍留在 Profile 内，避免破坏社区插件的依赖解析。
- `v0.1.3` 是上述 Profile 发布修复的首个候选；`v0.1.2` 标签保持不动且不创建 Release。

## DMG 公证验收

electron-builder 默认不对 DMG 容器另外签名，并明确说明 DMG 容器签名不是 Gatekeeper 必需条件。正式回执因此要求 Apple 接受 DMG 公证、DMG 票据附加与验证成功，然后挂载该 DMG，对其中实际分发的 App 执行 stapler 和 Gatekeeper 验证。只有另外签名的 DMG 容器才能通过 `spctl --type open --context context:primary-signature`；本项目不把该可选的企业分发能力写成必需发行门禁。

## Actions 用量

1. 候选提交只推送到 `dev` 一次，复用一次 `Desktop CI` 的 macOS arm64 与 Windows x64 目录包和 smoke。
2. `ci.yml` 只响应 `dev`、`main` 分支的代码改动；tag 和纯文档推送不重复运行双平台 CI。
3. CI 同一 SHA 通过后创建对应版本 tag。macOS 和 Windows 各只手动触发一次发行 workflow。
4. 两个发行 workflow 都先核对 tag 与包版本。macOS 还在安装依赖前核对全部 Secret，避免把缺凭据错误拖到打包或公证阶段。
5. macOS workflow 上传 DMG、ZIP 和完整回执；Windows workflow 只上传 NSIS 安装器与验收回执，不上传 `win-unpacked`。

## 发布判定

只有 macOS 的正式回执门禁全部通过，DMG 和 ZIP 才能挂到 GitHub Release。Windows 安装器不上传、不写成已支持，待真实产物链闭环后再单独发布。任何 workflow 失败都先读原始日志和已上传证据，不重复触发同一 SHA。
