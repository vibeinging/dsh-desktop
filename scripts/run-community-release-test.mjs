#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const child = spawn(process.execPath, [
  "--import", "./eval/tests/setup.mjs",
  "--test",
  "--test-concurrency=1",
  "eval/tests/dsh-community-task-board.test.mjs",
], {
  cwd: root,
  env: { ...process.env, DSH_LIVE_COMMUNITY_TEST: "1" },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`[community-test] 无法启动真实社区回归：${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`[community-test] 社区回归被信号终止：${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
