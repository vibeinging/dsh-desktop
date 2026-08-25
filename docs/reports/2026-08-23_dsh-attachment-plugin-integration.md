# DSH 附件输入插件内置报告

## 结论

`dsh-multimedia-webui-input@0.1.0` 已进入新 Profile 的默认精选清单。它使用官方 DSH Profile、Host 服务、会话输入 Slot 和 `commandUi`，不向 Electron 壳添加业务界面或通用 IPC。发行适配同时保留纸夹入口，并向官方 `+` 菜单加入 `attach-files` 与 `attach-folder`；文件按 MIME 自动分流，图片交给 DSH 官方缩略图和原生图片附件通道，普通文件仍写入 Session 工作区，文件夹保持原逻辑。当前未签名 macOS arm64 目录包已经重新生成命令菜单和附件分流的真实 Electron 证据。

## 产物与供应链

- 上游：`LCYLYM/dsh-attachments`，审查提交 `028dc1f8dc9c7f963e714013b36adc4f48d88c2a`。
- npm：`dsh-multimedia-webui-input@0.1.0`，integrity 为 `sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==`。
- 上游 npm tarball：5,234,475 bytes，SHA-256 为 `73c53381e1259c08002c78991d2c35590593865eba6a39aba1e31a320a056727`。
- 发行 tarball：20,317 bytes，SHA-256 为 `58748b7f4299b1885a6ddf6e1317eb0cdee4d6be5b7a9c88a36d828aac9749b9`。
- 运行依赖、原生依赖和 npm 安装脚本：无。
- 许可证：MIT，许可证原文进入随包第三方公告。

发行包不携带上游的演示 GIF 和本地安装器。生成器只保留 `cordis.patch.yml`、`lib`、中英文 README 和 `LICENSE`。

## 官方能力冲突处理

官方 DSH rc.2 已注册图片粘贴和拖拽，并通过 `AttachmentRail` 显示草稿缩略图。上游附件插件也在 document 上监听通用文件拖拽，直接内置会让图片同时进入两条通道。发行生成器应用 `smart-attachment-picker-v4`：删除上游通用拖拽监听，保留单一 `Choose files`，按官方 `imageLimits.mediaTypes` 把图片交给原生图片入口，把其余文件交给工作区附件入口，并通过官方 `commandUi` 注册文件与文件夹命令。混合选择自动拆分；文件夹仍保留目录结构并进入工作区。官方继续负责图片格式、数量、单图大小、总大小、缩略图和发送序列化。

变换同时锁定源文件 SHA-256 `80664dc90259b6312ac86259c5a3ccdacbc3b7674600e37f42404aeccc7834f4` 和输出 SHA-256 `66dfe5824658cf329c09db312be82f26330a2e386fbaac1feb604552d9785e14`。任一端漂移都会阻止生成，不会对未审查新版静默打补丁。文件夹选择、普通文件流式上传、发送引用、设置和清理逻辑保持不变。

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

## 命令菜单更新验证

2026-08-25 的 `smart-attachment-picker-v4` 候选在隔离源码 Profile 中完成安装、启动、停用、官方卸载和卸载后重启，附件 Bundle 冷启动为 752 ms。重新生成的未签名 macOS arm64 目录包随后在真实 Electron 中打开官方 `+` 菜单，确认 `attach-files` 与 `attach-folder` 两项由官方命令菜单呈现；同一次 smoke 继续验证纸夹入口的 PNG 进入官方缩略图、TXT 进入工作区文件卡片，安装后冷启动为 14,362 ms。聚焦合同测试为 10/10 通过，`node --check` 与 `git diff --check` 通过。

这次局部回执的精选源 manifest SHA-256 为 `0c1661b51045fbf1daa126d4c4319831ce22e3b3100763f22dd57aac033289ec`，随包 manifest SHA-256 为 `94529de736c6db8848ce532c1a4e3b1e38dfacdeafce6959c10466db3af12490`。它绑定当前未提交候选，只证明本次局部行为，不替代最终 commit 的完整发行回执。

## 已有 Profile 升级

2026-08-25 的用户实测暴露了旧 Profile 漂移：打包 smoke 使用全新隔离 Profile，能够看到 `attach-files` 与 `attach-folder`；实际 `~/.dsh/profiles/web/package.json` 仍只有官方 2 个 Bundle 和较早的 9 个精选 Bundle，完全没有 `dsh-multimedia-webui-input`。根因是 `ensureDshProfileInitialized()` 发现 manifest 已存在后直接返回，新发行版加入默认清单的 Bundle 只对新用户生效。

修复后，Profile 目录保存 `.dsh-desktop-featured.json`，记录发行版曾经向该 Profile 提供过的精选 Bundle。启动时只用官方 `dsh plugin --profile web add` 补齐从未提供过的新默认 Bundle；依赖仍在但被停用的 Bundle、状态中已记录但后来由用户卸载的 Bundle，以及旧 Profile 插件库中留有 tarball 的历史 Bundle都不会被强行恢复。迁移完成后仍执行官方 `--dump-config`，状态文件使用同目录临时文件原子替换。旧 Profile 首次建立状态时，现有依赖和本地插件库用于识别既有选择；若用户同时手工删除过依赖、状态和本地 tarball，这个历史意图无法可靠推断，该 Bundle 可能只被重新提供一次。

同一次修复已在本机关闭运行实例后，用随包官方 CLI 和固定离线 tarball 将实际 Profile 从 11 个 Bundle 层补到 16 个层，即官方 2 个加发行版 14 个；`dsh-multimedia-webui-input/lib/client.js` SHA-256 为 `66dfe5824658cf329c09db312be82f26330a2e386fbaac1feb604552d9785e14`。重新启动后纸夹入口已在真实会话输入框呈现。Profile 初始化回归覆盖新默认补齐、旧卸载不恢复、再次启动不重复安装和新 Profile 状态写入。

## 不扩大的结论

本报告证明当前源码、Profile 和未签名 macOS arm64 打包 Electron 的统一附件选择成立。此前同一 rc.2 底座已用真实 DeepSeek `deepseek-v4-flash-vision-exp` 验证原生 image block 的模型往返，但本轮尚未把新的自动分流候选重新签名、公证并完成同一构建的真实模型发送。它不代表 Windows 签名安装器已验收，也不把普通文件引用或音频宣称为原生多模态。新 Profile 使用当前默认清单；已有 Profile 只补齐迁移状态中从未提供过的默认 Bundle，并保留停用和卸载选择。
