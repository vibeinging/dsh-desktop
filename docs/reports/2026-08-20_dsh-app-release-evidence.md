# DSH Desktop 发行版转型实施证据

日期：2026-08-21

本报告记录发行版转型当前已经取得的证据，以及还不能越级宣称完成的发行门槛。它对应 [发行方案](../plans/2026-08-20_dsh-app-发行版转型最终方案.md)，不把源码检查、单元测试、Profile 集成、真实 Electron 和安装包验证混为同一层证据。

## 已实施的运行边界

- Electron 主窗口只加载官方 `dsh-web-app` loopback surface，不再向官方 Web 注入产品 preload、Node 或通用 IPC。
- Browser Workspace 保留在主进程，通过方法白名单、Session 请求关联、目标 URL、路径和权限校验提供窄 Native Host 服务；同一个 session-bound Desktop Adapter 现在还提供用户可见的文件/目录打开对话框和有限窗口状态、聚焦、最小化、最大化、恢复操作，不提供任意路径写入、关闭应用、shell 或通用 IPC。
- 启动失败进入本地恢复页；重试、安全 Profile、打开 Profile、用户确认移除插件和隐私过滤诊断都是独立动作，原 Profile 不因恢复而被改写。
- Profile 初始化只在新 Profile 上执行。已有 Profile 的启动和状态查询读取官方清单、依赖和最终图，不补回或隔离用户 Bundle；用户 patch 停用的 Bundle 也保持在官方配置图之外，不被应用改写。
- 应用更新安装前执行当前 Profile 和 `--dump-config` 只读预检；预检失败不会创建待安装记录或调用 `quitAndInstall`。
- 自研替换 Shell、旧产品 Client UI、工作台目录和自研主题包已从发行包输入中移除；旧 Renderer 源码、独立依赖、测试和构建入口已从仓库删除。
- 默认 `npm run dev` 直接启动官方 DSH Web Electron 路径；默认 `bootstrap`、`doctor`、生产依赖审计和 CI 只覆盖 Server/Electron，官方 Web 资源校验使用 `verify:official-web-assets`，不再保留 legacy Renderer 维护命令。
- `eda9ced` 又删除了 5 个漏列在 release suite 之外、仍读取 `renderer/src` 的旧 UI 测试；`app-zoom` 仅保留官方 Web 的 Electron Host 缩放锁定，审计测试明确只覆盖 Server/Electron。`release-boundary` 现在扫描 `eval/tests` 和 `scripts` 的退役源码读取，负例回归覆盖拒绝旧路径和允许当前 Electron renderer 概念。
- 对现存 arm64 目录包和 Developer ID 签名 arm64 目录包的 `Contents/Resources` 做了实际资源名与二进制文本扫描：只发现官方 `@deepseek-ai/dsh-client-ui-theme`、`@deepseek-ai/dsh-shell` 等运行时资源，没有 `dsh-theme-pack`、`dsh-work-shell`、`dsh-workbench-pages`、`profileThemes` 或 `skin-settings-store` 残留；这项证据补充了源码发行边界检查。

## 精选输入和插件证据

唯一精选输入是 `server/src/engine/dsh_runtime/featured_plugins.json`。它由脚本生成固定 tarball、SHA-256 manifest、Profile 安装输入、权限摘要、第三方公告和测试预期。当前默认输入是 7 个 `@vibeinging/*` Host、portable 或 desktop-adapter Bundle，不包含替换式 UI。

2026-08-21 将生成器运行到两个独立临时目录，manifest 与 7 个 tarball 均逐字节一致，复现检查通过；这证明的是精选产物生成链路，不替代干净发行环境的完整安装验证。

公开 README 的默认 Bundle 明细不再维护第二份手写名单。`scripts/generate-featured-plugin-docs.mjs` 从同一精选 JSON 生成中英文表格中的包名、类型、权限、来源和官方管理方式；`dsh-trusted-client-plugins.test.mjs` 与 `release-boundary` 会检查表格行数和字段是否仍与精选输入一致。桌面基础服务显式标记为不可由用户卸载，避免文档和 Profile 服务暗示不存在的卸载路径。

精选产物生成器现在还会在 `npm pack` 前校验包 manifest 的 `dshWork.portability.level`、有序 `hostRequirements` 与精选清单的 portability、permissions 完全一致；漂移会阻止 tarball、权限摘要和第三方公告生成。定向回归覆盖有效契约和两类漂移，临时目录生成全部 7 个精选 Bundle 成功。

本轮许可审计核对了 7 个源包的 `package.json`：它们均声明 `BSD-3-Clause`，精选清单已对齐该许可证；生成器现在会拒绝包名、源路径或许可证漂移，并把仓库内的许可证原文复制到随包 `featured-plugins/licenses/`；随包公告同时写入许可证文件、相对源路径和 tarball SHA-256。

固定 tarball 通过安装包内的受控 `pnpm@11.22.0` 进入 DSH 数据目录下的稳定本地插件库。打包脚本只保留官方 pnpm Node CLI 所需的 `bin`、`dist`、package manifest 和 MIT LICENSE，不携带其他平台的 standalone executable artifacts；pnpm wrapper 必须使用 `DSH_PNPM_NODE_BIN`，发行态不回退到系统 Node。所有 Profile 安装、更新和卸载仍转发到官方 `dsh plugin --profile` 命令；本地插件库不是第二份安装状态。

