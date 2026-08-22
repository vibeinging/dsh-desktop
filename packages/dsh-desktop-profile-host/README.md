# @vibeinging/dsh-desktop-profile-host

DSH Desktop 的 Profile 身份和受控包管理适配 Bundle。

- `desktopProfiles.current` 提供当前桌面代际固定的 Profile 名称和绝对目录。
- `desktopPnpm.runPlugin()` 始终调用官方 `dsh plugin --profile`，不会直接改写 Profile 依赖。
- `desktopPnpm.run()` 只运行发行包附带的 pnpm 入口。
- 同一代际最多执行一个包管理操作；取消和卸载会终止整棵子进程树。
- 不提供 Electron、窗口、文件对话框或任意 Shell 能力。
- Server 在每次启动官方 DSH Web 子进程时明确绑定 `web` Profile；Host 不从路径或进程参数猜测身份。

这个服务用于兼容采用同一公开 Host 合同的社区插件，例如 `dshmarket`。它不是第二套插件状态；Profile 仍是唯一权威。
