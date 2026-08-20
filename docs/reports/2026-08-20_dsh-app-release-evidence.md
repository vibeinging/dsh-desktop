# DSH Desktop 发行版转型实施证据

日期：2026-08-21

本报告记录发行版转型当前已经取得的证据，以及还不能越级宣称完成的发行门槛。它对应 [发行方案](../plans/2026-08-20_dsh-app-发行版转型最终方案.md)，不把源码检查、单元测试、Profile 集成、真实 Electron 和安装包验证混为同一层证据。

## 已实施的运行边界

- Electron 主窗口只加载官方 `dsh-web-app` loopback surface，不再向官方 Web 注入产品 preload、Node 或通用 IPC。
- Browser Workspace 保留在主进程，通过方法白名单、Session 请求关联、目标 URL、路径和权限校验提供窄 Native Host 服务。
- 启动失败进入本地恢复页；重试、安全 Profile、打开 Profile、用户确认移除插件和隐私过滤诊断都是独立动作，原 Profile 不因恢复而被改写。
- Profile 初始化只在新 Profile 上执行。已有 Profile 的启动和状态查询读取官方清单、依赖和最终图，不补回或隔离用户 Bundle；用户 patch 停用的 Bundle 也保持在官方配置图之外，不被应用改写。
- 应用更新安装前执行当前 Profile 和 `--dump-config` 只读预检；预检失败不会创建待安装记录或调用 `quitAndInstall`。
- 自研替换 Shell、旧产品 Client UI、工作台目录和自研主题包已从发行包输入中移除；源代码中保留的旧 Renderer 不在 Electron 打包清单和发布边界内。
- 默认 `npm run dev` 现在直接启动官方 DSH Web Electron 路径，不再自动构建旧 Renderer 或自研 Client；需要维护旧 Renderer 的命令仍以 `dev:legacy-renderer` 显式命名，不属于发行或默认开发路径。
- 对现存 arm64 目录包和 Developer ID 签名 arm64 目录包的 `Contents/Resources` 做了实际资源名与二进制文本扫描：只发现官方 `@deepseek-ai/dsh-client-ui-theme`、`@deepseek-ai/dsh-shell` 等运行时资源，没有 `dsh-theme-pack`、`dsh-work-shell`、`dsh-workbench-pages`、`profileThemes` 或 `skin-settings-store` 残留；这项证据补充了源码发行边界检查。

## 精选输入和插件证据

唯一精选输入是 `server/src/engine/dsh_runtime/featured_plugins.json`。它由脚本生成固定 tarball、SHA-256 manifest、Profile 安装输入、权限摘要、第三方公告和测试预期。当前默认输入是 7 个 `@vibeinging/*` Host、portable 或 desktop-adapter Bundle，不包含替换式 UI。

2026-08-21 将生成器运行到两个独立临时目录，manifest 与 7 个 tarball 均逐字节一致，复现检查通过；这证明的是精选产物生成链路，不替代干净发行环境的完整安装验证。

公开 README 的默认 Bundle 明细不再维护第二份手写名单。`scripts/generate-featured-plugin-docs.mjs` 从同一精选 JSON 生成中英文表格中的包名、类型、权限、来源和官方卸载命令；`dsh-trusted-client-plugins.test.mjs` 与 `release-boundary` 会检查表格行数和字段是否仍与精选输入一致。本轮 `npm run docs:featured-plugins`、`npm run test:release`（136 项中 134 项通过、2 项按条件跳过、0 项失败）和 `npm run release:check:static`（12/12）均通过。

精选产物生成器现在还会在 `npm pack` 前校验包 manifest 的 `dshWork.portability.level`、有序 `hostRequirements` 与精选清单的 portability、permissions 完全一致；漂移会阻止 tarball、权限摘要和第三方公告生成。定向回归覆盖有效契约和两类漂移，临时目录生成全部 7 个精选 Bundle 成功。

本轮许可审计核对了 7 个源包的 `package.json`：它们均声明 `BSD-3-Clause`，精选清单已对齐该许可证；生成器现在会拒绝包名、源路径或许可证漂移，并把仓库内的许可证原文复制到随包 `featured-plugins/licenses/`；随包公告同时写入许可证文件、相对源路径和 tarball SHA-256。