精选清单现在还生成逐包 `evaluation.json` 投影，记录源码入口、固定 tarball、DSH/Cordis 兼容线、生命周期脚本、原生依赖、网络声明、Client 参与、官方 Profile 安装/卸载命令和 unit/Profile/Electron 回归路径；`release-boundary` 会拒绝该投影与 manifest 漂移。桌面基础服务另外声明 `desktop_runtime_required`，源码和打包版测量均只验证安装/启动，并把卸载记录为被桌面运行时契约阻止。`scripts/measure-featured-plugin-evidence.mjs` 用同一批固定 tarball 对每个精选包执行官方 CLI 安装、Web 启动、用户 patch 停用、官方卸载和卸载后重启，输出的是源码 Profile 集成证据，不替代真实 Electron 或安装包验收。

同一证据字段还记录每个 Bundle 的 `composition.plugin_id`、依赖服务、提供服务、路由、Slot 和已知冲突；清单加载时拒绝与 patch 不一致的插件 id，并拒绝多个精选 Bundle 重复提供同一个服务。当前 7 个 Host/portable 条目没有声明路由、Slot 或冲突；基础服务唯一提供 `productHost`、`officeArtifactHost` 和 `browserWorkspaceHost`，其余条目只声明所需的官方 Agent、Tool 或 Host 服务。

`generate-featured-plugin-artifacts.mjs` 生成前还会读取每个包的真实入口和 `cordis.patch.yml`，将源码 `name`、`inject` 和 patch id 与精选组合记录逐项比较；组合证据不能只靠 JSON 手写通过。

2026-08-21 的逐包测量命令为 `npm run measure:featured-plugins -- --output .desktop-build/reports/featured-plugin-evaluation.json`，运行环境为 macOS arm64、Node `v26.5.0`。7/7 个包通过；除桌面基础服务外的 6 个条目都额外安装清单已声明的 `@vibeinging/dsh-work-product-host-ipc` 支持 Bundle，以便验证真实的 Profile provider 依赖，不把无 Host 的 standalone Web 启动失败误判为包自身通过。表中的 Profile 数据目录大小是安装后总量（包含 DSH 官方依赖和声明的支持 Bundle），tarball 大小才是逐包随包增量；冷启动是源码 DSH CLI 到 loopback Web ready 的观测。

