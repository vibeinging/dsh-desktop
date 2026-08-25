# DSH 插件市场选择与桌面接入

## 结论

桌面发行版默认内置 `dshmarket@1.17.1` 和 `dsh-better-sidebar@0.16.0`，不再自建插件中心或工作区侧栏页面。两者都是独立 DSH Profile Bundle：市场通过官方 Web Slot 注册，Better Sidebar 使用官方 Client 服务并提供文件、Git、终端和可扩展 Tab 工作台；Electron 壳没有复制它们的 UI 或状态。

2026-08-24 复核后，运行时仍只保留这一套市场。新增工作不应再安装第二套插件管理页面，而应补充两层能力：发行前使用外部目录和评测库筛选候选；用户 Profile 只加入已经通过本发行版验收的独立 Bundle。`awesome-dsh-plugin` 已经是 `dshmarket` 的目录来源，不需要作为第二个插件安装。

## 候选对比

| 候选 | 定位 | 当前结论 |
| --- | --- | --- |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | 独立插件市场，使用官方设置 Slot | 选中。功能集中、页面完整、维护活跃，能删除我们自建管理页的需求 |
| `@linxin666/dsh-web-ui-all` 内的社区管理器 | 多功能聚合包的一部分 | 不选。聚合包带入远程 Web、SSH、Git、皮肤等不相关能力，传递依赖和资产许可也没有完成发行验收 |
| 官方 Web 基础插件设置 | Profile 状态和基础配置 | 保留作为权威投影和故障处理表面，不承担社区目录搜索 |

## 2026-08-24 生态管理与评测库复核

以下 Star 和活跃度是 2026-08-24 的 GitHub 快照，只用于判断社区采用情况，不代替源码、运行和权限验收。

