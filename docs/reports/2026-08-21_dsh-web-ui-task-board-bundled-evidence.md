# dsh-web-ui 独立任务看板内置证据

## 结论

新 Profile 默认安装 `@linxin666/dsh-client-ui-task-board@0.2.7`。它作为独立 DSH Profile Bundle 进入官方 Web Client 图，不安装 `@linxin666/dsh-web-ui-all` 聚合包，不替换官方 Chat、Session 或应用 Shell。已有 Profile 继续由用户的 `dsh.profile.bundles`、依赖和 patch 决定；应用更新不补装或恢复用户已卸载的任务看板。

## 供应链和离线边界

Server 的直接依赖和 `package-lock.json` 固定任务看板版本、registry integrity 和依赖闭包。精选产物生成器校验上游 Host 入口、`./client` 导出、`cordis.patch.yml`、`ui-task-board` 行、DSH peer 范围、Host inject、路由、无安装脚本和无原生 npm 依赖，然后把 `schemastery@3.18.0`、`cosmokit@1.8.1` 与 `@standard-schema/spec@1.1.0` 封入固定 tarball。空 pnpm store 下的官方 `dsh plugin --profile web add -w file:<tarball> --offline --ignore-scripts` 已通过，`--dump-config` 能看到 `ui-task-board`。

任务看板 `package.json` 声明 Apache-2.0，但 npm tarball 内 `LICENSE` 是带上游作者署名的 BSD-3-Clause。发行清单按 tarball 内真实许可证记录 BSD-3-Clause，保留原文和 SHA-256，并同时记录 package.json 的 Apache-2.0 声明差异。三项封装依赖的 MIT 许可证原文和 registry integrity 也随产物分列保存。

## 权限和冲突

任务看板会读取当前 DSH Session、Workspace 与完成历史，在 `DSH_HOME` 写入任务账本和执行记录，可按用户操作或 Host cron 启动 DSH Session 任务，并提供默认关闭的固定跨平台防休眠 helper。Client 仅访问同源 `/api/task-board/*` 路由；Electron 主窗口仍无 product preload、Node 或通用 IPC。

精选清单明确声明它与 `@linxin666/dsh-web-ui-all` 冲突。发行包只安装独立任务看板，不安装聚合包、社区插件管理器、远程 Web、SSH、皮肤中心或未审查资产。

## 当前验证

- 元数据、registry integrity、依赖闭包、许可证原文和 Profile SDK 负例测试通过。
- 独立网络候选回归通过官方安装、官方 Web 启动、真实 Electron 入口、五列看板、停用、恢复、官方卸载和卸载后重启。
- 精选固定 tarball 在空 store、离线和禁用安装脚本条件下安装成功。
- 源码 Profile 逐包测量为 8/8 通过；任务看板冷启动测量为 400 ms，并确认 Client URL 进入官方 Web 启动图。
- 重新生成的 macOS arm64 目录包逐包 Electron 测量为 8/8 通过；任务看板冷启动为 2789 ms，并完成侧边栏点击和五列看板选择器检查。
- 打包社区生命周期回归通过默认离线初始化和激活、官方卸载、卸载后官方基线以及从随包 tarball 离线重装；当前公开截图来自默认激活帧。
- 完整 `test:release` 为 161 项中 158 项通过、3 项条件跳过、0 项失败；macOS 和 Windows 静态发行检查各为 13/13，artifact boundary、release boundary 和 typecheck 均通过。
- macOS arm64 断网预算 smoke 通过 8 个 Bundle 的新 Profile 初始化；当前 Profile 占用 5,429,855 / 6,000,000 bytes，精选 tarball 占用 318,818 / 400,000 bytes，冷启动为 5,642 / 10,000 ms。

## 未扩大声明

这些结果证明当前未签名 macOS arm64 目录包中的任务看板集成，不替代 Developer ID、Apple 公证、Gatekeeper、Windows 签名安装器、原生 Intel x64 或真实 DeepSeek live-model 证据，也不代表 `dsh-web-ui` 聚合包或其他子包已经通过发行门槛。