| 精选包 | tarball bytes | 支持 Bundle | 安装后 Profile bytes | CLI cold Web ms | 生命周期 |
| --- | ---: | --- | ---: | ---: | --- |
| `@vibeinging/dsh-work-product-host-ipc` | 3,836 | 无 | 52,798 | 502 | 安装、启动通过；基础服务卸载被桌面契约阻止 |
| `@vibeinging/dsh-project-tools` | 2,174 | `dsh-work-product-host-ipc` | 71,480 | 525 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-canvas-tools` | 3,039 | `dsh-work-product-host-ipc` | 78,318 | 525 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-structured-ui-tools` | 2,325 | `dsh-work-product-host-ipc` | 72,032 | 533 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-model-inheritance` | 2,178 | `dsh-work-product-host-ipc` | 72,380 | 498 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-product-bridge` | 5,637 | `dsh-work-product-host-ipc` | 86,618 | 524 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-office-tools` | 2,810 | `dsh-work-product-host-ipc` | 77,260 | 499 | 安装、启动、停用、卸载、重启通过 |

同日对重新生成并使用 Developer ID 签名的 macOS arm64 目录包执行 `npm run smoke:featured-plugins:packaged`（本次显式关闭公证）。7/7 个精选包通过打包版 Electron Profile 集成：基础服务安装/启动通过且卸载被契约阻止；其余 6 个包均完成随包 tarball 安装、Electron 启动、只读停用、官方卸载和重启，模型继承也在带基础服务支持 Bundle 的真实打包环境中通过。该结果是当前签名 arm64 目录包的真实 Electron 证据，不等同于公证、Gatekeeper 或最终安装器验收。

| 精选包 | 支持 Bundle | 安装后 Profile bytes | Electron cold Web ms | 卸载后 cold Web ms | 生命周期 |
| --- | --- | ---: | ---: | ---: | --- |
| `@vibeinging/dsh-work-product-host-ipc` | 无 | 48,606 | 3,669 | — | 安装、启动通过；基础服务卸载被桌面契约阻止 |
| `@vibeinging/dsh-project-tools` | `dsh-work-product-host-ipc` | 67,106 | 3,176 | 3,152 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-canvas-tools` | `dsh-work-product-host-ipc` | 73,942 | 3,235 | 3,446 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-structured-ui-tools` | `dsh-work-product-host-ipc` | 67,670 | 3,227 | 3,089 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-model-inheritance` | `dsh-work-product-host-ipc` | 68,014 | 3,105 | 3,196 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-product-bridge` | `dsh-work-product-host-ipc` | 82,246 | 3,285 | 3,075 | 安装、启动、停用、卸载、重启通过 |
| `@vibeinging/dsh-office-tools` | `dsh-work-product-host-ipc` | 72,884 | 3,265 | 3,178 | 安装、启动、停用、卸载、重启通过 |

本轮又收紧了两个变更边界：官方 Profile 安装或卸载命令返回后，服务会重新读取权威 Profile 并执行 `--dump-config`，最终图不匹配或无法加载时不会返回成功；固定产物的 tarball 名称必须是单层 `.tgz` 文件，且来源路径不能越出产物目录。`dsh-profile-plugin-service.test.mjs` 和 `dsh-profile-initialization.test.mjs` 分别覆盖最终图失败、命令失败和路径越界。

本轮生产依赖审计发现原随包 `pnpm@8.15.3` 命中 high advisories，已升级到官方修复版本 `11.22.0`；`npm run audit:prod` 现通过，Electron 目标为 0 high、0 critical，Server 仅保留已有明确不适用记录。精简后的 arm64 随包 pnpm runtime 为 `19,768,614` bytes，仍通过 20 MB 预算和真实离线安装回归。

`@vibeinging/dsh-model-inheritance` 已在纯官方 Web Profile 通过官方命令安装和真实 Electron 启动检查。`@linxin666/dsh-client-ui-task-board@0.1.20` 已完成固定版本网络预检、官方 Web 激活、真实 Electron 启动、官方卸载命令和重启保持检查；它目前仍是可选社区候选，不进入默认精选。`@linxin666/dsh-web-ui-all`、Better Sidebar、远程 Web、SSH、图像理解、Agent 预设和社区插件管理器均未进入发行 Profile。

2026-08-21 通过 `npm run test:release:community` 重新运行了 task-board 的真实网络回归；临时 DSH Profile 完成固定版本预检、官方命令安装、官方 Web 激活、用户 patch 停用后保持依赖但不加载 Client、移除 patch 后重新激活、官方卸载、重启后 Client 消失和最终 Profile 状态检查，1 项通过，0 项失败。该命令不会使用用户现有的 DSH_HOME。

同一回归的真实 Electron fixture 还检查了官方 Web 内的 task-board 入口、五列看板、`#root` 容器归属、停用时 Client 不加载、恢复后重新激活和无旧产品 Shell；使用 `DSH_COMMUNITY_SCREENSHOT_DIR=.desktop-build/evidence/community-task-board npm run test:release:community` 已保存开发态看板截图。本轮又在独立的当前 arm64 目录包中运行 `node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-community.mjs <独立 .app>`，通过受控 loopback 端口、首次提示关闭和真实官方命令安装/卸载，保存了安装前 `official-web-before-install.png`、激活态 `task-board-packaged.png` 和卸载后 `official-web-after-uninstall.png` 三帧，并按真实时间顺序编码为 `.desktop-build/evidence/community-task-board-packaged-recording/community-install-run-uninstall.gif`；激活态截图是当前公开 README 的候选图，卸载后截图证明官方 Web 基线恢复。三帧和 GIF 是当前本机 Electron 的可见界面证据，不把它扩大为聚合包、皮肤中心、默认精选采用或真实 DeepSeek live-model 证据。

公开 README 当前只保留两张从真实 Electron smoke 产出的截图：官方 Web Session/轨迹的 loopback SSE 截图，以及当前 arm64 打包版官方 Web 根节点内的 task-board 候选截图；旧首页、旧 Chat、旧 Profile 中心、旧主题和旧工作台图片已从公开素材目录移除。第一张不是真实 DeepSeek live-model 证据，第二张不代表默认精选采用；真实 DeepSeek 安装录制仍需在有凭据的发行环境完成。

本轮新增 `npm run smoke:community:packaged`。它在临时用户目录和仅含系统目录加随包 pnpm 的 PATH 下，先由打包版 App 创建精选 Profile，再用打包版 Electron Node 执行官方 `dsh plugin --profile web add` 安装 task-board；候选启动回归检查官方 Web、task-board 入口和五列看板，随后用官方 remove 命令离线卸载并重启，确认入口消失。该回归还覆盖了 Electron 内嵌 Node 对 Profile `node_modules` 的解析修复（提交 `2f1b119`）；命令通过，证明的是当前 arm64 打包版的真实 Electron Client 激活和卸载保持，不把它扩大为默认精选采用或公开安装器证据。

社区 Client 的固定完整性现在由官方 CLI 安装生成的 Profile `pnpm-lock.yaml` 读取并与目录中的审查值逐字比较；有审查哈希的版本缺少 lockfile 记录或发生漂移时，预检返回明确阻塞，不进入官方 Client 图。该规则同时覆盖 task-board、Chat recovery 和仅用于实验的聚合包；已由 lockfile 单元夹具和上述真实 task-board 安装回归覆盖。

本轮对首批社区 UI 候选做了当前版本复核。`@linxin666/dsh-chat-recovery@0.2.5` 的固定完整性为 `sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==`，其构建依赖 DSH `0.1.0-rc.8`；当前应用固定为 `0.1.0-rc.7`，真实 Profile 预检返回 `migration_required` 和 `DSH_PROFILE_CLIENT_SDK_MISMATCH`，因此记录为已审查但当前发行线阻塞的候选，不进入精选清单。`dsh-better-sidebar@0.14.0` 的固定完整性为 `sha512-bEjHvHnlNnKXkud+/A/kZ4VJvPt79ggHy/mKqEKfODPqLFpvdz7ZcoMCI3K4naPOw/0Wlqp6J3UDR9h2Wm6w4w==`，大小约 11.4 MB；真实预检报告 13 个 SDK 依赖仍属 rc.8，并检测到 node-pty、Shell、文件、Git 和浏览器能力，保持 `preflight-only-host-adapter-required`，不进入发行 Profile。

