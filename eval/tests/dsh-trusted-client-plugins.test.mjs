import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";

import {
  isReviewedCommunityClient,
  reviewedDshMarketDependencies,
  reviewedCommunityClientDependencies,
  reviewedCommunityClientReview,
  reviewedCommunityClientPolicy,
  reviewedMultimediaInputDependencies,
  reviewedTaskBoardDependencies,
} from "../../server/src/engine/dsh_runtime/community_client_review.js";
import {
  featuredPluginManifest,
  featuredPlugins,
  resolveFeaturedPackageDir,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";
import {
  validateFeaturedPackageComposition,
  validateFeaturedPackageContract,
  validateFeaturedPackageLock,
  resolveFeaturedOfflineDependencies,
  resolveFeaturedLicenseDependencies,
  projectFeaturedRegistryManifest,
  validateFeaturedRegistryReleaseDependencies,
  transformFeaturedRegistryClient,
} from "../../scripts/generate-featured-plugin-artifacts.mjs";

const APP_ROOT = resolve(import.meta.dirname, "../..");

test("only audited community Client releases may enter the product Client graph", () => {
  const dependencies = reviewedCommunityClientDependencies();
  const marketDependencies = reviewedDshMarketDependencies();
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: {
      version: "1.17.1",
      dependencies: marketDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==",
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: {
      version: "1.17.2",
      dependencies: marketDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "another-client",
    manifest: { version: "1.17.1" },
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "dshmarket",
    manifest: {
      version: "1.17.1",
      dependencies: marketDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==",
  }), {
    session: "插件市场不读取 Session 内容；所有 Profile 变更由用户在市场界面确认",
    capabilities: [
      "读取和修改当前 DSH Profile",
      "通过受控 pnpm 安装、更新和卸载插件",
      "访问社区目录、npm、GitHub 和用户选择的备份服务",
    ],
  });

  const multimediaInputDependencies = reviewedMultimediaInputDependencies();
  assert.deepEqual(multimediaInputDependencies, {});
  assert.equal(isReviewedCommunityClient({
    name: "dsh-multimedia-webui-input",
    manifest: {
      version: "0.1.0",
      dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
    },
    integrity: "sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==",
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "dsh-multimedia-webui-input",
    manifest: {
      version: "0.1.0",
      dependencies: { unexpected: "1.0.0" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==",
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "dsh-multimedia-webui-input",
    manifest: { version: "0.1.0", dsh: { bundle: { patch: "./cordis.patch.yml" } } },
    integrity: "sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==",
  }), {
    session: "附件只在用户发送时复制到当前 Session 工作区，发送失败保留草稿与待发送附件",
    capabilities: [
      "读取用户主动选择的文件和文件夹",
      "向当前 Session 工作区的 .dsh/tmp/attachments 写入附件",
      "按用户二次确认清理带插件所有权标记的附件目录",
    ],
  });
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==",
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies: { ...dependencies, "@linxin666/dsh-ssh": "0.1.21" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies,
      dsh: { bundle: { patch: "./other.patch.yml" } },
    },
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "@linxin666/dsh-web-ui-all",
    manifest: {
      version: "0.1.20",
      dependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==",
  }), {
    session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
    capabilities: [
      "读取本地仓库与图片",
      "启动 Git、SSH 与电源保持进程",
      "访问 SSH、远程 Web 和模型服务网络",
    ],
  });

  const taskBoardDependencies = reviewedTaskBoardDependencies();
  assert.deepEqual(taskBoardDependencies, { schemastery: "^3.18.0" });
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: {
      version: "0.2.7",
      dependencies: taskBoardDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-9Gnd12bcCtUTf4UVI0h5Bzm/fPwn+PEQqqi9+dt80wden0RwivpK7hzQ8VGRjImX5dGESAYFvkStNObEpC3bLA==",
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: {
      version: "0.2.7",
      dependencies: taskBoardDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-different-package-bytes",
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: {
      version: "0.2.7",
      dependencies: { ...taskBoardDependencies, schemastery: "^3.19.0" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: { version: "0.2.7", dependencies: taskBoardDependencies, dsh: { bundle: { patch: "./cordis.patch.yml" } } },
    integrity: "sha512-9Gnd12bcCtUTf4UVI0h5Bzm/fPwn+PEQqqi9+dt80wden0RwivpK7hzQ8VGRjImX5dGESAYFvkStNObEpC3bLA==",
  }), {
    session: "任务看板创建独立 DSH Session 执行任务，并读取 Workspace、Session 状态和完成历史",
    capabilities: [
      "读取当前 DSH Session 与 Workspace",
      "在 DSH_HOME 写入任务账本和执行记录",
      "按用户操作或 Host cron 启动 DSH Session 任务",
      "可选启动固定的系统防休眠 helper",
    ],
  });

  const chatRecovery = reviewedCommunityClientPolicy("@linxin666/dsh-chat-recovery");
  assert.equal(chatRecovery.version, "0.2.5");
  assert.equal(chatRecovery.requiredDshRuntime, "0.1.0-rc.8");
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-chat-recovery",
    manifest: {
      version: "0.2.5",
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
    },
    integrity: "sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==",
  }), true);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "@linxin666/dsh-chat-recovery",
    manifest: {
      version: "0.2.5",
      dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
    },
    integrity: "sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==",
  }), {
    session: "编辑和重试通过官方 Session fork 契约创建子 Session，原始历史保持不变",
    capabilities: [
      "读取当前会话的已完成消息",
      "按用户操作 fork 并重新提交文本消息",
      "在浏览器端监督可恢复错误的重试",
    ],
  });
});