固定 tarball 通过安装包内的受控 `pnpm@11.22.0` 进入 DSH 数据目录下的稳定本地插件库。打包脚本只保留官方 pnpm Node CLI 所需的 `bin`、`dist`、package manifest 和 MIT LICENSE，不携带其他平台的 standalone executable artifacts；pnpm wrapper 必须使用 `DSH_PNPM_NODE_BIN`，发行态不回退到系统 Node。所有 Profile 安装、更新和卸载仍转发到官方 `dsh plugin --profile` 命令；本地插件库不是第二份安装状态。

本轮又收紧了两个变更边界：官方 Profile 安装或卸载命令返回后，服务会重新读取权威 Profile 并执行 `--dump-config`，最终图不匹配或无法加载时不会返回成功；固定产物的 tarball 名称必须是单层 `.tgz` 文件，且来源路径不能越出产物目录。`dsh-profile-plugin-service.test.mjs` 和 `dsh-profile-initialization.test.mjs` 分别覆盖最终图失败、命令失败和路径越界。

本轮生产依赖审计发现原随包 `pnpm@8.15.3` 命中 high advisories，已升级到官方修复版本 `11.22.0`；`npm run audit:prod` 现通过，electron 目标为 0 high、0 critical，server 和 renderer 仅保留已有明确不适用记录。精简后的 arm64 随包 pnpm runtime 为 `19,768,614` bytes，仍通过 20 MB 预算和真实离线安装回归。

`@vibeinging/dsh-model-inheritance` 已在纯官方 Web Profile 通过官方命令安装和真实 Electron 启动检查。`@linxin666/dsh-client-ui-task-board@0.1.20` 已完成固定版本网络预检、官方 Web 激活、真实 Electron 启动、官方卸载命令和重启保持检查；它目前仍是可选社区候选，不进入默认精选。`@linxin666/dsh-web-ui-all`、Better Sidebar、远程 Web、SSH、图像理解、Agent 预设和社区插件管理器均未进入发行 Profile。

2026-08-21 通过 `npm run test:release:community` 重新运行了 task-board 的真实网络回归；临时 DSH Profile 完成固定版本预检、官方命令安装、官方 Web 激活、用户 patch 停用后保持依赖但不加载 Client、移除 patch 后重新激活、官方卸载、重启后 Client 消失和最终 Profile 状态检查，1 项通过，0 项失败。该命令不会使用用户现有的 DSH_HOME。

同一回归的真实 Electron fixture 还检查了官方 Web 内的 task-board 入口、五列看板、`#root` 容器归属、停用时 Client 不加载、恢复后重新激活和无旧产品 Shell；使用 `DSH_COMMUNITY_SCREENSHOT_DIR=.desktop-build/evidence/community-task-board npm run test:release:community` 已保存看板截图。截图是当前本机 Electron 的可见界面证据，不把它扩大为聚合包、皮肤中心或默认精选采用证据。

社区 Client 的固定完整性现在由官方 CLI 安装生成的 Profile `pnpm-lock.yaml` 读取并与目录中的审查值逐字比较；有审查哈希的版本缺少 lockfile 记录或发生漂移时，预检返回明确阻塞，不进入官方 Client 图。该规则同时覆盖 task-board、Chat recovery 和仅用于实验的聚合包；已由 lockfile 单元夹具和上述真实 task-board 安装回归覆盖。

本轮对首批社区 UI 候选做了当前版本复核。`@linxin666/dsh-chat-recovery@0.2.5` 的固定完整性为 `sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==`，其构建依赖 DSH `0.1.0-rc.8`；当前应用固定为 `0.1.0-rc.7`，真实 Profile 预检返回 `migration_required` 和 `DSH_PROFILE_CLIENT_SDK_MISMATCH`，因此记录为已审查但当前发行线阻塞的候选，不进入精选清单。`dsh-better-sidebar@0.14.0` 的固定完整性为 `sha512-bEjHvHnlNnKXkud+/A/kZ4VJvPt79ggHy/mKqEKfODPqLFpvdz7ZcoMCI3K4naPOw/0Wlqp6J3UDR9h2Wm6w4w==`，大小约 11.4 MB；真实预检报告 13 个 SDK 依赖仍属 rc.8，并检测到 node-pty、Shell、文件、Git 和浏览器能力，保持 `preflight-only-host-adapter-required`，不进入发行 Profile。