同日从 npm 版本列表补查到，Better Sidebar 最新仍为 `0.14.0`；最后一个声明 rc.7 peer 的 `0.13.1` 虽能通过当前 SDK 版本检查，但真实 Profile 预检仍返回 `DSH_PROFILE_CLIENT_ISOLATION_REQUIRED`，且包内继续包含 node-pty、终端、文件、Git 和浏览器工作台能力，因此也不能绕过独立 Client 隔离和高权限审查进入发行 Profile。Chat recovery 可见版本仍只有 `0.2.4`、`0.2.5`，两者均需要 rc.8。

本轮还直接下载并比较了官方 `@deepseek-ai/dsh@0.1.0-rc.8` 与 `@deepseek-ai/dsh-web-app@0.1.0-rc.8` 的实际 npm 产物。rc.8 的 Web patch 新增 `session-reference`、`file-reference-local`、`ui-renderer`、官方 brand/attachment/reference 行，并加入 `openBrowser` 配置；`dsh` 同时替换整套 rc.7 运行时依赖图。当前桌面 patch 没有显式声明 rc.8 的 `openBrowser` 行或新 Client roster，因此不能只改一个版本号来解除 Chat recovery 阻塞；必须先完成整套 lockfile、Profile 图、协议和真实 Electron 回归。

本轮新增了社区视觉资产许可门禁。`@linxin666/dsh-web-ui-all@0.1.20` 和 `@linxin666/dsh-client-ui-skin-center@0.1.20` 的包级许可证记录为 Apache-2.0，但它们带入的 `@linxin666/dsh-skins` 资产说明包含 CC BY-NC-SA 4.0 的 Maid Atelier 皮肤；在没有逐项再分发授权前，两个目录项都标记为 `asset-license-blocked`，并由 `release-boundary` 阻止未批准视觉资产进入精选清单。发行包当前不携带皮肤中心或皮肤资产，继续使用官方外观。

## 验证层级

| 层级 | 当前证据 | 结论 |
| --- | --- | --- |
| 源码检查 | `node scripts/release-boundary.mjs --syntax`、Node syntax check、包清单和权限投影检查 | 官方 Web、恢复页、窄 Native Host、精选清单和退役包边界可检查 |
| 单元回归 | `npm run test:release` 中的 Profile、更新预检、恢复、权限、Browser Workspace、社区候选和运行时测试 | 关键状态和失败路径有回归；有条件的真实社区测试在无开关时会跳过 |
| Profile 集成 | 官方 npm DSH CLI、固定 Profile Bundle、纯官方 Web Profile、tarball SHA-256、受控 pnpm 和离线初始化测试；`npm run measure:featured-plugins` 对 7 个精选包逐包完成安装和启动，6 个可管理包完成停用、卸载和重启；基础服务卸载被契约阻止 | 新 Profile 与已有 Profile 的状态边界已验证；逐包源码 Profile 生命周期通过，并有逐包打包版 Electron 证据 |
| 真实 Electron | 官方 Web 无 preload 启动、逐精选包 arm64 打包版 Profile 安装/启动/停用/卸载/重启、工作区/Session/Session log/history 用户流程、portable Bundle、task-board 候选、打包版社区插件安装/激活/卸载/重启和 WebContentsView Browser Workspace smoke；另用 loopback SSE 测试模型驱动官方 LLM 适配器、问题卡片、bash 沙箱拒绝/升权、审批面板、QueueDock、允许一次和排队后的 Session history；ad hoc 包和 Developer ID 签名探针都通过本地 HTTPS feed 真实走到元数据、固定哈希下载、Profile 预检、ShipIt 替换和新版本历史回放；独立 arm64 打包包又通过官方 Web Tool 到 Electron 窗口 Host 的真实状态、聚焦、最小化、最大化、恢复，以及文件/目录对话框的真实选择链路 | Electron 页面、会话持久化路径、官方问题/审批/队列运行时契约、原生浏览器主路径、macOS 窗口 Host、macOS 文件/目录对话框和 macOS 签名更新链路已验证；窗口 Host 的跨平台用户交互验收仍缺；loopback 模型不替代真实 DeepSeek live-model 证据 |
| 安装包 | macOS arm64 目录包、Rosetta 下真实 x64 目录包、Developer ID 签名目录包、未公证 arm64/x64 DMG/ZIP、随包 Server、官方 Web smoke、固定 tarball 和 pnpm 资源检查；子进程 `PATH=/usr/bin` 的无系统 Node/pnpm smoke；真实损坏 Bundle 恢复页；官方 CLI 卸载后重启和更新记录回放；独立 arm64 打包 Electron 的 session-bound 窗口及文件/目录 Host smoke；x64 DMG 在 Rosetta 下的挂载、复制和社区 Profile 生命周期 smoke | arm64 和 x64 目录包的断网新用户、恢复/卸载保持和官方 Web 用户流程均已建立；当前 arm64/x64 目录包均完成 Developer ID 签名和严格完整性检查；macOS arm64 文件/目录对话框回执以及 x64 DMG Rosetta 安装器回执已通过；跨平台窗口、Apple 公证容器、Gatekeeper、Windows 实机和原生 x64 性能仍是发布门槛 |

