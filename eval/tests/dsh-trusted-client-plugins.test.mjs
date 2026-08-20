import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";

import {
  isReviewedCommunityClient,
  reviewedCommunityClientDependencies,
  reviewedCommunityClientReview,
  reviewedCommunityClientPolicy,
  reviewedTaskBoardDependencies,
} from "../../server/src/engine/dsh_runtime/community_client_review.js";
import {
  featuredPluginManifest,
  featuredPlugins,
  resolveFeaturedPackageDir,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";

const APP_ROOT = resolve(import.meta.dirname, "../..");

test("only audited community Client releases may enter the product Client graph", () => {
  const dependencies = reviewedCommunityClientDependencies();
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: { version: "1.9.0" },
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "dshmarket",
    manifest: { version: "1.9.1" },
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "another-client",
    manifest: { version: "1.9.0" },
  }), false);
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
      version: "0.1.20",
      dependencies: taskBoardDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-7Llft+DOb8aPX8wz+5CVtkK8YoZSVBPQech+0pS7F2+YYlzgp6NWL5mEjtXhIlSjTplNwi5GC3c6BD1DzYm3EA==",
  }), true);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: {
      version: "0.1.20",
      dependencies: taskBoardDependencies,
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
    integrity: "sha512-different-package-bytes",
  }), false);
  assert.equal(isReviewedCommunityClient({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: {
      version: "0.1.20",
      dependencies: { ...taskBoardDependencies, schemastery: "^3.19.0" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
    },
  }), false);
  assert.deepEqual(reviewedCommunityClientReview({
    name: "@linxin666/dsh-client-ui-task-board",
    manifest: { version: "0.1.20", dependencies: taskBoardDependencies, dsh: { bundle: { patch: "./cordis.patch.yml" } } },
    integrity: "sha512-7Llft+DOb8aPX8wz+5CVtkK8YoZSVBPQech+0pS7F2+YYlzgp6NWL5mEjtXhIlSjTplNwi5GC3c6BD1DzYm3EA==",
  }), {
    session: "任务看板使用官方 DSH Session.prompt 启动任务，并读取当前 Workspace 状态",
    capabilities: [
      "读取当前 DSH Session 与 Workspace",
      "写入任务看板数据",
      "按用户操作启动 DSH Session 任务",
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

test("the curated Profile input has one authoritative, user-manageable list", () => {
  const manifest = featuredPluginManifest();
  const plugins = featuredPlugins();
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.profile, "web");
  assert.ok(plugins.length > 0);
  assert.equal(new Set(plugins.map((plugin) => plugin.name)).size, plugins.length);
  assert.deepEqual(plugins, manifest.plugins);
  assert.equal(plugins.every((plugin) => plugin.default && plugin.user_manageable), true);
  assert.equal(plugins.some((plugin) => plugin.name.includes("web-ui-task-board")), false);
});

test("the curated list keeps package names, source paths, and SPDX licenses aligned", () => {
  for (const plugin of featuredPlugins()) {
    const packageJson = JSON.parse(readFileSync(join(resolveFeaturedPackageDir(plugin), "package.json"), "utf8"));
    assert.equal(packageJson.name, plugin.name);
    assert.equal(packageJson.license, plugin.license);
    assert.match(plugin.package_path, /^packages\/dsh-[^/]+$/);
  }
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
      assert.equal(section.includes(`dsh plugin --profile ${manifest.profile} remove ${plugin.name}`), true);
      for (const permission of plugin.permissions) assert.equal(section.includes(permission), true);
    }
  }
});
