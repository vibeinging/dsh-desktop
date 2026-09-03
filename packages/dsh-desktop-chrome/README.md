# @vibeinging/dsh-desktop-chrome

DSH Desktop 的 macOS 窗口标题栏适配 Bundle。

- 通过官方 DSH Client 图加载，不修改 DSH 源码。
- 只在 macOS Electron 中创建 36px 的主题化拖拽安全条；普通浏览器保持官方 Web 原样。
- 红黄绿窗口按钮位于安全条内，官方 Web 从安全条下方开始，不再发生覆盖。
- 长菜单会同时避开标题栏和窗口底边，列表内容在菜单内滚动。
- 没有 Host 权限、网络请求、持久状态或私有 Electron API。

安装和卸载使用官方命令：

```sh
dsh plugin --profile web add -w /path/to/dsh-desktop-chrome --save-exact --ignore-scripts
dsh plugin --profile web remove @vibeinging/dsh-desktop-chrome
```