## Session-bound Native Host 实机证据

在独立的未签名 macOS arm64 打包目录 `release/native-host-smoke/mac-arm64/DSH Desktop.app` 上运行 `DSH_NATIVE_HOST_TIMEOUT_MS=20000 node scripts/run-with-project-node.mjs node electron/scripts/smoke-packaged-native-host.mjs release/native-host-smoke/mac-arm64/'DSH Desktop.app'`，结果为 PASS。测试先用随包 DSH CLI 通过官方 `dsh plugin --profile web add -w` 安装测试 Bundle，再用官方 Web Session 和 loopback SSE 测试模型让模型真实调用 `native_host_window_smoke`；调用链完成 `windowGetState`、`windowFocus`、`windowMinimize`、`windowMaximize` 和 `windowRestore`，工具结果回到官方 Web 后，测试又通过官方 `dsh plugin --profile web remove` 离线卸载 Bundle。该证据覆盖的是 macOS arm64 窗口 Host 链路和 native-only Session 授权，不等同于文件/目录对话框或跨平台实机验收。

随后在同一打包目录上运行 `npm run smoke:native-host:dialogs` 对应的 `--dialogs` 模式，使用本次运行生成的测试文件和目录完成两次 macOS 原生面板选择。结果回执 `electron/.desktop-build/evidence/native-host-dialogs/result.json` 的 `status` 为 `passed`、`evidence_level` 为 `packaged-electron-native-host-dialogs`，检查包括官方 Profile 安装、官方 Web Tool、session-bound 文件选择、session-bound 目录选择和官方 Profile 卸载；截图已归档到同一目录。该证据覆盖 macOS arm64 文件/目录对话框，不替代跨平台窗口或其他架构验收。

本轮新增 `npm run smoke:native-host:dialogs` 手动模式和对应的 `native_host_file_dialog_smoke` 工具，源码回归覆盖了文件和目录方法、Session 路由、长时但有上限的交互等待和通过官方 Profile 命令卸载测试 Bundle。Computer Use 已在 macOS arm64 打包 Electron 中打开两个原生面板，选择本次运行的测试文件和目录，收到官方 Web Tool 的完整结果，并生成 `packaged-electron-native-host-dialogs` 通过回执。该命令仍保留为后续发行环境的人工验收入口；跨平台窗口交互和原生 x64 仍需对应环境验证。

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
- `npm run smoke:community:packaged`
- `node electron/scripts/smoke-packaged-community.mjs ".desktop-build/release-mac-x64-loader/mac/DSH Desktop.app"`
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

官方 Web CDP 流程 smoke 使用临时用户目录和不继承用户环境的系统 PATH，主动清除 `DEEPSEEK_API_KEY`，通过真实随包 Electron 页面完成首次提示、官方 `workspace.create` 测试夹具、官方 Web 新建 Session、输入并发送消息、可见的 Session log、`session.list` 和 `session.history` 回读，再检查页面没有 `window.electronAPI` 或 Node 全局。无密钥时模型请求按预期显示 `MISSING_CREDENTIAL`，这条失败也属于官方 Web 的可见 Session 结果，不把它写成模型成功。命令支持 `DSH_SCREENSHOT_DIR=/path` 持久化官方 Web 截图；带 `--live-model` 且成功时，额外用 `DSH_LIVE_MODEL_RESULT_FILE=/path/result.json` 写入不含凭据的 `dsh.live-model.evidence.v1` 回执，失败或无密钥会删除旧回执；本次 smoke 的审批和队列没有伪造覆盖，必须在有工具调用的 live-model 环境单独验证。

官方 Web 交互 smoke 使用同一 macOS arm64 打包 Electron，但把 DSH 官方 DeepSeek 适配器的 loopback endpoint 指向脚本内的确定性 SSE 测试服务，并设置 `DEEPSEEK_API_KEY` 仅作为测试凭据；它没有访问外网或真实模型。第一轮由测试模型发起 `ask_user_question`，官方 Web 问题卡片显示选项，脚本选择并提交“继续执行”；随后 bash 写入 Profile 工作区之外的临时 marker，真实沙箱返回拒绝；第二轮由测试模型提交相同命令及 `danger-full-access` 与 justification，官方审批服务向官方 Web 发布审批卡片，点击 `Allow once` 后真实写入 marker。此期间通过官方 `session.prompt({ mode: "queue" })` 接受第二条消息，官方 `session/queue` 投影渲染 QueueDock，首轮完成后排队消息再次经过官方 LLM 和 Session history。脚本还检查了实际 marker 内容为 `approved\n`，所以没有把模型文本当成工具成功证据。本次截图保存在 `electron/.desktop-build/evidence/official-web-interactions/official-web-approval-queue.png`、`official-web-question-pending.png`、`official-web-approval-pending.png` 和 `official-web-session-flow.png`；这是本机 smoke 归档，不等同于公开安装录制或真实 DeepSeek 服务验收。

 Developer ID arm64 目录包上又生成了四帧本地 GIF `electron/.desktop-build/evidence/official-web-interactions-signed/dsh-official-web-loopback.gif`（1200x772、9 秒、168497 字节），覆盖已完成、问题等待、审批等待和审批/队列结果；它的真实来源是当前签名 Electron 与 loopback SSE 测试模型，不能替代公开安装录制或真实 DeepSeek live-model 证据。