test("the curated Profile input has one authoritative list with explicit manageability", () => {
  const manifest = featuredPluginManifest();
  const plugins = featuredPlugins();
  const rootPackage = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  const electronPackage = JSON.parse(readFileSync(join(APP_ROOT, "electron/package.json"), "utf8"));
  const measurementSource = readFileSync(join(APP_ROOT, "scripts/measure-featured-plugin-evidence.mjs"), "utf8");
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.profile, "web");
  assert.match(rootPackage.scripts["measure:featured-plugins"], /measure-featured-plugin-evidence/);
  assert.match(measurementSource, /\[DSH_CLI, '--profile', 'web', '--port', '0', '--no-open'\]/);
  assert.match(rootPackage.scripts["smoke:featured-plugins:packaged"], /smoke:packaged-featured-plugins/);
  assert.match(electronPackage.scripts["smoke:packaged-featured-plugins"], /smoke-packaged-featured-plugins/);
  assert.ok(plugins.length > 0);
  assert.equal(new Set(plugins.map((plugin) => plugin.name)).size, plugins.length);
  assert.deepEqual(plugins, manifest.plugins);
  assert.equal(plugins.every((plugin) => plugin.default && typeof plugin.user_manageable === "boolean"), true);
  assert.equal(plugins.find((plugin) => plugin.name === "@vibeinging/dsh-work-product-host-ipc")?.user_manageable, false);
  assert.equal(plugins.find((plugin) => plugin.name === "@vibeinging/dsh-desktop-profile-host")?.user_manageable, false);
  assert.equal(plugins.filter((plugin) => plugin.user_manageable).length, plugins.length - 2);
  assert.equal(plugins.some((plugin) => plugin.name === "@linxin666/dsh-client-ui-task-board"), true);
  assert.equal(plugins.some((plugin) => plugin.name === "dsh-multimedia-webui-input"), true);
  assert.equal(plugins.some((plugin) => plugin.name === "dsh-better-sidebar"), true);
  for (const plugin of plugins) {
    assert.equal(new Set(["workspace-package", "locked-registry-package"]).has(plugin.evidence.source_kind), true);
    assert.equal(plugin.evidence.release_source, "fixed-tarball");
    assert.equal(plugin.evidence.profile_install, "official-dsh-plugin-cli");
    assert.equal(plugin.evidence.profile_uninstall, "official-dsh-plugin-cli");
    assert.equal(Object.isFrozen(plugin.evidence), true);
    assert.equal(plugin.evidence.composition.plugin_id, plugin.evidence.patch_id);
    for (const field of ["requires", "provides", "routes", "slots", "conflicts"]) {
      assert.equal(Array.isArray(plugin.evidence.composition[field]), true);
      assert.equal(Object.isFrozen(plugin.evidence.composition[field]), true);
    }
    for (const layer of ["unit", "profile", "electron"]) {
      assert.ok(plugin.evidence.regression[layer].length > 0, `${plugin.name} 缺少 ${layer} 回归证据`);
    }
  }
});

