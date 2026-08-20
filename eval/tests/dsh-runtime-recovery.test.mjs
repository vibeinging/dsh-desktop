import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  diagnosticsPayload,
  loadRecoveryState,
  normalizePluginName,
  profilePathForHome,
  recordRecoveryFailure,
  recordRecoveryResult,
  safeProfileHome,
  writeDiagnostics,
} from "../../electron/runtime-recovery.js";

test("recovery state records bounded, secret-filtered failures and results", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-runtime-recovery-"));
  try {
    const failed = recordRecoveryFailure({
      userDataPath: root,
      stage: "backend_start",
      profilePath: "/Users/example/.dsh/profiles/web",
      error: Object.assign(new Error("Authorization: Bearer abc123 DEEPSEEK_API_KEY=secret-value"), {
        code: "DSH_PROFILE_FAILED",
      }),
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.attempts, 1);
    assert.match(failed.last_failure.message, /Authorization=\[redacted\]/);
    assert.doesNotMatch(failed.last_failure.message, /abc123|secret-value/);

    const repeated = recordRecoveryFailure({
      userDataPath: root,
      stage: "backend_start",
      error: Object.assign(new Error("same failure"), { code: "DSH_PROFILE_FAILED" }),
    });
    assert.equal(repeated.attempts, 2);
    const resolved = recordRecoveryResult({ userDataPath: root, action: "safe-profile" });
    assert.equal(resolved.status, "resolved");
    assert.equal(loadRecoveryState(root).last_result.action, "safe-profile");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe profile and diagnostics stay outside the user's original Profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-runtime-recovery-paths-"));
  try {
    assert.equal(profilePathForHome(root), join(root, "profiles", "web"));
    assert.equal(safeProfileHome(root), join(root, "safe-profile"));
    assert.equal(normalizePluginName("@example/recovery"), "@example/recovery");
    assert.equal(normalizePluginName("../../secrets"), null);

    const state = recordRecoveryFailure({
      userDataPath: root,
      stage: "client_surface_ready",
      error: new Error("client failed"),
    });
    const file = writeDiagnostics({
      userDataPath: root,
      payload: diagnosticsPayload({
        state,
        appVersion: "0.0.1",
        platform: "darwin",
        arch: "arm64",
        backendState: "failed",
        runtimeHome: safeProfileHome(root),
      }),
    });
    const diagnostics = JSON.parse(await readFile(file, "utf8"));
    assert.equal(diagnostics.runtime_home_name, "safe-profile");
    assert.deepEqual(diagnostics.omitted, ["环境变量", "凭据", "Session 内容", "用户文件内容", "完整堆栈"]);
    assert.doesNotMatch(await readFile(file, "utf8"), /DEEPSEEK_API_KEY|NPM_TOKEN|session content/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
