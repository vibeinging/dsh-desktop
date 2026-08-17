# DeepSeek Harness Desktop App

中文 | [English](README.en.md)

> [查看二次元版 README：二次元主题与看板娘](README.anime.md)

[![dshfind](https://dshfind.com/api/badge/vibeinging/deepseek-harness-desktop-app?lang=zh)](https://dshfind.com/zh/plugins/vibeinging/deepseek-harness-desktop-app?ref=badge)

DeepSeek Harness Desktop App 是建立在 DeepSeek Harness（DSH）之上的本地 AI 工作桌面。它把 DSH 的 Session、Agent、Tool、Skill、MCP 和 Profile Bundle 与项目、文件、网页、Git Worktree、Canvas、Site 和 Office 产物组织在同一个桌面应用中。

| 专业蓝亮色 | 专业蓝暗色 |
| --- | --- |
| ![DeepSeek Harness Desktop App 专业蓝亮色首页](docs/images/readme/dsh-work-home-professional-light.png) | ![DeepSeek Harness Desktop App 专业蓝暗色首页](docs/images/readme/dsh-work-home-professional-dark.png) |

## 快速开始

本地开发要求 Node.js 24 或更高版本。当前项目使用 DSH `0.1.0-rc.6`。

```bash
npm install
npm run doctor
npm run dev
```

切换 Node.js 大版本、CPU 架构或操作系统后，运行 `npm run setup` 重新准备依赖。

## 主要功能

| 功能 | 用户可以做什么 |
|---|---|
| DSH 对话 | 流式回答、思考过程、工具调用、停止、继续、重试、消息分支和重启恢复 |
| 模型与权限 | 选择 Provider、模型和推理强度，管理凭据引用、Session 权限、工具审批和模型提问 |
| Tool、Skill、MCP 与多 Agent | 使用当前 Profile 中的工具、技能、MCP、Hook、子 Agent 和 Workflow |
| 项目与对话 | 创建项目、全局或临时对话，置顶、排序、重命名、归档、恢复和删除 |
| 桌面外壳与设置 | 使用三列工作台、左右栏折叠、全局搜索、缩放快捷键和更新检查，调整语言、网络、通知、终端与隐私选项 |
| 项目上下文 | 设置应用指令、项目指令、授权源码目录和写入目标；长期记忆由可安装的社区 Bundle 提供 |
| 输入与引用 | 使用 `@` 引用文件、使用 `#` 引用对话，粘贴图片和大段文本附件 |
| 编码工作区 | 查看 Diff、逐行评论和编辑、在外部编辑器打开、发起 AI Review，并安全撤销模型产生的文件修改 |
| Git Worktree | 创建、启用、停用和删除隔离工作目录，让新对话在指定 Worktree 中运行 |
| 文件与搜索 | 浏览项目文件、任务和产物，预览文本、代码、图片和 Office 内容，按文件名或正文搜索 |
| Browser Workspace | 多标签浏览、历史、页内查找、缩放、下载、打印、开发者工具、站点权限、网页快照和“使用此页” |
| 结果与证据 | 直接查看当前 DSH Session 的完整轨迹、工具输入输出、耗时、Token 和最终回答 |
| Canvas 与本地 Site | 创建和编辑 Canvas、处理行内建议与版本冲突，生成并响应式预览单文件 Site |
| Office 产物 | 创建、查看和定点编辑 Markdown、DOCX、XLSX、PPTX 和 PDF，并保留版本 |
| 主题与外观 | 切换 Profile 主题，新建、导入、预览、编辑、导出和删除本地主题，调整明暗模式、背景和透明度 |
| 插件中心 | 检查兼容性，把 DSH Profile Bundle 安装到当前 Web Profile，并查看来源、版本和加载顺序 |

## DSH 轨迹就是结果与证据

右侧“结果与证据”直接读取当前绑定 DSH Session 的 `session.history`。用户消息、请求上下文、模型输出、工具调用、工具结果、权限变化和最终回答都在同一条可回放轨迹中，不维护第二套运行中心。

![DSH 轨迹演示](docs/images/readme/dsh-trajectory.gif)

## 对话和工作台

一个项目对话对应一个 DSH Session。右侧工作台可以添加结果与证据、浏览器、文件、产物和 Site 标签；项目文件树、Agent 工作目录、当前 Diff 和行编辑都跟随当前项目权限与活动 Worktree。

![DeepSeek Harness Desktop App 项目会话](docs/images/readme/dsh-work-project-session.png)

![DeepSeek Harness Desktop App 文件面板](docs/images/readme/dsh-work-files.png)

Canvas 保存不可变版本，支持正文编辑、版本比较、精确行内建议和冲突处理。Site 使用同一套版本能力，并在隔离沙箱中提供桌面、平板和手机预览。

![DeepSeek Harness Desktop App Canvas 版本与冲突处理](docs/images/readme/dsh-work-canvas.png)

![DeepSeek Harness Desktop App 本地 Site 响应式预览](docs/images/readme/dsh-work-site.png)

## Git Worktree 隔离开发

项目设置提供完整的 Worktree 工作流：

1. 为项目创建一个或多个独立分支和工作目录，同一时间启用一个。
2. 启用后，新建对话的 Agent、DSH Session、Diff 和行编辑使用该 Worktree，主检出保持不变。
3. 切换工作目录不会迁移已有对话；应先启用目标 Worktree，再新建对话。
4. 删除前必须切回主检出。删除工作目录后保留 Git 分支，避免误删提交。
5. 非 Git 目录、重复分支、越界路径和异常符号链接会被拒绝；磁盘上丢失的 Worktree 会标记为不可用。

![DeepSeek Harness Desktop App Git Worktree 完整流程](docs/images/readme/dsh-work-worktree.gif)

## 主题与外观

`@deepseek-ai/dsh-theme-pack` Profile Bundle 提供默认的 `professional-blue` 和可选的 `anime-blue`。正式产品也支持本地自定义主题的新建、导入、预览、编辑、导出和删除。

本地主题只能使用安全的颜色与外观设置，不能注入原始 CSS、远程图片或修改应用名称。个人背景、明暗模式和透明度可以独立调整。

![主题库与本地自定义主题入口](docs/images/readme/dsh-work-themes.png)

## 插件中心

普通用户从左侧“插件”页面安装 DSH Profile Bundle：

1. 从内置社区目录选择候选插件，或输入带精确版本的 npm 包、带完整 commit 的 GitHub 仓库地址。
2. 先运行兼容性检查；只有结果为“可以安装”时才能写入当前 Profile。
3. 安装后查看 Bundle 的来源、版本、加载顺序和能力，用户安装的 Bundle 可以卸载。

Tool、Skill、MCP、Hook 等 Host Bundle 可以进入 DSH 运行时。包含第三方 Client UI 的 Bundle 默认不会进入拥有 Electron 权限的主窗口；只有经过代码审查并固定到精确版本的 Client Bundle 可以进入当前产品 Renderer，其他插件等待独立的无 preload 运行区。

![DSH Web Profile Bundle 列表](docs/images/readme/dsh-profile-bundles.png)

### 社区插件目录

项目维护一份机器可读的社区插件目录，插件中心直接读取同一份数据。目录记录仓库、版本来源、Star 快照、兼容状态和采用优先级；Star 只表示社区关注度，安装仍必须通过 Profile 预检和桌面兼容测试。

| 插件 | 社区能力 | 当前采用计划 |
|---|---|---|
| [DSH Plugin Market](https://github.com/dsh-market/dsh-market) | 浏览、搜索、安装和更新 DSH 插件 | 已审查并接入 Profile 与 Client 图，固定 `dshmarket@1.9.0` |
| [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) | 任务看板、Git 图谱、实时统计、远程 UI、宠物和皮肤 | 按子包采用，不直接安装全家桶 |
| [modlens](https://github.com/liustack/modlens) | 为文本模型提供 OCR、布局和图像语义证据 | 完成凭据与数据发送审查后接入 |
| [DSH Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 文件、编辑器、终端、Git、子 Agent 和第三方 Tab | 等待标准 Slot 或独立运行区，避免与桌面壳冲突 |
| [DSH Vision Toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 图像问答、OCR、UI 还原、像素差异和 Artifact | 补齐 Tool View Slot 后接入 |
| [DSH @file](https://github.com/omdsh-dev/dsh-at-file) | 在输入框搜索并引用工作区文件 | 官方 `inputTriggers` 与输入浮层已接通；先用独立产品引用 Bundle 对齐 App 授权目录，再等待社区包固定 rc.6 后试装 |
| [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) | OpenPencil 预览和编辑 | 使用社区实现，不重复开发 |
| [DSH Files](https://github.com/taxueseek/dsh-files) | 文件上传、附件卡和文档读取 | 标准引用桥已接通；仓库尚未发布 npm，固定 commit 的 rc.6 Profile 预检又因 Cordis peer 使用 `*` 而阻塞，等待社区固定 `^4.0.1` 后再安装 |
| [DSH Find Plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) | 让 Agent 搜索社区插件 | 已确认是 Host Tool Bundle；当前版本需要迁移到 rc.6 SDK |
| [DSH Native Memory](https://github.com/highland0971/dsh-native-memory) | 按工作区保存、检索和审批长期记忆 | 已完成 `dsh-native-memory@0.2.0` 源码审查，以及 rc.6 Profile 安装、Host 启动、Session 创建与卸载实测；可从插件中心安装以替代 App 自建记忆 |
| [DSH Toolkit](https://github.com/omdsh-dev/dsh-toolkit) | 时间、编码、JSON、CSV、差异、统计等确定性工具 | 固定 commit 的 Host 预检已完成；两个 DSH SDK 范围未对齐精确 rc.6 发布线，等待社区迁移 |
| [Distill](https://github.com/LoserFox/distill) | 后台反思会话并沉淀 Skill | 固定 commit 的 Host 预检已完成；六个 DSH SDK 依赖仍在 rc.5，等待社区迁移后再审生命周期 |
| [DSH MCP Bridge](https://github.com/Edge-Echo/dsh-mcp-bridge) | 文件系统、GitHub、Playwright、记忆和远程 HTTP MCP | rc.6 Profile 预检通过；完成网络与进程权限审查后可安装 |

完整生态可从 [Awesome DeepSeek Harness Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 发现。候选目录是经过筛选的产品清单，不复制社区市场的全部数据；新插件优先向社区项目贡献兼容改动，只有社区没有合适实现时才自研。

DSH 插件不等于 UI 插件。Profile Bundle 可以增加或替换 Host 服务、模型与 Provider、Tool、Skill、MCP、Hook、Session 中间件、存储、工作流和 Client UI。DeepSeek Harness Desktop App 对 Host 插件沿用官方 Profile 生命周期；只有需要进入窗口的 Client 代码才额外经过 Slot 映射和 Renderer 权限审查。

### App 自身如何插件化

DeepSeek Harness Desktop App 是一个 DSH Profile 发行版和 Electron 插件宿主，不会把窗口、更新、preload 与系统权限伪装成可安装到官方 Web 的普通插件。可复用功能按三种等级拆分：`portable` Bundle 可同时安装到官方 Web 和桌面；`desktop-adapter` Bundle 使用 DSH 生命周期但依赖明确的桌面 Host 合同；`desktop-shell` 只负责窗口、根布局与安全隔离。当前主题包和 `dsh-model-inheritance` 已经是 `portable`；后者只使用官方 Agent 生命周期，让子 Agent 继承父 Agent 已解析的模型目标。`dsh-work-product-host-ipc`、`dsh-client-product-commands`、`dsh-client-product-references`、项目工具、Canvas 工具、结构化 UI 工具、工作台页面、产品桥和 Office 工具包属于 `desktop-adapter`，`dsh-work-shell` 属于 `desktop-shell`。父进程传输现在只由 `dsh-work-product-host-ipc` 负责；项目工具、Canvas 工具、结构化 UI 工具和产品桥消费 `productHost`，Office 工具消费更窄的 `officeArtifactHost`，功能 Bundle 不再直接接触 IPC。`dsh-client-product-commands` 独立持有 `/new`、`/runs` 和 `/trace` 的官方输入来源、双语目录与 Session token 消费，产品壳只提供窄的 `dshWorkProductActions` 服务，因此这些桌面动作可以通过 Profile 独立安装、停用或替换。`dsh-client-product-references` 通过同一个官方 `inputTriggers` 注册文件和会话来源，只消费产品壳发布的 Session 限定 `dshWorkProductReferences` 目录；正式 Client 不再启动 App 本地 `@`／`#` 扫描器。产品桥已经不再注册 Tool、工作台页面、模型继承或记忆，只保留应用与项目指令上下文；长期记忆改用通过官方 Profile 安装的 `dsh-native-memory` 社区 Bundle。官方 Tool UI 插件已经通过 `conversation.chat.node` 进入产品对话面，社区 Client 插件可以继续在嵌套的 `tool.call.toolview` 席位替换单个工具视图；没有插件接管时才显示产品内置的工具卡片。点击工具行的 Inspect 后，产品右栏只保留 Session 与 call 选择，具体 terminal、read、search、web、diff 和普通结果仍由官方或社区 `conversation.details.tool` 插件渲染。rc.6 的独立 Tool 插件仍读取由官方 Conversation 页面壳注册的一小组文案；由于产品必须停用重复页面壳，`dsh-work-shell` 只通过同一个 Locale 服务补齐 Tool 实际使用的中英文键，并随插件生命周期回收，不复制 Conversation 状态或其余页面文案。产品壳也按官方 `IConversation` 合同发布 `conversation` 服务并直接调用 DSH Session，Agent Preset 插件因此可以在 `conversation.hero.agentPreset` 席位显示并为下一条 Session 暂存选择。正式 Client 中，产品队列和紧凑的 Plan／权限读数直接订阅同一 Client Session 的 `ConversationSnapshot.queue` 与 `session.projections.faceOf(...)`；App 协议流只解析产品会话到 DSH Session 的绑定，并继续传递尚未迁入官方 Chat 的消息内容，不再作为第二份状态权威。插件中心从同一份宿主能力清单区分“完整支持”“部分支持”和“尚未映射”；`conversation.chat.node` 当前只承诺 `tool-call`，不会把其余消息节点误报为可用。`dsh-workbench-pages` 独立贡献 Review、Browser、Files、Artifacts 和 Sites 页面目录。后续这些页面会优先采用社区插件，缺失部分再逐项拆成独立 Bundle。OpenPencil 保持为社区设计插件选择，不与现有版本化 Canvas 重复实现。业务组件不再继续堆入 shell。

正式 Client 中的 Skill 目录与选择也由 Profile 中的官方 `@deepseek-ai/dsh-client-ui-skill` 持有。它按当前 Session 调用 `skill.list`，把 `skill` 来源注册进 `inputTriggers`，并把 `/<name> ` 引用写回同一份草稿；App 自有 Skill 菜单只保留给没有 DSH Client Host 的独立开发页。

文件与会话引用同样进入官方 InputTrigger 菜单。文件候选来自当前项目已授权的目录，选择后写入 `@<path> `；会话候选写入 `#<title> `。rc.6 的公开触发字符只有 `/` 和 `@`，所以两类候选暂时共用 `@` 菜单，不能把独立 `#` 菜单伪装成官方能力；没有 DSH Client Host 的独立开发页继续保留旧选择器。

## 与 DSH 官方 Web 的关系

DeepSeek Harness Desktop App 不是 DSH Web 的 iframe，也没有复制一套 Agent 运行时。Electron 启动 DSH Web Profile，并继续使用同一套 Session、Agent、Tool、Skill、MCP、Settings、Profile Bundle 和 Client Loader。DeepSeek Harness Desktop App 在同一运行链上提供自己的桌面外壳，并增加项目管理、文件授权、Browser Workspace、Git Worktree、Canvas、Site 和 Office 产物。

需要模型使用的产品能力通过绑定 Session 和 DSH Tool 接入；项目数据、文件权限、网页、Worktree 和产物版本仍由 DeepSeek Harness Desktop App 管理。

## 当前边界

- 当前没有五列任务看板、独立定时任务页面、Git 图谱、stage/unstage 面板或独立终端页。
- 本地 Site 只提供预览和单文件导出，没有部署服务；公开分享目前只有只读查看。
- 当前没有移动端远程控制、二维码配对、公网隧道、SSH、SFTP 或端口转发。
- 子 Agent 可以执行并出现在对话与轨迹中，但还没有完整的独立管理页。

## 数据与安全

Profile、Session、项目、运行记录和产物数据默认保存在本机 `~/.dsh`。项目源码目录默认只读，Agent 写入需要用户明确授权。

完整规则见 [PRIVACY.md](PRIVACY.md)、[SECURITY.md](SECURITY.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 平台状态

| 平台 | 当前状态 |
|---|---|
| macOS Apple Silicon | 开发与目录包已验证 |
| macOS Intel | Rosetta 检查通过，仍需 Intel 实机验收 |
| Windows x64 | 已接入构建流程，仍需安装包实机验收 |
| Windows arm64 | 暂不支持 |
| Linux | 暂无桌面打包配置 |

## 许可证

项目代码使用 [MIT License](LICENSE)。第三方依赖与二进制文件的来源、许可证和分发限制见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