同日从 npm 版本列表补查到，Better Sidebar 最新仍为 `0.14.0`；最后一个声明 rc.7 peer 的 `0.13.1` 虽能通过当前 SDK 版本检查，但真实 Profile 预检仍返回 `DSH_PROFILE_CLIENT_ISOLATION_REQUIRED`，且包内继续包含 node-pty、终端、文件、Git 和浏览器工作台能力，因此也不能绕过独立 Client 隔离和高权限审查进入发行 Profile。Chat recovery 可见版本仍只有 `0.2.4`、`0.2.5`，两者均需要 rc.8。

本轮新增了社区视觉资产许可门禁。`@linxin666/dsh-web-ui-all@0.1.20` 和 `@linxin666/dsh-client-ui-skin-center@0.1.20` 的包级许可证记录为 Apache-2.0，但它们带入的 `@linxin666/dsh-skins` 资产说明包含 CC BY-NC-SA 4.0 的 Maid Atelier 皮肤；在没有逐项再分发授权前，两个目录项都标记为 `asset-license-blocked`，并由 `release-boundary` 阻止未批准视觉资产进入精选清单。发行包当前不携带皮肤中心或皮肤资产，继续使用官方外观。

## 验证层级

| 层级 | 当前证据 | 结论 |
| --- | --- | --- |
| 源码检查 | `node scripts/release-boundary.mjs --syntax`、Node syntax check、包清单和权限投影检查 | 官方 Web、恢复页、窄 Native Host、精选清单和退役包边界可检查 |
| 单元回归 | `npm run test:release` 中的 Profile、更新预检、恢复、权限、Browser Workspace、社区候选和运行时测试 | 关键状态和失败路径有回归；有条件的真实社区测试在无开关时会跳过 |
| Profile 集成 | 官方 npm DSH CLI、固定 Profile Bundle、纯官方 Web Profile、tarball SHA-256、受控 pnpm 和离线初始化测试 | 新 Profile 与已有 Profile 的状态边界已验证 |
| 真实 Electron | 官方 Web 无 preload 启动、工作区/Session/Session log/history 用户流程、portable Bundle、task-board 候选和 WebContentsView Browser Workspace smoke；另用 loopback SSE 测试模型驱动官方 LLM 适配器、问题卡片、bash 沙箱拒绝/升权、审批面板、QueueDock、允许一次和排队后的 Session history；ad hoc 包和 Developer ID 签名探针都通过本地 HTTPS feed 真实走到元数据、固定哈希下载、Profile 预检、ShipIt 替换和新版本历史回放 | Electron 页面、会话持久化路径、官方问题/审批/队列运行时契约、原生浏览器主路径和 macOS 签名更新链路已验证；loopback 模型不替代真实 DeepSeek live-model 证据 |
| 安装包 | macOS arm64 目录包、Rosetta 下真实 x64 目录包、Developer ID 签名目录包、随包 Server、官方 Web smoke、固定 tarball 和 pnpm 资源检查；子进程 `PATH=/usr/bin` 的无系统 Node/pnpm smoke；真实损坏 Bundle 恢复页；官方 CLI 卸载后重启和更新记录回放 | arm64 和 x64 目录包的断网新用户、恢复/卸载保持和官方 Web 用户流程均已建立；x64 目录包当前未签名；Apple 公证、Gatekeeper 接受、Windows 实机和最终安装器形态仍是发布门槛 |

## 本轮安装包与性能基线

2026-08-21 在 macOS arm64 目录包上运行了以下命令；同日又使用官方 Node `v24.19.0` `darwin-x64` 二进制和 Rosetta 完成 macOS x64 目录包及对应 smoke：

