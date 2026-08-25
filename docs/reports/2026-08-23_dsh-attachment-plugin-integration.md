# DSH 附件输入插件内置报告

## 结论

`dsh-multimedia-webui-input@0.1.0` 已进入新 Profile 的默认精选清单。它使用官方 DSH Profile、Host 服务和会话输入 Slot，不向 Electron 壳添加业务界面或通用 IPC。发行适配提供一个文件选择入口并按 MIME 自动分流：图片交给 DSH 官方缩略图和原生图片附件通道，普通文件仍写入 Session 工作区，文件夹保持原逻辑。真实未签名 macOS arm64 打包 Electron 已同时完成图片缩略图、普通文件卡片、停用、官方卸载和重启恢复验收。

## 产物与供应链

- 上游：`LCYLYM/dsh-attachments`，审查提交 `028dc1f8dc9c7f963e714013b36adc4f48d88c2a`。
- npm：`dsh-multimedia-webui-input@0.1.0`，integrity 为 `sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==`。
- 上游 npm tarball：5,234,475 bytes，SHA-256 为 `73c53381e1259c08002c78991d2c35590593865eba6a39aba1e31a320a056727`。
- 发行 tarball：19,821 bytes，SHA-256 为 `d9cb009f3814646e6962a2f1875d0885c948d39a9a549fb13909056a0bcf070f`。
- 运行依赖、原生依赖和 npm 安装脚本：无。
- 许可证：MIT，许可证原文进入随包第三方公告。

发行包不携带上游的演示 GIF 和本地安装器。生成器只保留 `cordis.patch.yml`、`lib`、中英文 README 和 `LICENSE`。

## 官方能力冲突处理

官方 DSH rc.2 已注册图片粘贴和拖拽，并通过 `AttachmentRail` 显示草稿缩略图。上游附件插件也在 document 上监听通用文件拖拽，直接内置会让图片同时进入两条通道。发行生成器应用 `smart-attachment-picker-v3`：删除上游通用拖拽监听，保留单一 `Choose files`，按官方 `imageLimits.mediaTypes` 把图片交给原生图片入口，把其余文件交给工作区附件入口。混合选择自动拆分；文件夹仍保留目录结构并进入工作区。官方继续负责图片格式、数量、单图大小、总大小、缩略图和发送序列化。

变换同时锁定源文件 SHA-256 `80664dc90259b6312ac86259c5a3ccdacbc3b7674600e37f42404aeccc7834f4` 和输出 SHA-256 `a58603195621475c7589a398b3854c05e1c3a9b535adf5691d7f04f5dd7720e7`。任一端漂移都会阻止生成，不会对未审查新版静默打补丁。文件夹选择、普通文件流式上传、发送引用、设置和清理逻辑保持不变。

## 验证结果

| 层级 | 结果 |
| --- | --- |
| 契约回归 | `dsh-trusted-client-plugins.test.mjs` 10/10 通过，覆盖版本、integrity、零依赖、路径越界、变换源和输出漂移拒绝，以及打包图片验收接线 |
| 离线产物 | 附件 Client 保留 `Attach files or a folder` 和单一 `Choose files`，不再注册上游 document `drop` 监听；图片和普通文件由选择结果自动分流 |
| 源码 Profile | 14/14 通过逐包安装、启动和管理边界；附件 Bundle 冷启动 438 ms |
| 打包 Electron | 2026-08-25 的 macOS arm64 未签名隔离候选通过；安装后冷启动 10,476 ms；同一次混合选择创建真实 PNG 和 TXT `File`，PNG 只进入官方缩略图，TXT 只进入工作区文件卡片 |
| 生命周期 | `install/start/disable/uninstall/restart_after_uninstall/manifest_unchanged_while_disabled` 全部为 `true` |
| 本轮边界 | `test:release` 200 项中 197 pass/3 conditional skip，0 fail；`typecheck`、release/artifact boundary 和 `git diff --check` 通过；macOS、Windows static 各 13/13 通过 |

本轮候选生成的精选源 manifest SHA-256 为 `67bc28761ae8eee35290a391281e5e1eacf5bb85490d30ee374a048f1603dcd5`，随包 manifest SHA-256 为 `30ee0813edae6c2a7e8cfe3911597e5f525f049f0c9be85edf7613ed9da31e5b`。哈希绑定当前内容；正式发行前仍须在最终 commit 上重新生成测量回执。

## 不扩大的结论

本报告证明当前源码、Profile 和未签名 macOS arm64 打包 Electron 的统一附件选择成立。此前同一 rc.2 底座已用真实 DeepSeek `deepseek-v4-flash-vision-exp` 验证原生 image block 的模型往返，但本轮尚未把新的自动分流候选重新签名、公证并完成同一构建的真实模型发送。它不代表 Windows 签名安装器已验收，也不把普通文件引用或音频宣称为原生多模态。已有 Profile 不会在更新时被静默补装；新 Profile 使用当前默认清单。