test("the curated list keeps package names, source paths, and SPDX licenses aligned", () => {
  const serverLockfile = JSON.parse(readFileSync(join(APP_ROOT, "server/package-lock.json"), "utf8"));
  for (const plugin of featuredPlugins()) {
    const packageDir = resolveFeaturedPackageDir(plugin);
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    assert.doesNotThrow(() => validateFeaturedPackageContract(plugin, packageJson));
    assert.doesNotThrow(() => validateFeaturedPackageLock(plugin, serverLockfile));
    const source = readFileSync(join(packageDir, plugin.evidence.source_entry || plugin.evidence.entry), "utf8");
    const patch = readFileSync(join(packageDir, "cordis.patch.yml"), "utf8");
    assert.doesNotThrow(() => validateFeaturedPackageComposition(plugin, source, patch));
    const wrongSource = source.match(/^export const inject = .*$/m)
      ? source.replace(/^export const inject = .*$/m, 'export const inject = ["wrongService"];')
      : source.replace(/\bctx\.inject\(\[[^\n]*\]/m, 'ctx.inject(["wrongService"]');
    assert.throws(
      () => validateFeaturedPackageComposition(plugin, wrongSource, patch),
      /composition\.requires/,
    );
    if (plugin.evidence.source_kind === "workspace-package") {
      assert.match(plugin.package_path, /^packages\/dsh-[^/]+$/);
    } else {
      assert.equal(plugin.package_path, `server/node_modules/${plugin.name}`);
    }
  }
});

test("the composition validator accepts a browser-only Bundle without fake Host dependencies", () => {
  const plugin = featuredPlugins().find(({ name }) => name === "@vibeinging/dsh-desktop-chrome");
  const packageDir = resolveFeaturedPackageDir(plugin);
  const source = readFileSync(join(packageDir, plugin.evidence.entry), "utf8");
  const patch = readFileSync(join(packageDir, "cordis.patch.yml"), "utf8");
  assert.deepEqual(plugin.evidence.composition.requires, []);
  assert.doesNotThrow(() => validateFeaturedPackageComposition(plugin, source, patch));
});

test("the curated registry package rejects lock, license, and dependency drift", () => {
  const plugin = featuredPlugins().find(({ name }) => name === "@linxin666/dsh-client-ui-task-board");
  const packageJson = JSON.parse(readFileSync(join(resolveFeaturedPackageDir(plugin), "package.json"), "utf8"));
  const serverLockfile = JSON.parse(readFileSync(join(APP_ROOT, "server/package-lock.json"), "utf8"));
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    license: "BSD-3-Clause",
  }), /声明许可证漂移/);
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    dependencies: { schemastery: "^3.19.0" },
  }), /依赖闭包漂移/);
  assert.throws(() => validateFeaturedPackageLock(plugin, {
    ...serverLockfile,
    packages: {
      ...serverLockfile.packages,
      "node_modules/schemastery": {
        ...serverLockfile.packages["node_modules/schemastery"],
        integrity: "sha512-drift",
      },
    },
  }), /锁文件漂移/);
});

test("the bundled plugin market is pinned to its audited package and nested dependency closure", () => {
  const plugin = featuredPlugins().find(({ name }) => name === "dshmarket");
  const packageJson = JSON.parse(readFileSync(join(resolveFeaturedPackageDir(plugin), "package.json"), "utf8"));
  const serverLockfile = JSON.parse(readFileSync(join(APP_ROOT, "server/package-lock.json"), "utf8"));
  assert.doesNotThrow(() => validateFeaturedPackageContract(plugin, packageJson));
  assert.doesNotThrow(() => validateFeaturedPackageLock(plugin, serverLockfile));
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    dependencies: { ...packageJson.dependencies, undici: "^8.0.0" },
  }), /依赖闭包漂移/);
  assert.throws(() => validateFeaturedPackageLock(plugin, {
    ...serverLockfile,
    packages: {
      ...serverLockfile.packages,
      "node_modules/js-yaml/node_modules/argparse": {
        ...serverLockfile.packages["node_modules/js-yaml/node_modules/argparse"],
        integrity: "sha512-drift",
      },
    },
  }), /锁文件漂移/);
});

