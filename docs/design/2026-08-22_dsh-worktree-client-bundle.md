# DSH Worktree Client Bundle 设计

## 目标

把已经存在的 Git Worktree 能力迁移到官方 DSH Web 插件图中。它必须能作为独立 Profile Bundle 安装到官方 Web，也能作为 DSH Desktop 的默认精选插件运行，不恢复旧 Renderer，也不替换官方聊天页。

## 当前问题

旧 Renderer 曾提供 Worktree 的创建、启用和删除界面，Server 也保留了对应 Git 与项目数据库能力。旧 Renderer 退役后，官方 Web 成为唯一主界面，但没有任何 Client Bundle 重新提供这个入口，因此能力还在，入口消失了。

旧界面的“启用 Worktree”语义也不能原样搬到 DSH。DSH Session 的 `header.cwd` 在 Session 生命周期内固定，运行时会拒绝同一个 Session 改用另一个工作目录。继续维护一个应用私有的“当前 Worktree”状态会形成第二套工作区真相。

## 方案

新增 `@vibeinging/dsh-client-ui-worktree` 独立 Bundle，分为两半：

- Host 半边只从请求所指 DSH Session 的 `header.cwd` 获取可信目录，调用系统 Git 管理主检出下的 `.dsh-worktrees/`。
- Client 半边通过官方 `conversation.view` Slot 增加 Worktree 页签，并通过 `sidebar.footer.action` 与 `shell.overlay` 提供空白会话也能使用的常驻入口。两处入口复用同一个面板，通过官方 `ctx.workspaces` 注册目录和打开 Session。
- 创建 Worktree 后不修改当前 Session。Client 把新目录注册为 Workspace，并在该 Workspace 中打开新 Session。
- Bundle 不读取 Electron IPC、应用数据库或旧 Renderer 状态，因此可以安装到官方 DSH Web。

## 数据与调用链

```text
conversation.view Worktree 页签
  -> POST /dsh-worktree { sessionId, action }
  -> Host 从 ctx.sessions.get(sessionId).header.cwd 取固定目录
  -> Git 找到共享主检出并创建或列出 .dsh-worktrees/*
  -> Client 调用 ctx.workspaces.create({ path })
  -> Client 调用 ctx.workspaces.startSession(workspaceId)
  -> 官方 Workspace 与 Session 成为唯一界面状态
```

浏览器不能提交仓库根目录。所有写入目标都由 Session cwd 推导，管理目录必须是主检出根目录的直接子目录，符号链接、路径穿越和非受管 Worktree 都会被拒绝。

## 删除规则

- 当前 Session 所在的 Worktree 不能删除。
- 已注册 Workspace 且仍有关联 Session 时不能删除。
- 已注册但没有 Session 的 Workspace，先删除官方 Workspace 注册，再删除 Git Worktree。
- 删除 Git Worktree 默认保留分支，避免同时删除工作目录和分支造成不可恢复的数据损失。
- 创建 Git Worktree 后若 Workspace 注册失败，Client 立即请求 Host 回收刚创建的 Worktree，避免留下孤立目录。

## 界面

Worktree 是对话视图中的紧凑页签，同时在侧边栏底部提供常驻入口；常驻入口使用官方浮层 Slot 打开同一面板，不是设置页和第二套首页。界面采用单列目录：主检出始终在首行，受管 Worktree 按 Git 返回顺序排列。创建表单在原位展开，不使用弹窗；删除使用行内二次确认。加载、非 Git 目录、空列表、业务错误和进行中状态分别显示。

样式只使用官方 `--dsw-*` 语义变量，跟随安装方主题。窄容器下路径和操作换行，但创建、打开和删除入口不会被隐藏。

## 验收

1. Bundle 通过 `dsh.bundle.patch` 和 `dsh.client` 声明进入 Profile，不修改 DSH 源码。
2. Client 使用 `conversation.view` 与 `ctx.workspaces`，没有 DOM 注入、Electron IPC 或旧 Renderer 引用。
3. Host 只信任 Session cwd；跨源请求、超大请求体、非法分支、非 Git 目录和越界删除都有失败测试。
4. 从主检出和已有 Worktree 内的 Session 都能定位同一个主检出。
5. 创建、打开、独立 Session、卸载和重启恢复经过真实 Profile 与 Electron 流程验证。
6. 精选插件清单、离线 tarball、README 和截图都由同一 Bundle 产物更新。
