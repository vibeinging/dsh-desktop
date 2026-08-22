# 第三方组件和分发说明

本文件记录 DSH Desktop 正式安装包中的关键第三方代码和原生二进制。完整依赖版本以各目录的 `package-lock.json` 为准，具体许可证文本保存在对应 npm 包或仓库文件中。

| 组件 | 当前版本 | 许可证 | 分发说明 |
| --- | --- | --- | --- |
| Electron | 42.4.1 | MIT | 桌面运行时 |
| React | 18.3.1 | MIT | 界面运行时 |
| electron-updater | 6.8.9 | MIT | 安装包更新组件 |
| Model Context Protocol SDK | 1.30.0（随 `@deepseek-ai/dsh` 传递引入） | MIT | MCP 客户端与协议支持 |
| OpenAI Agent Runtime | 0.147.0 | Apache-2.0 | 随包第三方 Agent 运行组件；许可证见 `legal/openai-agent-runtime-LICENSE.txt` |
| DuckDB Node API | 1.5.4-r.1 | MIT | 随包原生数据引擎 |
| better-sqlite3 | 12.11.1 | MIT | 随包 SQLite 原生模块 |
| yiTrace DB | 0.1.8 | MIT | 随包 Trace 存储模块 |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | 表格文件读取；许可证文本随 npm 包分发 |
| VexDB Lite | 上游发行版 v0.0.17；随包文件见来源记录 | MIT | SQLite 向量扩展；许可证与来源见 `server/vendor/vexdb_lite/LICENSE` 和 `RELEASE-PROVENANCE.md` |
| DeepSeek Harness npm runtime | 0.1.1-rc.2 | MIT | 官方 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-web-app` 和 Cordis npm 包；不修改官方源码 |
| DSH Desktop first-party Bundles | 当前仓库版本 | BSD-3-Clause | `@vibeinging/*` 包通过官方 Profile 组合；许可证原文随包位于 `featured-plugins/licenses/BSD-3-Clause.txt`，逐包来源、权限和 SHA-256 由精选清单生成；默认清单不包含自研主题、替换 Shell 或工作台目录 |
| DSH task board | `@linxin666/dsh-client-ui-task-board@0.2.7` | BSD-3-Clause | 新 Profile 默认安装的独立社区 Bundle；固定 tarball 同时封装 MIT 许可的 `schemastery@3.18.0`、`cosmokit@1.8.1` 和 `@standard-schema/spec@1.1.0`，逐项许可证原文、来源、完整性和权限由精选清单生成 |
| DSH Plugin Market | `dshmarket@1.17.1` | MIT | 新 Profile 默认安装的社区市场 Bundle；固定 tarball 同时封装 MIT 许可的 `js-yaml@4.3.1` 和 `undici@7.29.0`，以及 Python-2.0 许可的 `argparse@2.0.1`；逐项许可证原文、来源、完整性和权限由精选清单生成，市场内展示的其他插件不随发行包分发 |

## OpenAI Agent Runtime

产品随 macOS/Windows 安装包分发 OpenAI 提供的 Apache-2.0 Agent 运行组件。当前接入层只通过公开协议调用，没有修改上游源码。

分发遵守以下要求：

1. `server/package-lock.json` 固定来源版本和包校验值；
2. 安装包包含 `legal/openai-agent-runtime-LICENSE.txt`；
3. 当前 npm 分发包没有附带独立 NOTICE 文件；升级版本时必须重新检查；
4. DSH Desktop 没有获得 OpenAI 商标授权，不得把产品宣传成 OpenAI 官方产品；
5. 如果以后修改上游源码，必须记录修改文件并保留明显的修改说明。

## VexDB Lite

已核对上游 `v0.0.17` 正式发行版及其 MIT 许可证。随包保留许可证、二进制
SHA-256 和来源记录。由于 v0.0.17 没有 Windows 预编译包，当前 Windows 文件不标记为
该发行版资产；替换二进制时必须重新核对平台、架构、来源和校验值。

## 发布硬门槛

以下任一项未完成时，不得对外分发正式安装包：

- VexDB Lite 或其他仓库内二进制缺少许可证、来源记录或校验值；
- 生产依赖许可证清单没有复核；
- macOS 安装包没有 Developer ID 签名、公证和票据；
- Windows 安装包没有代码签名和 Windows x64 实机验收。

## 社区插件和皮肤资产

社区插件不是 DeepSeek 或 DSH 官方产品。发行包内置经过逐包审查的任务看板和 `dshmarket`，不携带 `dsh-web-ui` 聚合包或未审查的皮肤资产。任务看板的 `package.json` 声明 Apache-2.0，但 npm tarball 内 `LICENSE` 是带作者署名的 BSD-3-Clause；发行包按 tarball 内原文保留 BSD-3-Clause 许可证和署名，并在生成的公告中记录这项元数据差异。`dshmarket` 只提供目录与 Profile 管理界面，市场内展示的其他插件并未随发行包内置；用户确认安装后的来源、权限和许可由对应插件负责。其他默认候选必须通过固定来源、依赖、权限、许可证、真实 Electron 启动和卸载回归。没有可核对再分发许可的皮肤、插图、字体、音频和视频不得进入安装包。