test("the bundled multimedia input is pinned without inventing a dependency closure", () => {
  const plugin = featuredPlugins().find(({ name }) => name === "dsh-multimedia-webui-input");
  const packageJson = JSON.parse(readFileSync(join(resolveFeaturedPackageDir(plugin), "package.json"), "utf8"));
  const serverLockfile = JSON.parse(readFileSync(join(APP_ROOT, "server/package-lock.json"), "utf8"));
  assert.deepEqual(plugin.evidence.package_dependencies, {});
  assert.deepEqual(plugin.evidence.offline_dependencies, []);
  assert.deepEqual(plugin.evidence.release_files, ["cordis.patch.yml", "lib", "README.md", "README.zh.md", "LICENSE"]);
  assert.equal(plugin.evidence.release_transform.id, "native-image-picker-v2");
  assert.doesNotThrow(() => validateFeaturedPackageContract(plugin, packageJson));
  assert.doesNotThrow(() => validateFeaturedPackageLock(plugin, serverLockfile));
  const clientSource = readFileSync(join(resolveFeaturedPackageDir(plugin), plugin.evidence.release_transform.path), "utf8");
  const releaseClient = transformFeaturedRegistryClient(plugin, clientSource);
  const packagedSmoke = readFileSync(join(APP_ROOT, "electron/scripts/smoke-packaged-featured-plugins.mjs"), "utf8");
  const electronMain = readFileSync(join(APP_ROOT, "electron/main.js"), "utf8");
  assert.match(clientSource, /document\.addEventListener\('drop', drop\)/);
  assert.doesNotMatch(releaseClient, /document\.addEventListener\('drop', drop\)/);
  assert.match(releaseClient, /props\.useProjection\('imageLimits'\)/);
  assert.match(releaseClient, /new DragEvent\('drop'/);
  assert.match(releaseClient, /dshNativeImagePicker/);
  assert.match(releaseClient, /Choose images/);
  assert.match(releaseClient, /Attach files or a folder/);
  assert.match(packagedSmoke, /DSH_SMOKE_NATIVE_IMAGE_PICKER = '1'/);
  assert.match(electronMain, /smokeNativeImagePicker/);
  assert.match(electronMain, /dsh-native-image-smoke\.png/);
  assert.throws(() => transformFeaturedRegistryClient(plugin, `${clientSource}\n// drift`), /源文件漂移/);
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    dependencies: { unexpected: "1.0.0" },
  }), /依赖闭包漂移/);
  assert.throws(() => validateFeaturedPackageContract({
    ...plugin,
    evidence: { ...plugin.evidence, release_files: ["../outside"] },
  }, packageJson), /release_files 无效/);
  assert.throws(() => validateFeaturedPackageContract({
    ...plugin,
    evidence: { ...plugin.evidence, release_transform: { ...plugin.evidence.release_transform, path: "../outside" } },
  }, packageJson), /release_transform 无效/);
  assert.throws(() => validateFeaturedPackageLock(plugin, {
    ...serverLockfile,
    packages: {
      ...serverLockfile.packages,
      "node_modules/dsh-multimedia-webui-input": {
        ...serverLockfile.packages["node_modules/dsh-multimedia-webui-input"],
        integrity: "sha512-drift",
      },
    },
  }), /锁文件漂移/);
});

