# DSH 插件市场选择与桌面接入

## 结论

桌面发行版默认内置 `dshmarket@1.17.1`，不再自建插件中心页面。它是独立 DSH Profile Bundle，Client 通过官方 Web `settings.section`、`settings.plugin.item` 和 `shell.overlay` Slot 注册，Host 通过 DSH Web 同源路由完成目录、已安装、诊断、更新、卸载、备份和主题选择。

## 候选对比

| 候选 | 定位 | 当前结论 |
| --- | --- | --- |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | 独立插件市场，使用官方设置 Slot | 选中。功能集中、页面完整、维护活跃，能删除我们自建管理页的需求 |
| `@linxin666/dsh-web-ui-all` 内的社区管理器 | 多功能聚合包的一部分 | 不选。聚合包带入远程 Web、SSH、Git、皮肤等不相关能力，传递依赖和资产许可也没有完成发行验收 |
| 官方 Web 基础插件设置 | Profile 状态和基础配置 | 保留作为权威投影和故障处理表面，不承担社区目录搜索 |

## 实际包审查

安装源固定为 npm `dshmarket@1.17.1`，包完整性固定为 `sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==`。npm tarball 为 603071 bytes，不含原生依赖，包内有完整 MIT 许可。运行依赖闭包是 `js-yaml@4.3.1`、其下的 `argparse@2.0.1` 和 `undici@7.29.0`。上游声明 `prepare` 和 `prepack`，发行版只使用已构建 tarball，安装一律传入 `--ignore-scripts`。

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

## 当前成本边界

11 个默认 Bundle 的 macOS arm64 目录包实测精选 tarball 合计 1,602,186 bytes，首次断网 Profile 约为 17,023,000 bytes，官方 Web 冷启动在连续验收中为 11.8 至 15.7 秒。发行门禁分别限制在 2,000,000 bytes、20,000,000 bytes 和 20,000 ms；增加市场不能成为以后无上限扩大默认包体的理由。
