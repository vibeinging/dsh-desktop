# 发版真机 Eval

## 目标

发版候选必须在本地物理设备上完成安装和用户可见流程验收。GitHub Actions、虚拟机、源码测试、目录包 smoke 和自动安装器 smoke 都不能替代这份证据。

## 边界

现有 `eval/run.mjs` 继续负责开发态、隔离数据和真实 Electron 流程；macOS、Windows workflow 继续负责签名、安装器和自动 smoke。真机 Eval 是第三层，绑定最终 DMG 或 EXE、Git commit、版本、平台、架构、物理设备标识哈希、操作人别名、检查结果和脱敏截图，不保存电脑名称。

通过回执不得来自 CI，源码工作树必须没有 tracked 修改。macOS 与 Windows 分别生成回执；缺少对应物理设备时，该平台保持未验收，不能用另一平台或 GitHub Runner 补位。

## 检查范围

真机流程固定检查候选安装、首次启动、官方 Web、真实模型回复、图片、文件附件、目录选择、插件中心、Better Sidebar、更新检查、原生窗口控制、重启后的 Profile 保留和卸载清理。用户可见检查必须带截图；截图不得包含 API Key、个人路径或私人会话。

## 使用

在候选安装包对应的物理设备上运行：

```bash
npm run eval:release-device -- --artifact release/<candidate.dmg-or-exe> --operator <alias>
```

命令逐项询问 `pass` 或 `fail`，复制并计算证据文件哈希，最终写入 `.desktop-build/release-device-eval/<run>/result.json`。macOS 输入 `capture` 可直接截取当前屏幕。任一检查失败只保存失败记录，不生成可通过门禁的回执。

在发布候选 checkout 中复核：

```bash
npm run eval:release-device:verify -- --receipt <result.json> --artifact <candidate.dmg-or-exe>
```

校验器会重新计算安装包和每个证据文件的 SHA-256，并检查 commit、平台、架构、物理设备声明和完整清单。回执只证明该安装包在该设备上的一次验收，不扩大为其他平台或架构结论。

## 发版规则

公开 macOS 产物前需要对应 macOS 架构的通过回执；公开 Windows 产物前需要 Windows x64 通过回执。签名、公证、Gatekeeper、Authenticode、真实模型和自动 smoke 仍由各自门禁负责，不能被真机人工勾选替代。
