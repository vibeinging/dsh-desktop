# @vibeinging/dsh-work-references

独立的工作区文件引用 Bundle，替代依赖退役 Shell 的旧产品引用插件。

- Host 端只根据 DSH Session 自己的 `header.cwd` 扫描工作区，不接受浏览器传入的路径。
- 结果只有工作区相对路径，扫描深度、条目数和候选数都有上限。
- Client 端只注册官方 `@` input trigger，不读取 Electron、Node 或应用私有状态。
- 不停用官方 Profile 行，可单独安装、停用和卸载。

安装和卸载仍使用官方命令：

发布到 npm 前，可用本地源码路径做同样的 Profile 预检：

```sh
dsh plugin --profile web add -w /path/to/dsh-work-references
dsh plugin --profile web remove @vibeinging/dsh-work-references
```
