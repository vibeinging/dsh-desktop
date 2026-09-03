# DSH Desktop 产品桥接

[English](README.md) | 中文

这个私有 Profile Bundle 在不导入、不修改 DSH 源码检出目录的前提下扩展官方 DSH Web Profile。它只持有应用指令上下文，不再注册任何 Tool、页面、模型继承钩子或记忆提供方。它消费按 Session 寻址的 `productHost` 服务，该服务由 `@vibeinging/dsh-work-product-host-ipc` 提供；portable 的 `@vibeinging/dsh-model-inheritance` Bundle 持有父 Agent 到子 Agent 的模型继承，独立的 `@vibeinging/dsh-project-tools` Bundle 持有 `project_list` 和 `conversation_list`，`@vibeinging/dsh-canvas-tools` 持有四个 Canvas/Site 工具，`@vibeinging/dsh-structured-ui-tools` 持有 `ui_render`，`@vibeinging/dsh-office-tools` 消费 `officeArtifactHost`。长期记忆由经过审查的社区 `dsh-native-memory` Profile Bundle 提供，不再使用应用自有数据库和注入路径。

子进程只发送 DSH Session id。独立的 IPC 适配器把每个请求绑定到一个已授权的 DSH Desktop Session、用户和项目，随后父进程通过一个受控 dispatcher 处理由父进程授权的新会话创建，以及项目、对话、Canvas/Site 和 Office 请求。创建新会话时，父进程只从发起方绑定读取身份和项目，同时创建 App 会话与普通 DSH Session，并在返回前登记新的 ProductHost 绑定。请求不能切换到另一身份或项目。Canvas/Site 审批归 Canvas Bundle 所有，Office 审批归 Office Bundle 所有。每次调用都会生成普通且可持久恢复的 DSH 工具事件；写入成功后还会投影一条隐藏工作台事件，让实时界面和恢复后的历史打开同一个 Canvas、Site 或产物。

每个进入模型的步骤都会通过同一个父进程绑定读取允许使用的应用指令和项目指令。产品桥把它们作为一条不可变用户消息加入 `agent/pre-step` 的进入批次，并以 `dsh-work-context` 来源写入 DSH Session Log；读取失败只跳过这次补充，不会替换用户消息或建立第二份历史。

portable 的独立 `@vibeinging/dsh-model-inheritance` Bundle 记录父 Agent 最终解析出的 provider 和 model。DSH 创建子 Agent 时，该 Bundle 会在第一次请求前固定这个目标，避免子 Agent 回退到进程启动默认模型。父 Agent 之后的新请求仍按正常设置解析。

运行时就绪、产品 IPC、请求关联、取消和关停清理现均由 `@vibeinging/dsh-work-product-host-ipc` 负责，不属于这个功能 Bundle。

已删除的项目 Plugin 挂载、Skill 和 MCP 数据不会通过 ProductHost 投影。它们的目录方法返回空目录，而 Profile Bundle 的 Skill 和工具继续由 DSH 原生注册表管理。

## 模型体验

模型在同一 Session Log 中从这个 Bundle 接收已授权的应用指令和项目指令。经过审查的社区记忆 Bundle 通过 DSH 官方的存储、审批、Tool、Session 查询和系统提示词 seam 持有长期记忆。portable 的 Model Inheritance Bundle 让子 Agent 继续使用父 Agent 已解析的模型目标。Project Bundle 贡献 `project_list` 和 `conversation_list`，这些工具通过 `productHost` 接入；Canvas Bundle 贡献 `canvas_inspect`、`canvas_create`、`canvas_edit` 和 `canvas_suggest`，这些工具通过 `productHost` 接入；Structured UI Bundle 贡献 `ui_render`，该工具通过 `productHost` 接入；Office Bundle 贡献三个 `artifact_office_*` 工具，这些工具通过 `officeArtifactHost` 接入。Canvas 与 Site 写入使用不可变基础版本；Office 读取保留稳定编辑锚点，并从模型结果中去掉界面预览 SVG 数据。`ui_render` 由父进程校验有界的结构化文档，并能从 DSH 历史恢复同一交互界面。

## 已知限制和后续工作

- 当前公开 SDK 不提供这个应用专用的 ProductHost。因此由私有的 `@vibeinging/dsh-work-product-host-ipc` 适配器提供与传输无关的服务；这个 Bundle 只持有应用指令上下文。模型继承和记忆是独立的 portable/社区 Bundle，而项目、Canvas、Structured UI 和 Office 工具是独立的桌面消费方。它可以在将来切换到 DSH 发布的提供方，无需把 IPC 移回功能代码。
- `0.1.2-alpha.4` SDK 包可以公开读取，不需要 `NPM_TOKEN`，但开发时必须固定精确版本，因为 registry dist-tag 可能落后于已经发布的版本。开发时不能链接 DSH 源码，也不能混装不同预发布系列。
- 本包为私有包；成品必须携带相同的审核版本和匹配的官方 NPM SDK 版本。
