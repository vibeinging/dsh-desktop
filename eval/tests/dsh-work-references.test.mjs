import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { listWorkspaceFileReferences } from "../../packages/dsh-work-references/src/index.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_DIR = join(APP_ROOT, "packages", "dsh-work-references");

test("the references Bundle uses official additive seams and no private Electron bridge", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
  assert.equal(manifest.name, "@vibeinging/dsh-work-references");
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal(manifest.dshWork.portability.level, "portable");
  assert.equal(existsSync(join(PACKAGE_DIR, manifest.exports["./client"])), true);
  const patch = readFileSync(join(PACKAGE_DIR, "cordis.patch.yml"), "utf8");
  assert.match(patch, /- insert:/);
  assert.doesNotMatch(patch, /disabled:\s*true/);
  for (const path of ["src/index.js", "src/client/index.js", "lib/client.js"]) {
    const source = readFileSync(join(PACKAGE_DIR, path), "utf8");
    assert.doesNotMatch(source, /electronAPI|ipcRenderer|nodeIntegration|dsh-work-shell/);
  }
});

test("file references stay bounded, relative, and inside the Session workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-work-references-"));
  try {
    await mkdir(join(root, "src", "components"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "README.md"), "# demo\n");
    await writeFile(join(root, "src", "components", "Button.tsx"), "export {}\n");
    await writeFile(join(root, "node_modules", "ignored", "secret.js"), "secret\n");
    await writeFile(join(root, ".git", "config"), "secret\n");
    const items = await listWorkspaceFileReferences(root, "button");
    assert.deepEqual(items.map((item) => item.text), ["src/components/Button.tsx"]);
    assert.ok(items.every((item) => !item.text.startsWith("/") && !item.text.includes("..")));
    assert.deepEqual(await listWorkspaceFileReferences(root, "secret"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
