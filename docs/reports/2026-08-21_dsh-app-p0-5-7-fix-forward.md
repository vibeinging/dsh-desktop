# DSH Desktop P0-5/6/7 fix-forward 发行证据复核

本文记录 2026-08-21 对 DSH Desktop 发行证据链的阶段性整改结果，不是当前版本已经完成发行的声明。

## 基线和范围

本地工作区位于 `dev`，本轮修复从 `7b93a20`（`fix: require native host mode evidence`）开始，主工作区仍有其他窗口的未提交改动，包括 legacy Renderer 和多个评估文件。本轮只修改发行回执/门禁脚本、Windows native Host smoke、回执测试、Windows evidence workflow、构建脚本和本报告，没有 reset、stash、clean 或覆盖 Renderer 脏文件。

`29a113e` 已完成 portable Bundle 的官方生命周期：官方 CLI 安装、官方 Web 启动、Electron 观察、官方 CLI 卸载、重启后官方 Web 基线恢复。`@linxin666/dsh-web-ui-all@0.1.20` 仍未通过兼容验收：官方 CLI 可以写入顶层包，但启动时 Profile 根无法解析它声明的传递 Client 依赖。测试现在从安装后的真实 `package.json` 固定核对 `exports["./client"] === "./lib/client.js"` 和 `dsh.client.platform === "web"`，因此没有把聚合包误写成独立 Client 通过。

此前隔离 clean worktree 在额外应用 `dsh-source-runtime.test.mjs` theme 期望修复后得到 `npm run test:release` 的 149 tests、144 pass、0 fail、5 skipped；这是 clean candidate 的分层证据，不是当前主工作区或本批最终提交的全量通过结论。

## 本批实现

- 新增 `dsh.release.evidence.v2` 公共回执契约。live-model、macOS DMG 公证、macOS 安装器和 native Host 回执都绑定 commit SHA、App 或 DMG SHA-256、精选源 manifest SHA-256、随包 manifest SHA-256、平台、架构、签名身份和起止时间；截图只保存 artifact 内相对引用。
- 四类回执现在有固定 `evidence_level` 和必需 checks；native-host 另按 `window`/`dialogs` 固定完整原生操作集合，不能用三项通用生命周期检查代替。字符串数组、`passed:false`、缺项、重复项、未知项和错误 level 均被拒绝。正式 gate 按 kind 和 native Host mode 调用专用 validator，并验证 CI commit 等于当前 checkout，签名身份只取实际 App 签名结果。
- live-model smoke 使用每次唯一 response marker，必须在官方 `session.history` 中看到带 marker 的非空 DeepSeek assistant 文本和同一 turn 的 `completed`；credential/provider/error、空 assistant 或只有用户消息的历史不能生成回执。
- `release:verify:mac -- --require-evidence` 现在读取并验证四类真实回执，其中 native-host 展开为独立的 window 和 dialogs 两份回执；缺 key、缺回执、错误 commit、错误产物 hash、错误签名身份或缺当前 manifest 都阻断。普通静态检查仍不要求真实密钥和真实回执；DMG 安装器在成功 detach 后才原子写入回执，detach 失败会删除旧回执并失败。
- macOS 发行 workflow 移除可选的 `live_model` 开关，正式 job 明确要求 `DEEPSEEK_API_KEY`，运行真实 live-model smoke，最后执行内容校验门禁，并把回执、截图、DMG/ZIP 和测量报告作为同一 CI artifact 上传。
- Windows 发行 workflow 现在设置 `DSH_RELEASE_COMMIT_SHA=${{ github.sha }}`，生成当前精选测量报告，分别运行 native window 和 file/directory dialogs smoke，并以独立回执目录上传；`release:verify:win -- --require-evidence` 复用同一内容 validator，绑定当前 `DSH Desktop.exe` SHA-256、精选 source/artifact manifest、`win32/x64` 和实际 Authenticode signer。`package:win` 的早期检查只允许等待这些运行时证据，正式 gate 在两个 smoke 之后执行。
- 精选插件测量报告升级为 schema 2，记录精选源 hash、随包 manifest hash 和 commit；发行边界会拒绝报告与当前源、tarball、manifest 或 commit 漂移。