| 项目 | 快照 | 能力 | 桌面结论 |
| --- | ---: | --- | --- |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 12080 Star，CC0-1.0 | 最大的社区目录，持续更新插件条目 | 需要，但不随包安装；继续由 `dshmarket` 读取 |
| [dsh-market](https://github.com/dsh-market/dsh-market) | 2118 Star，MIT | 官方设置 Slot 内的搜索、诊断、安装、更新、卸载和备份 | 已内置，继续作为唯一市场 UI |
| [awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) | 176 Star，MIT | 大规模自动收集、格式检查、搜索 API | 可作为发现补充，不把自动收录等同于已验证 |
| [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) | 84 Star，MIT | 在 Agent 会话中搜索插件 | 与市场发现功能重复，不默认内置 |
| [dsh-suite](https://github.com/whyihaveyou/dsh-suite) | 47 Star，MIT | 活目录、静态 peer 检查、隔离 Profile 安装和配置组装检查 | 需要它的兼容报告，不安装它的第二套市场 UI |
| [dsh-plugin-bench](https://github.com/B1lli/dsh-plugin-bench) | MIT，尚未发布 npm | 100 分评分表，区分静态、构建、Profile、真实用户路径和跨环境证据 | 采用评分维度和证据等级；当前只能固定 Git commit 读取，不作为运行时依赖 |
| [dsh-plugin-verify](https://github.com/qing3a/dsh-plugin-verify) | npm `@qing3a/dsh-plugin-verify@0.1.2`，MIT | 无真实模型密钥跑 Agent waterfall、工具结果和静态规则，输出机器可读报告 | 适合作为开发和 CI 工具，不进入用户 Profile |
| [awesome-dsh-plugins](https://github.com/coolbat/awesome-dsh-plugins) | MIT | 绑定固定 commit、manifest、patch、许可和能力信号的静态审查目录 | 作为供应链复核来源，不进入用户 Profile |

不采用 `@snowsalt/dsh-manager`、`ydhrdh/dsh-marketplace` 或 `dsh-subscribe` 作为第二个运行时市场。它们与当前市场重复；其中 `@snowsalt/dsh-manager` 的 GitHub 仓库还没有可识别许可证。重复内置会造成两个 UI 同时改写同一 Profile，增加状态、确认流程和恢复行为冲突。

## 可以内置的首批功能插件

这里的“可以内置”表示进入固定 tarball 和真实验收候选。只有表内明确写为“已进入默认清单”的项目已经落到发行配置。

| 候选 | 当前包 | 建议状态 | 原因和主要门槛 |
| --- | --- | --- | --- |
| Git 图谱 | `@linxin666/dsh-client-ui-git-graph@0.3.2` | 首批默认候选 | 独立 Bundle，声明 `DSH >=0.1.1-rc.1`，无运行依赖和安装脚本，直接补足 Git 历史可视化 |
| Chat Recovery | `@linxin666/dsh-chat-recovery@0.3.2` | 首批默认候选 | 独立 Bundle，无运行依赖和安装脚本；需要验证崩溃、重启、恢复和官方 Session 真相一致 |
| Skill Explorer | `@linxin666/dsh-client-ui-skill-explorer@0.3.2` | 首批默认候选 | 独立 Bundle，无运行依赖和安装脚本，能让用户看见已经可用的 Skill |
| Context 面板 | `dsh-context@0.30.0` | 第二批默认候选 | 982 Star、Apache-2.0、活跃维护；需确认 `rc.2` 的 Session 和 Settings 接口兼容，并限制读取范围 |
| 对话分享 | `dsh-share@0.3.1` | 第二批默认候选 | MIT、纯 Client 导出图片和 Markdown；需做长对话、敏感内容提示和图片生成成本验收 |
| 桌面通知 | `dsh-notification@0.1.1` | 第二批默认候选 | MIT、用户价值明确；GitHub 已到 0.1.3 但 npm 仍是 0.1.1，应等待发布身份收敛后固定版本 |
| Turn Rewind | `@anionex/dsh-turn-rewind@0.1.2` | 随包可选 | BSD-3-Clause、无运行依赖；会修改会话与工作区状态，必须有明确确认、可预览范围和失败回滚 |
| Better Sidebar | `dsh-better-sidebar@0.16.0` | 已进入默认清单，运行验收待刷新 | 固定包、权限、依赖和 166 项许可证闭包已更新；0.16.0 的离线 Profile 生命周期、官方 Web Client 挂载和打包 Electron 证据必须重新生成，不继承 0.15.2 结果 |
| Vision Toolkit | `@anionex/dsh-vision-toolkit@0.1.38` | 用户选择安装 | 818 Star、MIT；包含 Python/runtime、外部视觉模型和较大能力面，不适合无条件默认启用 |
| MCP Manager | `dsh-mcp-manager@0.6.0` | 用户选择安装 | MIT、标准 Bundle；涉及 OAuth、静态令牌、stdio 进程和工具注册，需要单独的凭据与进程权限审查 |
| Browser Bridge | `Lum1104/dsh-browser` | 不随包 | 418 Star、MIT，但仓库根包是私有工作区并依赖浏览器扩展，不是当前可直接固定的独立 npm Bundle |

首批三个 `@linxin666/*@0.3.2` 子包来自 `dsh-web-ui`，但直接作为 Profile 根依赖安装，不安装 `dsh-web-ui-all`。这能避开聚合包的传递依赖解析、重复插件管理、桌面启动器和主题资产冲突。

## 评测链建议

插件进入默认 Profile 前需要依次通过以下步骤：

1. 从 `awesome-dsh-plugin` 发现候选，读取 `dsh-suite` 的最新兼容结果和 `coolbat/awesome-dsh-plugins` 的固定 commit 静态证据。
2. 固定 npm 版本、完整性、许可证和依赖闭包，禁止浮动 `latest`、浮动 Git 分支和默认执行生命周期脚本。
3. 使用 `@qing3a/dsh-plugin-verify@0.1.2` 补充 keyless waterfall 和工具结果检查；使用 `dsh-plugin-bench` 的八个维度记录分数和证据等级，但不把分数当作自动批准。
4. 继续执行本项目已有的隔离 Profile 安装、官方 Web 启动、真实 Electron 交互、停用、官方卸载、重启恢复、断网初始化、权限和预算检查。
5. 只有当前 DSH 版本上的真实用户路径通过，才进入默认 Profile。目录徽章、Star、静态检查或别人的 CI 都不能替代这一层。

## 实际包审查

安装源固定为 npm `dshmarket@1.17.1`，包完整性固定为 `sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==`。npm tarball 为 603071 bytes，不含原生依赖，包内有完整 MIT 许可。运行依赖闭包是 `js-yaml@4.3.1`、其下的 `argparse@2.0.1` 和 `undici@7.29.0`。上游声明 `prepare` 和 `prepack`，发行版只使用已构建 tarball，安装一律传入 `--ignore-scripts`。

Better Sidebar 固定为 npm `dsh-better-sidebar@0.16.0`，registry 完整性为 `sha512-ym+tAlgip2odJFAr/YxFB6R3gAggHImEZpKw3+cPSQjIbeZG7oF9DwICgM3y3mXQneTvMUBvYwMjZUU6T5BuzA==`，许可证为 MIT。上游 Client 已把 CodeMirror、Mermaid 和 DOMPurify 等浏览器代码编进延迟加载 chunk，Host 运行时只外部引用 `node-pty`、`schemastery` 和 `ws`；发行 tarball 因此只携带这三项及其 6 个运行依赖，第三方声明则覆盖完整 166 项源依赖许可证。0.16.0 删除了公开 `cordis` peer，保留 `@deepseek-ai/cordis@^4.0.1`，并增加可选 `@huanlin/dsh-plugin-better-locale`；旧 DSH `^0.1.0-rc.8` peer 在固定暂存包中投影为当前 `0.1.1-rc.2`。安装继续使用 `--ignore-scripts`，`node-pty@1.1.0` 的 macOS 和 Windows 预构建文件随包携带；插件启动时会恢复 macOS `spawn-helper` 的执行权限。

## 桌面 Host 边界

市场已支持公开的结构服务 `desktopProfiles` 和 `desktopPnpm`。本项目在独立 `@vibeinging/dsh-desktop-profile-host` Bundle 中提供这两个服务，不复制市场源码。

- `desktopProfiles.current` 只公开当前 `web` Profile 的名称和绝对目录，当前不支持从市场切换 Profile。
- Server 在每次启动官方 DSH Web 子进程时明确注入固定 Profile 身份；适配层缺少该身份时直接失败，不从目录或命令参数猜测。
- `desktopPnpm.runPlugin` 固定调用随包 Node 和官方 `dsh plugin --profile web`，`desktopPnpm.run` 只调用随包 pnpm。
- 同一代 Host 只允许一个包操作；取消、超时和销毁会终止子进程树。
- 市场进入桌面模式后强制 `allowRestart=false`，只能提示用户由 Electron Shell 重启。
- 市场不获得 Electron、Node、文件对话框、窗口或通用 Shell 能力。

## 用户可见权限

市场可以读取并修改当前 Profile 的依赖、Bundle 顺序和启停状态，也可以在用户确认后安装、更新或卸载插件。打开目录需要访问社区目录；安装和更新可能访问 npm 或 GitHub；WebDAV 和 Gist 只有用户主动配置后才会启用。它不读取 Session 消息。

## 发行与验证要求

新 Profile 从唯一精选清单离线安装市场和桌面适配层。既有 Profile 在应用更新时不补装市场，用户卸载后也不恢复。发行验收必须分别覆盖固定包和依赖闭包、断网初始化、官方 Web Slot 可见、市场状态路由、受控 pnpm、用户确认变更、停用、官方卸载和卸载后重启基线。

## 2026-08-22 历史成本基线

11 个默认 Bundle 的 macOS arm64 目录包实测精选 tarball 合计 1,602,186 bytes，首次断网 Profile 约为 17,023,000 bytes，官方 Web 冷启动在连续验收中为 11.8 至 15.7 秒。发行门禁分别限制在 2,000,000 bytes、20,000,000 bytes 和 20,000 ms；增加市场不能成为以后无上限扩大默认包体的理由。

该数字只对应当时的 11 个 Bundle。当前精选清单已经增加到 14 个；每加入一个新候选，都必须重新生成当前 commit 的测量报告，不能继续引用这一历史数字。

## 2026-08-25 Better Sidebar 成本与证据

当前固定 Better Sidebar 0.16.0 tarball 为 18,729,333 bytes，14 个精选 tarball 合计 20,368,810 bytes，仍低于 24,000,000 bytes 硬上限。这两项是当前固定产物的静态结果；0.16.0 的隔离 Profile 安装、官方 Web 启动、停用、官方卸载、重启恢复、打包 Electron Client 挂载与原生终端证据必须重新运行，不继承 0.15.2 的 Profile 占用、冷启动或 Electron 回执。

据此，精选 tarball 和首次 Profile 硬上限调整为 24,000,000 bytes 与 200,000,000 bytes；冷启动上限仍为 20,000 ms。这里没有声称 Windows 或 macOS x64 原生终端已经通过，最终发行仍需目标平台的打包 Electron 交互回执。