- `npm --prefix electron run smoke:packaged-server`
- `npm --prefix electron run smoke:packaged-app`
- `npm --prefix electron run smoke:packaged-offline`
- `npm --prefix electron run smoke:packaged-recovery`
- `npm --prefix electron run smoke:packaged-profile-authority`
- `npm --prefix electron run smoke:packaged-official-web-flow`
- `node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-offline.mjs ".desktop-build/signed-probe/mac-arm64/DSH Desktop.app"`
- `node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-recovery.mjs ".desktop-build/signed-probe/mac-arm64/DSH Desktop.app"`
- `node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-profile-authority.mjs ".desktop-build/signed-probe/mac-arm64/DSH Desktop.app"`
- `DSH_SCREENSHOT_DIR=.desktop-build/evidence/official-web-interactions npm --prefix electron run smoke:packaged-official-web-interactions`
- `npm run release:check:static`
- `npm run audit:prod`
- `npm run test:release:community`
- `npm run smoke:updater`
- `DSH_SMOKE_SIGN_IDENTITY=03587EF7C8984E0F7631EC905C26336C15C8189D node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-updater.mjs ".desktop-build/signed-probe/mac-arm64/DSH Desktop.app"`
- `(cd electron && CSC_IDENTITY_AUTO_DISCOVERY=false CSC_NAME=03587EF7C8984E0F7631EC905C26336C15C8189D ./node_modules/.bin/electron-builder --mac --arm64 --dir)`
- `DSH_PACKAGE_NODE_REEXEC=1 npm_execpath=/tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/lib/node_modules/npm/bin/npm-cli.js arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/prepare-package.mjs --platform darwin --arch x64`
- `CSC_IDENTITY_AUTO_DISCOVERY=false arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node node_modules/.bin/electron-builder --mac --x64 --dir`
- `arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/smoke-packaged-server.mjs "release/mac/DSH Desktop.app"`
- `arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/smoke-packaged-offline.mjs "release/mac/DSH Desktop.app"`
- `arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/smoke-packaged-recovery.mjs "release/mac/DSH Desktop.app"`
- `arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/smoke-packaged-profile-authority.mjs "release/mac/DSH Desktop.app"`
- `DSH_SCREENSHOT_DIR=.desktop-build/evidence/official-web-x64.Ev0qMl arch -x86_64 /tmp/dsh-node-x64.f8KWLi/node-v24.19.0-darwin-x64/bin/node electron/scripts/smoke-packaged-official-web-flow.mjs "release/mac/DSH Desktop.app"`

官方 Web CDP 流程 smoke 使用临时用户目录和不继承用户环境的系统 PATH，主动清除 `DEEPSEEK_API_KEY`，通过真实随包 Electron 页面完成首次提示、官方 `workspace.create` 测试夹具、官方 Web 新建 Session、输入并发送消息、可见的 Session log、`session.list` 和 `session.history` 回读，再检查页面没有 `window.electronAPI` 或 Node 全局。无密钥时模型请求按预期显示 `MISSING_CREDENTIAL`，这条失败也属于官方 Web 的可见 Session 结果，不把它写成模型成功。命令支持 `DSH_SCREENSHOT_DIR=/path` 持久化官方 Web 截图；本次 smoke 的审批和队列没有伪造覆盖，必须在有工具调用的 live-model 环境单独验证。

官方 Web 交互 smoke 使用同一 macOS arm64 打包 Electron，但把 DSH 官方 DeepSeek 适配器的 loopback endpoint 指向脚本内的确定性 SSE 测试服务，并设置 `DEEPSEEK_API_KEY` 仅作为测试凭据；它没有访问外网或真实模型。第一轮由测试模型发起 `ask_user_question`，官方 Web 问题卡片显示选项，脚本选择并提交“继续执行”；随后 bash 写入 Profile 工作区之外的临时 marker，真实沙箱返回拒绝；第二轮由测试模型提交相同命令及 `danger-full-access` 与 justification，官方审批服务向官方 Web 发布审批卡片，点击 `Allow once` 后真实写入 marker。此期间通过官方 `session.prompt({ mode: "queue" })` 接受第二条消息，官方 `session/queue` 投影渲染 QueueDock，首轮完成后排队消息再次经过官方 LLM 和 Session history。脚本还检查了实际 marker 内容为 `approved\n`，所以没有把模型文本当成工具成功证据。本次截图保存在 `electron/.desktop-build/evidence/official-web-interactions/official-web-approval-queue.png`、`official-web-question-pending.png`、`official-web-approval-pending.png` 和 `official-web-session-flow.png`；这是本机 smoke 归档，不等同于公开安装录制或真实 DeepSeek 服务验收。

 Developer ID arm64 目录包上又生成了四帧本地 GIF `electron/.desktop-build/evidence/official-web-interactions-signed/dsh-official-web-loopback.gif`（1200x772、9 秒、168497 字节），覆盖已完成、问题等待、审批等待和审批/队列结果；它的真实来源是当前签名 Electron 与 loopback SSE 测试模型，不能替代公开安装录制或真实 DeepSeek live-model 证据。

