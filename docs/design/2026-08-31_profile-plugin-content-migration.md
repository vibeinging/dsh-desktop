# Profile 默认插件内容迁移

日期：2026-08-31

## 问题

DSH Desktop 的默认插件来自发行包内固定 tarball，再复制到用户数据目录下的稳定插件库。兼容性修补可能改变 tarball 内容但不改变插件版本；若本地文件名仍只有包名和版本，pnpm 可能继续复用旧的 `node_modules` 内容，导致 Profile manifest 看似已升级而运行时仍加载旧代码。

## 迁移合同

发行清单继续保存原始 tarball 文件名、版本和 SHA-256。写入用户插件库时，文件名追加完整 SHA-256；内容变化会产生新的 `file:` 依赖路径，官方 `dsh plugin --profile web add -w` 因而必须解析新的包内容。旧 tarball 不自动删除，避免扩大升级过程的删除范围。

启动迁移只更新仍在 Profile 依赖中、且来源位于应用管理的 `plugin-library/tarballs` 目录下的默认插件。用户从 npm、Git 或其他本地路径安装的同名插件不被覆盖；迁移状态中已记录但后来被用户卸载的默认插件也不会恢复。新增默认插件仍沿用“只提供一次”的 `offered` 规则。

`.dsh-desktop-featured.json` 的 schema 2 除 `offered` 外，还记录每个成功安装的应用管理 tarball 的版本和 SHA-256。依赖路径变化或记录的哈希变化都会触发升级；只有官方 add 和 `--dump-config` 都成功后才写入新哈希。命令在改写 manifest 后失败时，状态仍保留旧哈希，下一次启动会重试，不会把半完成迁移当成成功。

## 安全边界

迁移只读取发行清单和本地 tarball，不访问插件网络源，也不改变 Server 或 DSH Web 的监听地址。发行 tarball 和写入后的本地副本都校验 SHA-256；路径必须留在指定产物目录和本地插件库内。Profile 修改继续通过官方 DSH CLI 完成，应用不直接改写 Bundle 顺序或 `node_modules`。

## 验证合同

[Profile 初始化回归](../../eval/tests/dsh-profile-initialization.test.mjs)覆盖同版本内容变化、命令半失败后的重试、用户来源保留、已卸载默认插件不恢复和重复启动幂等。[断网打包 smoke](../../electron/scripts/smoke-packaged-offline.mjs)从最终 Profile 依赖解析内容寻址 tarball，验证路径仍在本地插件库内且 SHA-256 与随包清单一致。发行边界继续校验 `manifest.json` 与 `profile-install.json` 的包名、原始 tarball 和哈希投影。