断网新用户 smoke 使用不继承用户环境的系统 PATH、临时 HOME、`npm_config_offline=true` 和 `pnpm_config_offline=true`；它通过了官方 Web 启动、7 个固定 tarball 的 SHA-256 校验和稳定本地插件库检查，2026-08-21 最新预算门禁观测的 `cold_web_ms` 为 `6016`，初始化后数据目录大小为 `2710670` 字节。最新目录包上的 Profile authority smoke 在同一套无系统 Node/pnpm、离线、`auto-install-peers=false` 的受控环境中，先通过用户级 patch 和官方 `--dump-config` 停用了 portable Bundle `@vibeinging/dsh-model-inheritance`，验证停用后的重启和更新回放均不改写 Profile；随后用随包 DSH CLI 官方 remove 命令卸载它，验证卸载后的重启和更新回放也不恢复 Bundle。该 smoke 还确认精选默认输入不会覆盖上述用户选择；Developer ID 签名探针上的离线初始化、损坏 Bundle 恢复和同一 Profile authority 回归也均通过。

此前在同一台 Apple Silicon 主机上，使用官方 Node `v24.19.0` `darwin-x64` 二进制并通过 Rosetta 准备依赖后，x64 目录包的随包 Server、断网新用户 Profile、损坏 Bundle 恢复、Profile authority 和官方 Web Session/log/history 流程均通过；x64 目录包随包 pnpm runtime 也确认为 `11.22.0`，官方 Web smoke 截图为 `.desktop-build/evidence/official-web-x64.Ev0qMl/official-web-session-flow.png`，最新串行断网 smoke 的 Rosetta 冷启动观测为 `121710` ms。该观测明显包含 Rosetta 成本，不替代原生 x64 机器的性能验收；当时的 x64 目录包未签名，不能替代 Windows、Developer ID、公证或 Gatekeeper 证据。

本轮用同一官方 Node `v24.19.0` x64 运行时重新准备当前 `HEAD` 的 x64 Server 资源，生成了 Developer ID 签名的 `release/mac/DSH Desktop.app` 以及明确关闭公证的 x64 DMG/ZIP；Server smoke、App smoke、ZIP 资源结构和 `codesign --verify --deep --strict` 均通过。此前 Rosetta 退出阶段暴露出 Server 只收到 `SIGTERM` 后可能成为孤儿的问题，已由 `7cb0805` 在启动超时、优雅退出超时和最终清理路径统一加入显式 `SIGKILL` 兜底。重新打包后，干净环境、独立 loopback 端口下的默认 x64 recovery、App、断网 Profile、Profile authority 和官方 Web smoke 均通过；Rosetta 冷启动仍不替代原生 x64 主机的性能验收。

为验证 Electron 内嵌 Node 对 Profile `node_modules` 的解析修复，本轮又用同一 x64 Node 重新准备 `.desktop-build/server`，将当前源码构建到独立的 `.desktop-build/release-mac-x64-loader/mac/DSH Desktop.app` 目录，并运行打包版社区 smoke。该未签名目录包先由 App 初始化精选 Profile，再通过官方 `dsh plugin --profile` 命令安装、激活、卸载和重启 `@linxin666/dsh-client-ui-task-board@0.1.20`，结果为 PASS；它证明当前 x64 代码路径可解析已安装 Profile Client，但不替代 Developer ID、公证、Gatekeeper、原生 x64 机器或安装器证据。

随后对 `release/dsh-desktop-0.0.1-mac-x64.dmg` 运行 `smoke:macos:installer`。第一次使用旧包默认的 90 秒本地请求上限时，Rosetta 冷启动进入恢复页并失败；在保留该失败证据后，以 `DSH_API_REQUEST_TIMEOUT_MS=300000` 重新运行，结果回执 `electron/.desktop-build/evidence/macos-installer-x64-rosetta/result.json` 为 `passed`，完成 DMG 挂载、复制、官方 Profile 安装、task-board 激活、官方卸载、重启和 DMG 卸载。该结果是 Apple Silicon 上的 Rosetta x64 安装器生命周期证据，不能替代原生 x64 主机的冷启动预算、性能或 Gatekeeper 验收。

当前发行预算保存在 `scripts/release-budgets.json`，由 `npm run package:mac:dir` 生成目录包后执行 `npm run check:release:budgets`，重新运行断网随包 smoke 并检查。2026-08-21 最新 macOS arm64 结果如下：

此前在提交 `a30c263` 建立的临时干净 worktree，从三套 `package-lock.json` 重新安装 Renderer、Server 和 Electron 依赖，再运行 `npm run doctor`、完整 `test:release` 和 `npm run release:check:static`：当时的 HEAD 为 137 项中 135 项通过、2 项按条件跳过、0 项失败，静态门禁 12/12。此前集中在 Office/Canvas Agent scope 和产品身份的 4 项基线失败已由 `6806ed5` 的独立身份收口修复；该结果是历史干净源码和全新依赖安装基线，不替代当前提交、平台安装器、签名和公证验证。