断网新用户 smoke 使用不继承用户环境的系统 PATH、临时 HOME、`npm_config_offline=true` 和 `pnpm_config_offline=true`；它通过了官方 Web 启动、7 个固定 tarball 的 SHA-256 校验和稳定本地插件库检查，最新 Developer ID arm64 目录包预算门禁观测的 `cold_web_ms` 为 `8645`（同一签名包的独立 smoke 曾观测 `4965`、`8928`、`4349`、`8688`；此前观测为 `8184`、`7327`、`4201`、`5053`、`5147`、`4718`、`7727`、`4967`、`4492`、`7754`），初始化后数据目录大小为 `2708180` 字节。最新目录包上的 Profile authority smoke 在同一套无系统 Node/pnpm、离线、`auto-install-peers=false` 的受控环境中，先通过用户级 patch 和官方 `--dump-config` 停用了 portable Bundle `@vibeinging/dsh-model-inheritance`，验证停用后的重启和更新回放均不改写 Profile；随后用随包 DSH CLI 官方 remove 命令卸载它，验证卸载后的重启和更新回放也不恢复 Bundle。该 smoke 还确认精选默认输入不会覆盖上述用户选择；Developer ID 签名探针上的离线初始化、损坏 Bundle 恢复和同一 Profile authority 回归也均通过。

在同一台 Apple Silicon 主机上，使用官方 Node `v24.19.0` `darwin-x64` 二进制并通过 Rosetta 准备依赖后，x64 目录包的随包 Server、断网新用户 Profile、损坏 Bundle 恢复、Profile authority 和官方 Web Session/log/history 流程也均通过；x64 目录包随包 pnpm runtime 也确认为 `11.22.0`，官方 Web smoke 截图为 `.desktop-build/evidence/official-web-x64.Ev0qMl/official-web-session-flow.png`，最新串行断网 smoke 的 Rosetta 冷启动观测为 `121710` ms。该观测明显包含 Rosetta 成本，不替代原生 x64 机器的性能验收；x64 目录包也未签名，不能替代 Windows、Developer ID、公证或 Gatekeeper 证据。

当前发行预算保存在 `scripts/release-budgets.json`，由 `npm run check:release:budgets` 重新运行断网随包 smoke 并检查。2026-08-21 的 macOS arm64 结果如下：

本轮在提交 `a30c263` 建立了临时干净 worktree，从三套 `package-lock.json` 重新安装 Renderer、Server 和 Electron 依赖，再运行 `npm run doctor`、完整 `test:release` 和 `npm run release:check:static`：136 项中 134 项通过、2 项按条件跳过、0 项失败，静态门禁 12/12。此前集中在 Office/Canvas Agent scope 和产品身份的 4 项基线失败已由 `6806ed5` 的独立身份收口修复；该结果证明了干净源码和全新依赖安装的基线，不替代平台安装器、签名和公证验证。

| 项目 | 当前观测 | 预算 |
| --- | ---: | ---: |
| `DSH Desktop.app` | `1,183,526,138` bytes | `1,400,000,000` bytes |
| 随包 Server 资源 | `847,700,719` bytes | `1,000,000,000` bytes |
| 随包 pnpm runtime | `19,730,990` bytes | `20,000,000` bytes |
| 7 个精选插件 tarball | `22,002` bytes | `64,000` bytes |
| 断网新 Profile 数据目录 | `2,708,180` bytes | `4,000,000` bytes |
| 官方 Web 冷启动 | `4,397` ms | `10,000` ms |

Tarball 的逐包体积、哈希、许可和权限以随包 `featured-plugins/manifest.json`、`permissions.json`、`THIRD_PARTY_NOTICES.md` 和 `test-expected.json` 为准；预算门禁只接受重新生成的产物和新一轮 smoke 结果。

Browser Workspace smoke 先通过 Electron `capturePage` 截图；当前 Viz 合成器返回 `UnknownVizError` 时，Native Host 会在同一个受控 `webContents` 上回退到 DevTools `Page.captureScreenshot`，本轮真实 Electron smoke 使用 `DSH_BROWSER_SCREENSHOT_DIR=.desktop-build/evidence/browser-workspace.<run> npm run smoke:browser-workspace` 保存了 700x560 PNG 并完成可视检查。其余导航、标签、下载、历史、查找、缩放、沙箱和页面抓取也单独通过。

