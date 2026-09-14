# DSH Desktop 发版规范

> 双平台同发是硬性要求：**macOS 与 Windows 安装包必须随同一个版本发布**。
> Release 资产不满 9 项（mac 5 + win 4），发版就没有完成。
>
> 历史教训：v0.2.2 / v0.2.3 只发了 macOS，Windows 用户无包可装；
> v0.2.1–v0.2.4 的 macOS 包缺 `app-update.yml`，应用内更新一点就失败
> （详见 `docs/reports/2026-09-14_mac-updater-app-update-yml-fix.md`，本地）。
> 每次发版请走完本文档全部步骤，尤其是第 6 步。

以下用 `vX.Y.Z` 指代要发布的版本号。

## 0. 前置条件（每次发版前确认一次）

- [ ] `gh` CLI 已登录，且有 repo 写权限
- [ ] `.env.release.local` 存在且 `APPLE_KEYCHAIN_PROFILE` 的公证 profile 可用：
      `source .env.release.local && xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" | head -5`
- [ ] `git status` 干净，当前在 `dev` 且与 `origin/dev` 同步

## 1. 版本号

三处 `package.json` 的 `version` 同步改为 `X.Y.Z`（root / electron / server），再同步 lock：

```bash
npm install --package-lock-only --no-audit --no-fund
(cd electron && npm install --package-lock-only --no-audit --no-fund)
(cd server  && npm install --package-lock-only --no-audit --no-fund)
```

## 2. 测试

```bash
npm run test:release        # 必须 0 fail（允许既有环境性 skip）
```

## 3. 提交、打 tag、推送

```bash
git add <版本文件> && git commit -m "chore(release): bump version to X.Y.Z"
git tag vX.Y.Z
git push origin dev vX.Y.Z   # tag 必须先于 Windows workflow 推上去
```

## 4. macOS 构建 + 公证（本机执行）

```bash
source .env.release.local
npm run package:mac
```

已知坑：

- **首次跑被 `featured_plugin_measurement` block**：测量报告钉着上一个 commit 的 SHA。
  先 `npm run measure:featured-plugins` 重新生成，再重跑 `package:mac`。
- **`check:update-artifacts` 报 `release/mac` 缺 app-update.yml**：那是旧版本/其它架构的
  残留目录。门禁只校验版本与本次一致的目录，正常不会触发；若看到说明残留目录的
  Info.plist 版本异常，删掉 `release/mac` 重跑即可。
- 命令用管道接 `| tail` 会吞掉真实退出码，判断成败看输出里的
  `[update-artifacts] macos PASS` 与 `[macos-notary] PASS`。

## 5. 创建 Release + macOS 产物（5 项）

```bash
gh release create vX.Y.Z --title "DSH Desktop vX.Y.Z（……）" --notes-file notes.md \
  release/dsh-desktop-X.Y.Z-mac-arm64.dmg \
  release/dsh-desktop-X.Y.Z-mac-arm64.dmg.blockmap \
  release/dsh-desktop-X.Y.Z-mac-arm64.zip \
  release/dsh-desktop-X.Y.Z-mac-arm64.zip.blockmap \
  release/latest-mac.yml
```

Release Notes 必写：本版本变更 + 存量用户是否需要手动升级一次（如涉及更新器变更）。

## 6. Windows（⚠️ 最容易遗忘的一步）

Windows 安装包由 GitHub Actions 手动工作流构建，**不会自动跟随 tag**。流程：

```bash
# 触发（必须用 tag ref，工作流会校验 tag 与版本一致）
gh workflow run windows-release.yml --ref vX.Y.Z
sleep 8 && gh run list --workflow=windows-release.yml --limit 1

# 等待完成（约 20–40 分钟），SUCCESS 后下载产物
gh run watch <run-id>
rm -rf /tmp/dsh-win && mkdir -p /tmp/dsh-win
gh run download <run-id> -n dsh-desktop-win-x64-unsigned -D /tmp/dsh-win

# 附加 4 项到 Release
gh release upload vX.Y.Z \
  /tmp/dsh-win/dsh-desktop-X.Y.Z-win-x64.exe \
  /tmp/dsh-win/dsh-desktop-X.Y.Z-win-x64.exe.blockmap \
  /tmp/dsh-win/latest.yml \
  /tmp/dsh-win/windows-x64-acceptance.json
```

> 若工作流失败：Windows runner 上偶发「等待官方 Web … 超时」类验收抖动，直接重跑一次；
> 连续失败才需要排查。**没有 Windows 产物就不要对外宣传新版**。

## 7. 发版验收清单（全部勾完才算发版完成）

```bash
gh release view vX.Y.Z --json assets -q '.assets[].name'
```

- [ ] Release 资产**恰好 9 项**：mac 的 dmg/dmg.blockmap/zip/zip.blockmap/latest-mac.yml
      + win 的 exe/exe.blockmap/latest.yml/windows-x64-acceptance.json
- [ ] EXE 体积正常（> 300MB），`windows-x64-acceptance.json` 在（实机验收过的凭证）
- [ ] 托管更新服务已切到新版本（TTL 缓存，发布后最多等几分钟）：
      - `https://dshdesktopstation.com/api/desktop/releases/check?current_version=<上一版>&platform=darwin&arch=arm64&channel=stable&locale=zh-CN` → `latest.version == X.Y.Z`
      - `.../api/desktop/updates/stable/darwin/arm64/latest-mac.yml` → `version: X.Y.Z`
      - `.../api/desktop/updates/stable/win32/x64/latest.yml` → `version: X.Y.Z`
- [ ] 官网版本文案同步（`dsh-website` 仓库，zh+en 的首页/下载页/关于页 +
      JSON-LD `softwareVersion`；注意**保留** FAQ 里「 vX-1 及更早」的已知问题表述）
      并推送 `main` 上线
- [ ] （mac 更新器相关变更时）从旧版本实测一次应用内更新链路

## 8. 可选改进（未实施）

- `windows-release.yml` 增加 `push: tags: ['v*']` 自动触发 + 自动上传 Release，
  从机制上消灭"忘记 Windows"。当前刻意手动是为了控制 Windows runner 用量；
  若发版频次升高建议开启。
- 增加 `verify-release-assets` 脚本（gh 检查 9 项资产），挂在发版文档执行。
