# dsh-web-ui 集成报告

## 当前状态

本文是历史兼容性实验记录，不是当前发行验收通过证据。当前 DSH Desktop 只维护官方 `dsh-web-app` 主界面，不再维护旧 Renderer、插件中心或第二套 Chat/首页/设置页面。

2026-08-21 复核 `@linxin666/dsh-web-ui-all@0.1.20` 时，官方 CLI 可以把聚合包写入隔离 Profile 的顶层依赖，但启动时 Profile 根无法解析它声明的传递 Client 依赖，因此没有取得 Client 页面钩子、真实界面加载或卸载后恢复证据。该聚合包不能标记为兼容通过，也不能进入精选清单或默认 Profile。

## 历史实验边界

此前报告记录的聚合包包含多个高权限子包、视觉资产和主机能力。它们的 npm 来源、integrity、权限和依赖图仍需按当前 rc.7 官方 Profile 逐项复核；旧报告中的插件中心截图、旧产品布局和“可以运行聚合包”的结论均不覆盖当前代码。

聚合包的传递依赖解析失败是兼容性阻塞，不通过增加第二套 UI、复制社区源码或静默创建应用侧插件状态来规避。当前社区候选只按独立 `dsh-web-ui` 子包的固定版本、官方命令、官方 Web、真实 Electron 和卸载重启证据单独判断；可接受的 task-board 证据见 [发行证据报告](2026-08-20_dsh-app-release-evidence.md)。

## 当前发行边界

官方 Web 的 Profile、Session、模型、插件和窄 Native Host 链路继续由当前发行测试和 Electron smoke 验证。聚合包没有通过当前兼容验收；Better Sidebar、Chat recovery、皮肤中心和未经逐项许可审查的视觉资产也不进入发行 Profile。
