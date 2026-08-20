# DSH Desktop 发行版转型实施证据

日期：2026-08-20

本报告记录发行版转型当前已经取得的证据，以及还不能越级宣称完成的发行门槛。它对应 [发行方案](../plans/2026-08-20_dsh-app-发行版转型最终方案.md)，不把源码检查、单元测试、Profile 集成、真实 Electron 和安装包验证混为同一层证据。

## 已实施的运行边界

- Electron 主窗口只加载官方 `dsh-web-app` loopback surface，不再向官方 Web 注入产品 preload、Node 或通用 IPC。
- Browser Workspace 保留在主进程，通过方法白名单、Session 请求关联、目标 URL、路径和权限校验提供窄 Native Host 服务。
- 启动失败进入本地恢复页；重试、安全 Profile、打开 Profile、用户确认移除插件和隐私过滤诊断都是独立动作，原 Profile 不因恢复而被改写。
- Profile 初始化只在新 Profile 上执行。已有 Profile 的启动和状态查询读取官方清单、依赖和最终图，不补回或隔离用户 Bundle。
- 应用更新安装前执行当前 Profile 和 `--dump-config` 只读预检；预检失败不会创建待安装记录或调用 `quitAndInstall`。
- 自研替换 Shell、旧产品 Client UI、工作台目录和自研主题包已从发行包输入中移除；源代码中保留的旧 Renderer 不在 Electron 打包清单和发布边界内。

## 精选输入和插件证据

唯一精选输入是 `server/src/engine/dsh_runtime/featured_plugins.json`。它由脚本生成固定 tarball、SHA-256 manifest、Profile 安装输入、权限摘要、第三方公告和测试预期。当前默认输入是 7 个 `@vibeinging/*` Host、portable 或 desktop-adapter Bundle，不包含替换式 UI。

固定 tarball 通过安装包内的受控 pnpm 进入 DSH 数据目录下的稳定本地插件库。pnpm wrapper 必须使用 `DSH_PNPM_NODE_BIN`，发行态不回退到系统 Node。所有 Profile 安装、更新和卸载仍转发到官方 `dsh plugin --profile` 命令；本地插件库不是第二份安装状态。

`@vibeinging/dsh-model-inheritance` 已在纯官方 Web Profile 通过官方命令安装和真实 Electron 启动检查。`@linxin666/dsh-client-ui-task-board@0.1.20` 已完成固定版本网络预检、官方 Web 激活、真实 Electron 启动、官方卸载命令和重启保持检查；它目前仍是可选社区候选，不进入默认精选。`@linxin666/dsh-web-ui-all`、Better Sidebar、远程 Web、SSH、图像理解、Agent 预设和社区插件管理器均未进入发行 Profile。

## 验证层级

| 层级 | 当前证据 | 结论 |
| --- | --- | --- |
| 源码检查 | `node scripts/release-boundary.mjs --syntax`、Node syntax check、包清单和权限投影检查 | 官方 Web、恢复页、窄 Native Host、精选清单和退役包边界可检查 |
| 单元回归 | `npm run test:release` 中的 Profile、更新预检、恢复、权限、Browser Workspace、社区候选和运行时测试 | 关键状态和失败路径有回归；有条件的真实社区测试在无开关时会跳过 |
| Profile 集成 | 官方 npm DSH CLI、固定 Profile Bundle、纯官方 Web Profile、tarball SHA-256、受控 pnpm 和离线初始化测试 | 新 Profile 与已有 Profile 的状态边界已验证 |
| 真实 Electron | 官方 Web 无 preload 启动、portable Bundle、task-board 候选和 WebContentsView Browser Workspace smoke | Electron 页面和原生浏览器主路径已验证 |
| 安装包 | macOS arm64 目录包、随包 Server、官方 Web smoke、固定 tarball 和 pnpm 资源检查；子进程 `PATH=/usr/bin` 的无系统 Node/pnpm smoke | 目录包证据已建立；签名、公证、干净用户更新/卸载和其他平台仍是发布门槛 |

当前机器的 Electron Viz 合成器不能提供 WebContentsView 截图，所以 Browser Workspace smoke 将截图结果标记为 `compositor-unavailable`，其余导航、标签、下载、历史、查找、缩放、沙箱和页面抓取仍单独通过。这个环境限制不能写成截图验证通过。

## 尚未满足的公开发行门槛

- Better Sidebar 和 Chat recovery 没有独立、当前 SDK 可安装并完成真实 Electron 卸载回归的包，因此没有晋级为随包插件；不能把候选登记写成采用完成。
- 社区皮肤资产尚未有可再分发的许可和来源证据，发行包继续使用官方外观，不携带自研主题状态或未经审查的皮肤。
- 当前证据还不是签名、公证、Windows 实机、干净用户目录断网首启、真实应用更新后的用户卸载保持和恢复页破坏插件回归；这些必须在相应发行环境补齐后才能宣布完整发行版转型完成。
- 公开截图和安装录制仍需在可提供截图的 Electron 环境重新采集；现有 smoke 输出只证明页面和交互路径，不替代视觉证据。

因此，当前实现可以作为“官方 Web + Profile 权威 + 离线插件基础 + 窄 Electron Host + 恢复页”的开发基线，但在上述高等级证据补齐前，不标记为最终公开发行完成。
