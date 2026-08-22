# @vibeinging/dsh-client-ui-worktree

独立的 Git Worktree Bundle。它通过官方 DSH Web Slot 提供固定入口和管理面板，每个 Worktree 使用独立的官方 Workspace 与 Session。

- Host 只从 DSH Session 固定的 `header.cwd` 推导仓库，浏览器不能指定仓库根目录。
- Worktree 只创建在主检出下的 `.dsh-worktrees/`；删除保留分支，未提交改动会由 Git 拒绝删除。
- Client 只使用官方 `sidebar.footer.action`、`shell.overlay`、`conversation.view` Slot 和 `ctx.workspaces`。
- 不读取 Electron、应用数据库或旧 Renderer 状态，可以单独安装到官方 Web。

本地 Profile 预检：

```sh
dsh plugin --profile web add -w /path/to/dsh-worktree
dsh plugin --profile web remove @vibeinging/dsh-client-ui-worktree
```
