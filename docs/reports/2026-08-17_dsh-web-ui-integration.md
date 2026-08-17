# dsh-web-ui 集成报告

## 结论

DeepSeek Harness Desktop App 已经可以通过 DSH rc.7 的 Web Profile 安装并运行社区 `dsh-web-ui` 聚合包。实测版本固定为 `@linxin666/dsh-web-ui-all@0.1.20`，对应审查 commit `92655dbefeaf08cb60429f4b487c33137889a3f7` 和 npm integrity `sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==`。本次没有修改 DSH 官方源码，也没有复制社区插件代码。

## 接入方式

插件中心的机器目录记录精确 npm 来源、审查 commit、integrity、权限和安装提示。候选包先进入隔离 Profile 运行官方兼容性检查，通过后才写入用户的 `web` Profile。产品自身的 Bundle 先建立桌面壳，用户 Bundle 后加载，避免社区 Client 抢占根布局所有权。

`dsh-web-ui-all` 的 patch 直接引用 13 个同版本子包，但 pnpm 的聚合包目录不会把这些子包暴露到 Profile 根解析位。App 只为通过审查的精确依赖图创建 Profile 解析链接；聚合包卸载后，如果子包不是用户直接安装的依赖，对应链接也会移除。任何包名、版本、Bundle patch 或依赖图变化都会重新进入隔离状态，不能沿用旧审查结论。

产品根布局从五个 CSS 网格轨道收敛为 DSH Web 使用的三轨 `sidebar | conversation | details` 合同，并提供 `data-dsh-frame`、`data-pane="sidebar"`、`data-pane="conversation"` 和 `data-pane="details"`。社区 AionUI 在这三轨之后增加自己的 preview 与 explorer 轨道，任务看板和 SSH 则使用产品导航及中间区，不再依赖私有类名猜测。

社区任务看板和 SSH 使用自己的入口维护中间区打开状态。产品切换到设置或插件中心前会点击当前激活的社区入口完成正式关闭，让社区控制器、HTML 状态和产品路由保持一致；不会只移除可见样式而留下错误的插件状态。

## 权限边界

聚合包包含读取本地仓库和图片、运行 Git 与 SSH、远程 Web、SSH、模型服务和电源保持进程等主机侧能力。它不是普通配色插件。插件中心在安装对话中明确显示本地文件、进程和网络三类权限，且只允许审查过的 `0.1.20` 聚合包与 13 个同版本依赖进入当前 Renderer。其他第三方 Client 仍保持隔离。

## 验证证据

- `node --test eval/tests/agent-shell-layout.test.mjs eval/tests/dsh-profile-plugin-service.test.mjs eval/tests/dsh-trusted-client-plugins.test.mjs`：38 个聚焦测试通过。
- `npm run typecheck`：通过。
- `npm run build:desktop-assets`：通过，正式 Client Bundle 已重建。
- `npm run smoke:dsh-web-ui`：在隔离数据目录启动真实 Electron，通过插件中心 API 完成 rc.7 Profile 预检、安装和页面重载；任务看板与 SSH 入口存在，任务看板在产品 `conversation` 中间区内显示 5 列，没有把外部 `data-pane` 带到产品框架之外；从任务看板进入产品插件中心后，社区入口与 HTML 激活状态都已关闭。
- README 截图：`docs/images/readme/dsh-web-ui-task-board.png`，由同一真实 Electron 冒烟脚本直接保存。

## 当前边界

这次证明了官方 Profile 生命周期、Host Bundle 和 Client UI 可以在 App 中形成同一条安装链，不代表聚合包的全部高权限能力都完成了产品验收。任务看板与 SSH 入口已经验证；远程 Web、公网隧道、SFTP、端口转发、Git 写操作和皮肤覆盖仍需要逐项安全与交互测试。基础 Profile 不默认启用这个高权限聚合包，用户需要在插件中心查看权限并主动安装。