在 `eda9ced` 收口旧 UI 测试和审计引用后，独立 clean worktree `/tmp/dsh-app-cleanup-verify-eda9ced` 重新执行 `npm ci`、`npm run test:release`、`npm --prefix electron run prepare:mac`、精选 tarball 生成和 `npm run measure:featured-plugins`。最终 `test:release` 为 159 项中 154 项通过、0 项失败、5 项条件跳过；7/7 精选 Bundle 逐包测量通过；macOS static scope 和 Windows static scope 均为 13 pass、0 block、0 manual；`npm run check:release-boundary`、`npm run check:release-artifacts` 和 `npm run typecheck` 均通过。该结果仍不替代真实 Windows、真实 live-model、当前 App/DMG 公证和其他安装器证据。

| 项目 | 当前观测 | 预算 |
| --- | ---: | ---: |
| `DSH Desktop.app` | `1,183,573,007` bytes | `1,400,000,000` bytes |
| 随包 Server 资源 | `847,717,219` bytes | `1,000,000,000` bytes |
| 随包 pnpm runtime | `19,730,990` bytes | `20,000,000` bytes |
| 7 个精选插件 tarball | `22,777` bytes | `64,000` bytes |
| 断网新 Profile 数据目录 | `2,714,857` bytes | `4,000,000` bytes |
| 官方 Web 冷启动 | `8,812` ms | `10,000` ms |

Tarball 的逐包体积、哈希、许可和权限以随包 `featured-plugins/manifest.json`、`permissions.json`、`THIRD_PARTY_NOTICES.md` 和 `test-expected.json` 为准；预算门禁只接受重新生成的产物和新一轮 smoke 结果。

Browser Workspace smoke 先通过 Electron `capturePage` 截图；当前 Viz 合成器返回 `UnknownVizError` 时，Native Host 会在同一个受控 `webContents` 上回退到 DevTools `Page.captureScreenshot`，本轮真实 Electron smoke 使用 `DSH_BROWSER_SCREENSHOT_DIR=.desktop-build/evidence/browser-workspace.<run> npm run smoke:browser-workspace` 保存了 700x560 PNG 并完成可视检查。其余导航、标签、下载、历史、查找、缩放、沙箱和页面抓取也单独通过。

更新器 smoke 在临时旧 App 中使用本地 HTTPS feed、真实 `electron-updater`、固定 SHA-512 zip 和真实 Profile 预检。它先用随包固定 tarball 和官方 `dsh plugin --profile` 命令建立完整 Profile，再官方卸载 portable Bundle `@vibeinging/dsh-model-inheritance`；旧 App 的精选输入随后暂时移除该项，更新归档恢复完整精选清单，但 Developer ID 签名探针更新完成后，Profile manifest、Profile patch 保持字节不变，已卸载 Bundle 没有被恢复。ad hoc 目录包按预期在 ShipIt 代码签名校验处记录 `failed-to-start`；使用 Developer ID 身份 `03587EF7C8984E0F7631EC905C26336C15C8189D` 的签名目录包则完成下载、Profile 预检、ShipIt 替换和新版本 `success` 历史回放，更新归档为 `440961625` bytes。当前正式 arm64 目录包包含 `com.vibeinging.dsh-desktop`，使用同一身份完成签名并附加 Apple 公证票据；`npm run release:verify:mac` 的 16 项检查全部通过，Gatekeeper 返回 `source=Notarized Developer ID`。另用该目录包生成了 `release/notarized-current/dsh-desktop-0.0.1-mac-arm64.dmg` 和 ZIP；DMG 已提交 Apple 公证请求 `afefcd19-cfb8-42e8-905b-cfafcc86245d`，截至 `2026-08-21T07:21:18Z` 复核仍为 `In Progress`，因此暂不把 DMG 容器本身写成已公证。

