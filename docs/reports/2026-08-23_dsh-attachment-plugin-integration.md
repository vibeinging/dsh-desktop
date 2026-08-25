# DSH 附件输入插件内置报告

## 结论

`dsh-multimedia-webui-input@0.1.0` 已进入新 Profile 的默认精选清单。它使用官方 DSH Profile、Host 服务和会话输入 Slot，不向 Electron 壳添加业务界面或通用 IPC。发行适配现在把图片选择交给 DSH 官方原生图片附件通道，文件和文件夹仍按原逻辑写入 Session 工作区。真实未签名 macOS arm64 打包 Electron 已完成图片菜单、原生图片预览、停用、官方卸载和重启恢复验收。

## 产物与供应链

- 上游：`LCYLYM/dsh-attachments`，审查提交 `028dc1f8dc9c7f963e714013b36adc4f48d88c2a`。
- npm：`dsh-multimedia-webui-input@0.1.0`，integrity 为 `sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==`。
- 上游 npm tarball：5,234,475 bytes，SHA-256 为 `73c53381e1259c08002c78991d2c35590593865eba6a39aba1e31a320a056727`。
- 发行 tarball：19,757 bytes，SHA-256 为 `dfa1a42b0a63410732ae12ca321769f4301c58fc515e99f2873aafaf285240b8`。
- 运行依赖、原生依赖和 npm 安装脚本：无。
- 许可证：MIT，许可证原文进入随包第三方公告。

发行包不携带上游的演示 GIF 和本地安装器。生成器只保留 `cordis.patch.yml`、`lib`、中英文 README 和 `LICENSE`。

## 官方能力冲突处理

官方 DSH rc.2 已注册图片粘贴和拖拽。上游附件插件也在 document 上监听通用文件拖拽，直接内置会让图片同时进入两条通道。发行生成器应用 `native-image-picker-v2`：删除上游通用拖拽监听，在附件菜单增加独立的 `Choose images`，并把浏览器标准文件输入得到的图片交给官方图片拖拽入口。该入口继续使用官方的 MIME、数量、单图大小和总大小检查；普通文件和文件夹不变。

变换同时锁定源文件 SHA-256 `80664dc90259b6312ac86259c5a3ccdacbc3b7674600e37f42404aeccc7834f4` 和输出 SHA-256 `d924751b3b46bfa5a5b8f998bdbf69d62bf3b514f9e3edf099ae57d2b2658ba5`。任一端漂移都会阻止生成，不会对未审查新版静默打补丁。文件和文件夹选择、流式上传、发送引用、设置和清理逻辑保持不变。

## 验证结果

| 层级 | 结果 |
| --- | --- |
| 契约回归 | `dsh-trusted-client-plugins.test.mjs` 10/10 通过，覆盖版本、integrity、零依赖、路径越界、变换源和输出漂移拒绝，以及打包图片验收接线 |
| 离线产物 | 14 个精选 tarball 生成成功；附件 Client 保留 `Attach files or a folder`，新增 `Choose images`，不再注册上游 document `drop` 监听 |
| 源码 Profile | 14/14 通过逐包安装、启动和管理边界；附件 Bundle 冷启动 438 ms |
| 打包 Electron | 2026-08-25 的 macOS arm64 未签名隔离候选通过；安装后冷启动 10,574 ms，并由真实 Client 创建 PNG `File`、经过图片菜单路径进入官方图片预览条 |
| 生命周期 | `install/start/disable/uninstall/restart_after_uninstall/manifest_unchanged_while_disabled` 全部为 `true` |
| 本轮边界 | `test:release` 200 项中 197 pass/3 conditional skip，0 fail；`typecheck`、release/artifact boundary 和 `git diff --check` 通过；macOS、Windows static 各 13/13 通过 |

本轮候选生成的精选源 manifest SHA-256 为 `2618e5bf8d1bb6f7dd82c0f5b6c35451b2e9a0f8f325b8b434e0584b33b72789`，随包 manifest SHA-256 为 `80a71616c797d09520e1f442d2159878608313580d6fb12bc211f2b1a60be8d1`。哈希绑定当前内容；正式发行前仍须在最终 commit 上重新生成测量回执。

## 不扩大的结论

本报告证明当前源码、Profile 和未签名 macOS arm64 打包 Electron 的图片草稿入口成立。此前同一 rc.2 底座已用真实 DeepSeek `deepseek-v4-flash-vision-exp` 验证原生 image block 的模型往返，但本轮尚未把新的图片菜单候选重新签名、公证并完成同一构建的真实模型发送。它不代表 Windows 签名安装器已验收，也不把普通文件引用或音频宣称为原生多模态。已有 Profile 不会在更新时被静默补装；新 Profile 使用当前默认清单。
