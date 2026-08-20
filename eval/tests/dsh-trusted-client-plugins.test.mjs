import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isReviewedCommunityClient,
  reviewedCommunityClientDependencies,
  reviewedCommunityClientReview,
} from "../../server/src/engine/dsh_runtime/community_client_review.js";
import {
  featuredPluginManifest,
  featuredPlugins,
} from "../../server/src/engine/dsh_runtime/featured_plugins.js";

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
  }), {
    session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
    capabilities: [
      "读取本地仓库与图片",
      "启动 Git、SSH 与电源保持进程",
      "访问 SSH、远程 Web 和模型服务网络",
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
});
