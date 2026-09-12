import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { executeWorktreeAction } from "../../packages/dsh-worktree/src/index.js";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  resolveGitWorktreeRoot,
  resolveMainWorktreeRoot,
} from "../../packages/dsh-worktree/src/git.js";

const execFileAsync = promisify(execFile);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_DIR = join(APP_ROOT, "packages", "dsh-worktree");

async function git(cwd, args) {
  return execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}

async function fixtureRepository() {
  const root = await mkdtemp(join(tmpdir(), "dsh-worktree-"));
  await git(root, ["init"]);
  await git(root, ["config", "user.name", "DSH Worktree Test"]);
  await git(root, ["config", "user.email", "worktree-test@example.invalid"]);
  await writeFile(join(root, "README.md"), "# Worktree fixture\n");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "fixture"]);
  return realpath(root);
}

test("the Worktree Bundle is an additive official Web plugin", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
  assert.equal(manifest.name, "@vibeinging/dsh-client-ui-worktree");
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal(manifest.dshWork.portability.level, "portable");
  assert.deepEqual(manifest.dshWork.portability.surfaces, ["official-web", "dsh-desktop"]);
  assert.equal(existsSync(join(PACKAGE_DIR, manifest.exports["./client"])), true);
  const patch = readFileSync(join(PACKAGE_DIR, "cordis.patch.yml"), "utf8");
  const host = readFileSync(join(PACKAGE_DIR, "src", "index.js"), "utf8");
  const client = readFileSync(join(PACKAGE_DIR, "src", "client", "index.js"), "utf8");
  const packagedSmoke = readFileSync(join(APP_ROOT, "electron", "scripts", "smoke-packaged-featured-plugins.mjs"), "utf8");
  const electronMain = readFileSync(join(APP_ROOT, "electron", "main.js"), "utf8");
  assert.match(patch, /- insert:/);
  assert.doesNotMatch(patch, /disabled:\s*true/);
  assert.match(client, /ctx\.slots\.inject\("conversation\.view"/);
  assert.match(client, /ctx\.slots\.inject\("sidebar\.footer\.action"/);
  assert.match(client, /ctx\.slots\.inject\("shell\.overlay"/);
  assert.match(client, /ctx\.workspaces\.create/);
  assert.match(client, /\.dsh-worktree-overlay \{[\s\S]*position: absolute/);
  assert.doesNotMatch(client, /\.dsh-worktree-overlay \{[\s\S]*?position: fixed/);
  assert.match(client, /width: min\(920px, calc\(100% - 24px\)\)/);
  assert.match(client, /event\.key !== "Escape"/);
  assert.match(client, /previous\.replaceWith\(style\)/);
  assert.match(client, /function WorktreeSidebarAction\(\{ wide \}\) \{\s+useEffect\(installStyle, \[\]\);/);
  assert.doesNotMatch(client, /ctx\.effect\(\(\) => installStyle\(\)/);
  assert.match(packagedSmoke, /dsh-worktree-sidebar-action/);
  assert.match(packagedSmoke, /dsh-worktree-view/);
  assert.match(packagedSmoke, /feature\/worktree-preview/);
  assert.match(electronMain, /DSH_SMOKE_WORKSPACE_PATH/);
  assert.match(electronMain, /method: 'workspace\.create'/);
  assert.doesNotMatch(`${host}\n${client}`, /electronAPI|ipcRenderer|productHost|renderer\/src|querySelector/);
});

test("managed Worktrees resolve one main checkout from main and linked paths", async () => {
  const root = await fixtureRepository();
  try {
    await mkdir(join(root, "src"));
    assert.equal(await resolveGitWorktreeRoot(join(root, "src")), root);
    const created = await createWorktree(root, { branchName: "feature/worktree-test", id: "fixture" });
    assert.equal(await resolveMainWorktreeRoot(created.path), root);
    assert.equal((await listWorktrees(root))[0]?.path, created.path);
    assert.equal((await listWorktrees(root))[0]?.branch, "feature/worktree-test");
    const dirtyPath = join(created.path, "uncommitted.txt");
    await writeFile(dirtyPath, "keep this work\n");
    await assert.rejects(
      removeWorktree(root, created.path),
      (error) => error?.code === "GIT_OPERATION_FAILED",
    );
    await rm(dirtyPath);
    assert.deepEqual(await removeWorktree(root, created.path), {
      removed: true,
      missing: false,
      branch: "feature/worktree-test",
    });
    assert.deepEqual(await listWorktrees(root), []);
    await assert.doesNotReject(git(root, ["show-ref", "--verify", "refs/heads/feature/worktree-test"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host actions trust the Session cwd and reject deleting its active Worktree", async () => {
  const root = await fixtureRepository();
  try {
    const mainContext = { sessions: { get: (id) => id === "main-session" ? { header: { cwd: root } } : undefined } };
    const created = await executeWorktreeAction(mainContext, {
      action: "create",
      sessionId: "main-session",
      branchName: "feature/session-bound",
    });
    const linkedContext = { sessions: { get: () => ({ header: { cwd: created.item.path } }) } };
    const listed = await executeWorktreeAction(linkedContext, { action: "list", sessionId: "linked-session" });
    assert.equal(listed.main.path, root);
    assert.equal(listed.currentPath, created.item.path);
    assert.equal(listed.items[0]?.active, true);
    await assert.rejects(
      executeWorktreeAction(linkedContext, { action: "remove", sessionId: "linked-session", path: created.item.path }),
      (error) => error?.code === "WORKTREE_IN_USE",
    );
    await assert.rejects(
      executeWorktreeAction(mainContext, { action: "remove", sessionId: "main-session", path: join(root, "outside") }),
      (error) => error?.code === "WORKTREE_PATH_OUT_OF_SCOPE",
    );
    await removeWorktree(root, created.item.path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the generated browser bundle registers three official UI slots through lifecycle seams", () => {
  let descriptor;
  let styleElement;
  const document = {
    createElement: () => ({
      remove() {
        if (styleElement === this) styleElement = undefined;
      },
      replaceWith(next) {
        styleElement = next;
      },
    }),
    getElementById: () => styleElement,
    head: {
      append(style) {
        styleElement = style;
      },
    },
  };
  runInNewContext(readFileSync(join(PACKAGE_DIR, "lib", "client.js"), "utf8"), {
    document,
    window: { __ModuleLoader__: { load: (value) => { descriptor = value; } } },
  });
  assert.equal(descriptor.id, "@vibeinging/dsh-client-ui-worktree");
  const effectCleanups = [];
  const React = {
    createElement() {},
    useCallback() {},
    useEffect(install) {
      effectCleanups.push(install());
    },
    useMemo() {},
    useState() {},
    useSyncExternalStore() {},
  };
  const plugin = descriptor.factory((id) => {
    assert.equal(id, "react");
    return React;
  });
  const registrations = [];
  const ctx = {
    effect: () => assert.fail("Worktree 样式不能挂在插件级 effect 上"),
    slots: {
      inject: (name, install) => {
        assert.ok(["conversation.view", "sidebar.footer.action", "shell.overlay"].includes(name));
        return install();
      },
      register: (entry, component) => {
        registrations.push({ entry, component });
        return () => {};
      },
    },
    workspaces: {
      create: async () => {},
      delete: async () => {},
      startSession: () => {},
    },
  };
  plugin.apply(ctx);
  assert.deepEqual(Array.from(plugin.inject), ["slots", "workspaces"]);
  assert.deepEqual(registrations.map(({ entry }) => entry.name), [
    "conversation.view",
    "sidebar.footer.action",
    "shell.overlay",
  ]);
  assert.ok(registrations.every(({ entry, component }) => entry.id === "worktree" && typeof component === "function"));
  assert.equal(registrations[0].entry.order, 20);
  registrations[1].component({ wide: true });
  assert.equal(styleElement?.id, "dsh-worktree-client-style");
  assert.match(styleElement?.textContent || "", /\.dsh-worktree-sidebar-action/);
  effectCleanups[0]();
  assert.equal(styleElement, undefined);
});