本轮新增 Windows x64 安装器验收自动化，但尚未把它写成 Windows 实机证据。`electron/scripts/smoke-windows-acceptance.mjs` 只允许在 `win32/x64` 执行：它从 `release/` 找到 NSIS 安装器，在独立临时目录静默安装，等待已安装的主程序和 `resources`，依次运行随包 Server、App、官方 Web 问题/沙箱/审批/队列、断网 Profile、恢复页和 Profile authority smoke，然后通过官方卸载器清理并确认临时目录消失。所有检查通过后才用原子重命名生成 `release/windows-x64-acceptance.json`；脚本失败会删除旧回执，不会留下通过状态。`scripts/windows-acceptance-receipt.mjs` 要求 9 个检查全部成功，`release-safety` 现在按该契约校验回执，`.github/workflows/windows-release.yml` 在 unsigned NSIS 构建后运行该步骤并上传安装器与回执；新增的 `.github/workflows/windows-release-evidence.yml` 还提供了使用 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` 的 signed NSIS、完整回归、实机验收和 Authenticode 校验入口。当前 macOS 工作区没有运行这两条 Windows workflow，也没有生成回执，因此 Windows 实机和签名证据仍保持阻塞。

本轮新增 `npm run smoke:macos:installer -- /path/to/dsh-desktop-0.0.1-mac-arm64.dmg`：它在 macOS 上只读挂载 DMG，复制其中的 `DSH Desktop.app`，再调用现有官方 Profile 社区安装/激活/卸载/重启 smoke，最后卸载 DMG；设置 `DSH_MACOS_INSTALLER_RESULT_FILE` 会生成 `evidence_level=macos-dmg-installer-electron` 的 JSON 回执，设置 `DSH_COMMUNITY_SCREENSHOT_DIR` 会保存安装前、候选激活态和卸载后官方 Web 三帧。本轮用 `release/notarized-current/dsh-desktop-0.0.1-mac-arm64.dmg` 完成了这条真实安装器 smoke，回执和截图保存在 `electron/.desktop-build/evidence/macos-installer-stapled/`，三帧另编码为 `macos-installer-community.gif`；该 DMG 容器的公证请求 `afefcd19-cfb8-42e8-905b-cfafcc86245d` 尚在 `In Progress`，因此截图和生命周期证据不替代 DMG 容器本身的公证/Gatekeeper 门禁。

## 尚未满足的公开发行门槛

公证状态补充：`DSH Desktop.zip` 的 Apple 公证请求 `dc766028-4ac4-4736-927a-e4852de125f2` 已为 `Accepted`，当前 arm64 App 已附加票据并通过 16/16 项 macOS 发行复核；随后提交的 `release/notarized-current/dsh-desktop-0.0.1-mac-arm64.dmg` 请求 `afefcd19-cfb8-42e8-905b-cfafcc86245d` 截至 `2026-08-21T07:21:18Z` 复核仍为 `In Progress`，DMG 容器的 stapler/Gatekeeper 验证待该请求完成。

- Better Sidebar 和 Chat recovery 已完成当前 npm 元数据、固定哈希、权限和 Profile 预检审查，但 Better Sidebar 的高权限与 rc.8 依赖、Chat recovery 的 rc.8 依赖都未通过当前 rc.7 发行线；二者没有晋级为随包插件，不能把候选登记写成采用完成。
- 社区皮肤资产尚未有可再分发的许可和来源证据，发行包继续使用官方外观，不携带自研主题状态或未经审查的皮肤。
- 当前证据已经包含 Developer ID 签名目录包、明确关闭公证生成的 arm64 DMG/ZIP 安装器结构、断网初始化、Profile authority、损坏 Bundle 恢复和真实签名 updater 替换回归；DMG 的 UDZO 结构、ZIP 内 `DSH Desktop.app` 资源和 App 严格签名校验均通过，但仍不是 Apple 公证、Gatekeeper 接受、Windows 实机和最终公开安装器证据。最新 arm64 目录包上的断网干净用户首启、官方卸载后重启/更新记录回放、破坏插件恢复页和预算门禁已通过。
- macOS x64 当前已通过官方 Node `v24.19.0` x64 依赖准备、Developer ID 签名目录包/未公证安装器结构、Server/App、默认退出路径、恢复、断网 Profile、Profile authority、官方 Web smoke，以及 Apple Silicon 上 Rosetta x64 DMG 挂载/复制后的社区 Profile 生命周期；仍尚缺原生 x64 主机或发行 CI 上的安装器和性能验收，不能把 Rosetta 结果写成原生 x64 发布证据。
- 官方 Web 的审批/队列截图和 Browser Workspace 页面截图已通过本机真实 Electron smoke 持久化，README 也已换成当前官方 Web 与社区候选截图。现在提供显式的 `npm run smoke:official-web:live` 入口；无 `DEEPSEEK_API_KEY` 时会 fail closed，本轮只验证了这个保护，不把 loopback 模型或未执行的 live 命令写成真实 DeepSeek 证据。公开安装录制和真实 DeepSeek 服务验收仍需在发行环境完成。
- `.github/workflows/macos-release-evidence.yml` 现在提供手动的 arm64 签名、公证、打包 smoke、社区三帧和可选 live-model 证据入口；live-model 步骤同时上传截图和 `result.json` 成功回执。`.github/workflows/windows-release-evidence.yml` 提供 Windows 签名、安装器验收和 Authenticode 证据入口。两者都要求发行环境提供对应 secrets，本机未触发这些 workflow，因此不把 workflow 或回执契约存在写成 Apple、Windows、公开安装器或真实服务验收通过。
- macOS 正式 arm64/x64 打包脚本现在在 Electron Builder 之后对当前版本和架构的 DMG 单独执行 `xcrun notarytool submit --wait`，随后附加并验证 DMG 票据、执行 `spctl --assess --type open`，再挂载并验证 App 载荷的 stapler/Gatekeeper；手动发行 workflow 会上传无凭据回执，之后再运行 `smoke:macos:installer` 并上传安装器回执和截图。本机当前 DMG 容器请求仍在 Apple 处理中，所以该代码和 workflow 契约已就绪但最终 DMG 公证结果仍以发行环境回执为准。

因此，当前实现可以作为“官方 Web + Profile 权威 + 离线插件基础 + 窄 Electron Host + 恢复页”的开发基线，但在上述高等级证据补齐前，不标记为最终公开发行完成。
