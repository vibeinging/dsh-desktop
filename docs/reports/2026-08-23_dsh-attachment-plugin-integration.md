# DSH 附件输入插件内置报告

## 结论

`dsh-multimedia-webui-input@0.1.0` 已进入新 Profile 的默认精选清单。它使用官方 DSH Profile、Host 服务和会话输入 Slot，不向 Electron 壳添加业务界面或通用 IPC。新会话输入框已在真实未签名 macOS arm64 打包 Electron 中显示文件和文件夹选择按钮。

## 产物与供应链

- 上游：`LCYLYM/dsh-attachments`，审查提交 `028dc1f8dc9c7f963e714013b36adc4f48d88c2a`。
- npm：`dsh-multimedia-webui-input@0.1.0`，integrity 为 `sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==`。
- 上游 npm tarball：5,234,475 bytes，SHA-256 为 `73c53381e1259c08002c78991d2c35590593865eba6a39aba1e31a320a056727`。
- 发行 tarball：19,356 bytes，SHA-256 为 `5358675d37203449052f91e3fc7f3f539bb279dd42314b09e4bf0693e6d4c963`。
- 运行依赖、原生依赖和 npm 安装脚本：无。
- 许可证：MIT，许可证原文进入随包第三方公告。

发行包不携带上游的演示 GIF 和本地安装器。生成器只保留 `cordis.patch.yml`、`lib`、中英文 README 和 `LICENSE`。

## 官方能力冲突处理

官方 DSH rc.2 已注册图片粘贴和拖拽。上游附件插件也在 document 上监听通用文件拖拽，直接内置会让图片同时进入两条通道。发行生成器应用 `remove-composer-drop-listeners-v1`，只删除这组通用拖拽 effect。

变换同时锁定源文件 SHA-256 `80664dc90259b6312ac86259c5a3ccdacbc3b7674600e37f42404aeccc7834f4` 和输出 SHA-256 `8146c49bfe3f80396808a962d6e9b10fd1dc8bf5d5437f6a21de26ed2f26b96b`。任一端漂移都会阻止生成，不会对未审查新版静默打补丁。文件和文件夹选择按钮、流式上传、发送引用、设置和清理逻辑保持不变。

## 验证结果

| 层级 | 结果 |
| --- | --- |
| 契约回归 | `dsh-trusted-client-plugins.test.mjs` 9/9 通过，覆盖版本、integrity、零依赖、路径越界、变换源和输出漂移拒绝 |
| 离线产物 | 13 个精选 tarball 生成成功；附件 Client 保留 `Attach files or a folder`，不包含 document `drop` 监听 |
| 源码 Profile | 13/13 通过；附件 Bundle 冷启动 403 ms，安装、停用、官方卸载和重启恢复通过 |
| 打包 Electron | macOS arm64 未签名候选通过；输入 Slot 按钮可见，安装后冷启动 10,634 ms，卸载后冷启动 10,088 ms |
| 生命周期 | `install/start/disable/uninstall/restart_after_uninstall/manifest_unchanged_while_disabled` 全部为 `true` |
| 断网预算 | 13 个 Bundle 首次初始化通过；精选 tarball 1,639,477/2,000,000 bytes，Profile 17,337,154/20,000,000 bytes，冷启动 12,304/20,000 ms |
| 发行静态门禁 | release boundary 和 artifact boundary 通过；macOS 与 Windows static 各 13/13 通过 |

当前测量绑定的精选源 manifest SHA-256 为 `a0f9d542d1e2258e78d33d4ceb4ed06afc74fb60842283d79bedc48dade08c9c`，随包 manifest SHA-256 为 `3193293ed7b4b8cb4adcac5476bc3ebf23991ddd3b94cdc4618397e9e633ab11`。临时打包 App 内的 manifest 与生成目录逐字节一致。

## 不扩大的结论

本报告证明当前源码、Profile 和未签名 macOS arm64 打包 Electron 的附件入口成立。它不代表已生成 Developer ID 签名新产物、完成 Apple 公证、验收 Windows 签名安装器，也不把普通文件引用宣称为原生图片或音频多模态。已有 Profile 不会在更新时被静默补装；新 Profile 使用当前默认清单。