test("Better Sidebar is pinned with its complete native and editor dependency closure", () => {
  const plugin = featuredPlugins().find(({ name }) => name === "dsh-better-sidebar");
  const packageDir = resolveFeaturedPackageDir(plugin);
  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const serverPackage = JSON.parse(readFileSync(join(APP_ROOT, "server/package.json"), "utf8"));
  const serverLockfile = JSON.parse(readFileSync(join(APP_ROOT, "server/package-lock.json"), "utf8"));
  const dependencies = resolveFeaturedOfflineDependencies(plugin, { appRoot: APP_ROOT, lockfile: serverLockfile });
  const licenseDependencies = resolveFeaturedLicenseDependencies(plugin, { appRoot: APP_ROOT, lockfile: serverLockfile });
  assert.equal(serverPackage.dependencies[plugin.name], undefined);
  assert.equal(serverPackage.devDependencies[plugin.name], "0.16.0");
  assert.equal(serverLockfile.packages[""]?.devDependencies?.[plugin.name], "0.16.0");
  assert.equal(serverLockfile.packages[`node_modules/${plugin.name}`]?.dev, true);
  assert.equal(plugin.evidence.offline_dependency_resolution, "package-lock-closure");
  assert.deepEqual(plugin.evidence.release_dependencies, {
    "node-pty": "^1.1.0",
    schemastery: "^3.18.0",
    ws: "^8.18.0",
  });
  assert.equal(dependencies.length, 6);
  assert.ok(licenseDependencies.length > 100);
  assert.equal(new Set(dependencies.map(({ install_path }) => install_path)).size, dependencies.length);
  assert.deepEqual(
    dependencies.filter(({ name }) => name === "node-pty").map(({ version, install_path, lock_path }) => ({ version, install_path, lock_path })),
    [{
      version: "1.1.0",
      install_path: "node_modules/node-pty",
      lock_path: "node_modules/dsh-better-sidebar/node_modules/node-pty",
    }],
  );
  for (const platform of ["darwin-arm64", "darwin-x64", "win32-arm64", "win32-x64"]) {
    assert.equal(existsSync(join(packageDir, "node_modules/node-pty/prebuilds", platform)), true);
  }
  assert.doesNotThrow(() => validateFeaturedPackageContract(plugin, packageJson));
  const releaseManifest = projectFeaturedRegistryManifest(plugin, packageJson);
  assert.deepEqual(releaseManifest.dependencies, plugin.evidence.release_dependencies);
  assert.equal(releaseManifest.peerDependencies["@deepseek-ai/dsh-session"], "0.1.1-rc.2");
  assert.equal(releaseManifest.peerDependencies["@deepseek-ai/cordis"], "^4.0.1");
  assert.equal(releaseManifest.peerDependencies.cordis, undefined);
  assert.equal(releaseManifest.peerDependencies["@huanlin/dsh-plugin-better-locale"], "^0.1.0");
  assert.deepEqual(releaseManifest.peerDependenciesMeta["@huanlin/dsh-plugin-better-locale"], { optional: true });
  assert.equal(packageJson.peerDependencies["@deepseek-ai/dsh-session"], "^0.1.0-rc.8");
  assert.equal(packageJson.peerDependencies.cordis, undefined);
  const hostSource = readFileSync(join(packageDir, plugin.evidence.entry), "utf8");
  assert.doesNotThrow(() => validateFeaturedRegistryReleaseDependencies(plugin, hostSource));
  assert.throws(
    () => validateFeaturedRegistryReleaseDependencies(plugin, hostSource.replace('from "ws"', 'from "removed-ws"')),
    /发行依赖与 Host 入口不一致/,
  );
  assert.doesNotThrow(() => validateFeaturedPackageLock(plugin, serverLockfile, {
    appRoot: APP_ROOT,
    offlineDependencies: dependencies,
  }));
  assert.throws(() => validateFeaturedPackageLock(plugin, {
    ...serverLockfile,
    packages: {
      ...serverLockfile.packages,
      "node_modules/dsh-better-sidebar/node_modules/node-pty": {
        ...serverLockfile.packages["node_modules/dsh-better-sidebar/node_modules/node-pty"],
        integrity: "sha512-drift",
      },
    },
  }, { appRoot: APP_ROOT, offlineDependencies: dependencies }), /锁文件漂移/);
});

test("the artifact generator rejects curated portability and permission drift", () => {
  const plugin = featuredPlugins()[0];
  const packageJson = JSON.parse(readFileSync(join(resolveFeaturedPackageDir(plugin), "package.json"), "utf8"));
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    dshWork: {
      ...packageJson.dshWork,
      portability: { ...packageJson.dshWork.portability, level: "portable" },
    },
  }), /portability/);
  assert.throws(() => validateFeaturedPackageContract(plugin, {
    ...packageJson,
    dshWork: {
      ...packageJson.dshWork,
      portability: { ...packageJson.dshWork.portability, hostRequirements: [] },
    },
  }), /Host 权限/);
});

test("public README tables are generated from the curated list", () => {
  const manifest = featuredPluginManifest();
  for (const file of ["README.md", "README.en.md"]) {
    const text = readFileSync(join(APP_ROOT, file), "utf8");
    const section = text.match(/<!-- featured-plugins:start -->[\s\S]*?<!-- featured-plugins:end -->/)?.[0];
    assert.ok(section, `${file} 缺少精选插件生成区块`);
    const rows = section.split("\n").filter((line) => line.startsWith("| `"));
    assert.equal(rows.length, manifest.plugins.length, `${file} 精选插件表行数不一致`);
    for (const plugin of manifest.plugins) {
      assert.equal(section.includes(plugin.name), true, `${file} 缺少 ${plugin.name}`);
      assert.equal(
        plugin.user_manageable
          ? section.includes(`dsh plugin --profile ${manifest.profile} remove ${plugin.name}`)
          : section.includes("桌面基础服务，不提供卸载") || section.includes("desktop foundation; uninstall is not offered"),
        true,
      );
      const expectedPermissions = file === "README.en.md" && plugin.permissions_en
        ? plugin.permissions_en
        : plugin.permissions;
      for (const permission of expectedPermissions) assert.equal(section.includes(permission), true);
    }
  }
});
