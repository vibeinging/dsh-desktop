# DeepSeek Harness Desktop App 产品桥接

[English](README.md) | 中文

这个私有 Profile Bundle 在不导入、不修改 DSH 源码检出目录的前提下扩展官方 DSH Web Profile。它持有应用上下文、记忆与模型继承衔接逻辑，不再注册任何 Tool 或工作台页面。它消费按 Session 寻址的 `productHost` 服务，该服务由 `@deepseek-ai/dsh-work-product-host-ipc` 提供；独立的 `@deepseek-ai/dsh-project-tools` Bundle 持有 `project_list` 和 `conversation_list`，`@deepseek-ai/dsh-canvas-tools` 持有四个 Canvas/Site 工具，`@deepseek-ai/dsh-structured-ui-tools` 持有 `ui_render`，`@deepseek-ai/dsh-office-tools` 消费 `officeArtifactHost`，`@deepseek-ai/dsh-workbench-pages` 持有应用工作台目录。

子进程只发送 DSH Session id。独立的 IPC 适配器把每个请求绑定到一个已授权的 DeepSeek Harness Desktop App Session、用户和项目，随后父进程通过一个受控 dispatcher 处理项目、对话、Canvas/Site 和 Office 请求。请求不能切换到另一身份或项目。Canvas/Site 审批归 Canvas Bundle 所有，Office 审批归 Office Bundle 所有。每次调用都会生成普通且可持久恢复的 DSH 工具事件；写入成功后还会投影一条隐藏工作台事件，让实时界面和恢复后的历史打开同一个 Canvas、Site 或产物。

每个进入模型的步骤都会通过同一个父进程绑定读取允许使用的应用指令、项目指令和全局/项目记忆。产品桥把它们作为不可变用户消息加入 `agent/pre-step` 的进入批次，并分别以 `dsh-work-context` 和 `dsh-work-memory` 来源写入 DSH Session Log；读取失败只跳过这次补充，不会替换用户消息或建立第二份历史。

产品桥还记录父 Agent 最终解析出的 provider/model。DSH 创建子 Agent 时，它会在第一次请求前固定同一目标，避免子 Agent 回退到进程启动默认模型；父 Agent 之后的新请求仍按自己的正常设置解析。

运行时就绪、产品 IPC、请求关联、取消和关停清理现均由 `@deepseek-ai/dsh-work-product-host-ipc` 负责，不属于这个功能 Bundle。

已删除的项目 Plugin 挂载、Skill 和 MCP 数据不会通过 ProductHost 投影。它们的目录方法返回空目录，而 Profile Bundle 的 Skill 和工具继续由 DSH 原生注册表管理。

## 模型体验

模型在同一 Session Log 中从这个 Bundle 接收已授权的指令与记忆。Project Bundle 贡献 `project_list` 和 `conversation_list`，这些工具通过 `productHost` 接入；Canvas Bundle 贡献 `canvas_inspect`、`canvas_create`、`canvas_edit` 和 `canvas_suggest`，这些工具通过 `productHost` 接入；Structured UI Bundle 贡献 `ui_render`，该工具通过 `productHost` 接入；Office Bundle 贡献三个 `artifact_office_*` 工具，这些工具通过 `officeArtifactHost` 接入。Canvas 与 Site 写入使用不可变基础版本；Office 读取保留稳定编辑锚点，并从模型结果中去掉界面预览 SVG 数据。`ui_render` 由父进程校验有界的结构化文档，并能从 DSH 历史恢复同一交互界面。

## 已知限制和后续工作

- 已发布的 rc.6 SDK 不包含 ProductHost 包。因此目前由私有的 `@deepseek-ai/dsh-work-product-host-ipc` 适配器提供与传输无关的服务；这个 Bundle 只持有上下文、记忆和模型衔接逻辑。项目、Canvas、Structured UI 和 Office 工具是独立的消费方。它可以在将来切换到 DSH 发布的提供方，无需把 IPC 移回功能代码。
- rc.6 SDK 包可以公开读取，不需要 `NPM_TOKEN`，但开发时必须显式固定 `next`/rc.6 发布系列，因为部分细包的 `latest` 仍指向旧版本。开发时不能链接 DSH 源码，也不能混装不同 RC 系列。
- 本包为私有包；成品必须携带相同的审核版本和匹配的官方 NPM SDK 版本。