## 可复核结果

| 证据层级 | 命令或检查 | 原始结果 | 结论 |
| --- | --- | --- | --- |
| 源码语法 | 11 个发行/测试 `.mjs` 的 `node --check` | 全部退出 0 | 通过 |
| 单元/回归 | `node --import ./eval/tests/setup.mjs --test --test-concurrency=1 eval/tests/release-safety.test.mjs` | 22 tests，22 pass，0 fail，0 skipped；含 macOS/Windows native Host 两种 mode 的合法/最小/错 mode/缺操作负例、Windows EXE 与 unpacked 目录 hash 边界、四类回执负例、live-model 错误历史和 commit 绑定负例 | 通过 |
| 精选产物 | `node scripts/generate-featured-plugin-artifacts.mjs` | 7 个 tarball 生成 | 通过 |
| Profile 集成测量 | `npm run measure:featured-plugins` | 最终 HEAD 重新生成 7 个 tarball 后，7/7 逐包 cold Web 测量通过；逐包 `cold_web_ms`、tarball 和 SHA-256 以 `.desktop-build/reports/featured-plugin-evaluation.json` 为唯一当前记录，最终原始输出在本次交接中列明 | 通过 |
| 静态发行门禁 | `npm run release:check:mac:static` | macOS static scope：ready=true，13 pass，0 block，0 manual；历史 all-platform scope 的 14/14 不与此数字混用 | 通过 |
| Windows 静态发行门禁 | `npm run release:check:win:static` | Windows static scope：ready=true，13 pass，0 block，0 manual | 通过 |
| 兼容回归 | `dsh-official-web-plugin-compat.test.mjs` | 2 tests，1 pass，0 fail，1 skip；网络兼容测试需显式 `DSH_LIVE_COMPAT_TEST=1` | 未完成 |
| 真实 App/发行证据 | `npm run release:verify:mac -- --require-evidence` | 13 pass，9 block；现有目录包是 adhoc，live-model、公证、安装器、native window 和 native dialogs 五份正式回执均缺失 | 未完成，且按设计阻断 |
| Windows 真实 App/发行证据 | `npm run release:verify:win -- --require-evidence` | 当前 macOS 工作区预期 13 pass，3 block，1 manual；Windows acceptance、两个 native Host 回执和真实 Authenticode 仍缺失，正式 gate 已实际读取两个独立 result path | 未完成，且按设计阻断 |

测量报告同时记录生成时 checkout 的 `git_commit_sha`，发行边界会把它与当前 HEAD 比较；代码或文档提交后必须重新测量。当前源 manifest SHA-256 为 `a6daddac851618bc00794b25ef0d901fc69bef85c342ddc41c4cdac165c8f636`，随包 manifest SHA-256 为 `32e6a0ffc5a5f56f89e6ce7e994b2f5ecc12ca0b69fb4f81d27bc1693b77d09a`；报告逐包 `status` 必须为 `passed`。

## 仍未满足的发行证据

- 本机没有 `DEEPSEEK_API_KEY`，所以没有真实 DeepSeek live-model 回执；普通测试的条件 skip 不构成 live-model 通过。
- 当前正式 gate 使用的本地目录包为 adhoc 且没有完整签名/公证票据；旧 Apple 公证请求和旧产物不覆盖本批最终提交，不能写成当前 HEAD 通过。
- 仍需在最终代码收敛后重新构建、签名、公证 App/DMG，运行 macOS 安装器、native Host window/dialogs 和真实 live-model smoke，验证四类回执（五份回执文件）并上传 CI artifact。
- Windows 仍需在 Windows x64 runner 上完成签名 NSIS、安装器验收、native Host window/dialogs 和两个内容回执；当前本机不能代替 Authenticode signer 或 Windows 实机结果。原生 Intel x64 和真实 DeepSeek live-model 也仍属于外部环境证据；Rosetta、静态源码检查或 loopback smoke 不能替代它们。