更新器 smoke 在临时旧 App 中使用本地 HTTPS feed、真实 `electron-updater`、固定 SHA-512 zip 和真实 Profile 预检。它先用随包固定 tarball 和官方 `dsh plugin --profile` 命令建立完整 Profile，再官方卸载 portable Bundle `@vibeinging/dsh-model-inheritance`；旧 App 的精选输入随后暂时移除该项，更新归档恢复完整精选清单，但 Developer ID 签名探针更新完成后，Profile manifest、Profile patch 保持字节不变，已卸载 Bundle 没有被恢复。ad hoc 目录包按预期在 ShipIt 代码签名校验处记录 `failed-to-start`；使用 Developer ID 身份 `03587EF7C8984E0F7631EC905C26336C15C8189D` 的签名目录包则完成下载、Profile 预检、ShipIt 替换和新版本 `success` 历史回放，更新归档为 `440961625` bytes。最新正式 arm64 目录包包含 `com.vibeinging.dsh-desktop`，也使用同一身份完成签名，`codesign --verify --deep --strict` 通过；由于本机缺少 `APPLE_APP_SPECIFIC_PASSWORD`，公证没有开始，Gatekeeper 明确返回 `source=Unnotarized Developer ID`，因此仍不把它写成公开安装器已完成。

本轮新增 Windows x64 安装器验收自动化，但尚未把它写成 Windows 实机证据。`electron/scripts/smoke-windows-acceptance.mjs` 只允许在 `win32/x64` 执行：它从 `release/` 找到 NSIS 安装器，在独立临时目录静默安装，等待已安装的主程序和 `resources`，依次运行随包 Server、App、官方 Web 问题/沙箱/审批/队列、断网 Profile、恢复页和 Profile authority smoke，然后通过官方卸载器清理并确认临时目录消失。所有检查通过后才用原子重命名生成 `release/windows-x64-acceptance.json`；脚本失败会删除旧回执，不会留下通过状态。`scripts/windows-acceptance-receipt.mjs` 要求 9 个检查全部成功，`release-safety` 现在按该契约校验回执，`.github/workflows/windows-release.yml` 在 unsigned NSIS 构建后运行该步骤并上传安装器与回执。当前 macOS 工作区没有运行这条 Windows 脚本，也没有生成回执，因此 Windows 实机和签名证据仍保持阻塞。

## 尚未满足的公开发行门槛

- Better Sidebar 和 Chat recovery 已完成当前 npm 元数据、固定哈希、权限和 Profile 预检审查，但 Better Sidebar 的高权限与 rc.8 依赖、Chat recovery 的 rc.8 依赖都未通过当前 rc.7 发行线；二者没有晋级为随包插件，不能把候选登记写成采用完成。
- 社区皮肤资产尚未有可再分发的许可和来源证据，发行包继续使用官方外观，不携带自研主题状态或未经审查的皮肤。
- 当前证据已经包含 Developer ID 签名目录包的断网初始化、Profile authority、损坏 Bundle 恢复和真实签名 updater 替换回归，但还不是 Apple 公证、Gatekeeper 接受、Windows 实机和最终安装器形态的全平台证据；最新 arm64 目录包上的断网干净用户首启、官方卸载后重启/更新记录回放、破坏插件恢复页和预算门禁已通过。
- macOS x64 目录包已经通过独立的官方 Node `v24.19.0` x64 运行时和 Rosetta 构建；当前尚缺原生 x64 主机或发行 CI 上的签名、安装器和性能验收，不能把本机 Rosetta 目录包写成正式 x64 发布证据。
- 官方 Web 的审批/队列截图和 Browser Workspace 页面截图已通过本机真实 Electron smoke 持久化；公开截图和安装录制仍需在发行环境重新采集，loopback 模型也不替代真实 DeepSeek 服务验收。

因此，当前实现可以作为“官方 Web + Profile 权威 + 离线插件基础 + 窄 Electron Host + 恢复页”的开发基线，但在上述高等级证据补齐前，不标记为最终公开发行完成。
