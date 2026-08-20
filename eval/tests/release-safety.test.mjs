import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyMacSignatureOutput,
  findVendorRuntimeUsage,
  hasAgentSandboxDefault,
  hasVexDistributionAuthorization,
} from '../../scripts/release-safety.mjs';
import { inspectCommunityAssetLicenseBoundary } from '../../scripts/release-boundary.mjs';
import {
  WINDOWS_ACCEPTANCE_CHECKS,
  createWindowsAcceptanceReceipt,
  isWindowsAcceptanceReceipt,
} from '../../scripts/windows-acceptance-receipt.mjs';
import {
  pathWithPackagedBin,
  systemOnlyPath,
} from '../../electron/scripts/packaged-smoke-environment.mjs';
import { BUNDLED_PNPM_FILES } from '../../electron/scripts/prepare-package.mjs';

test('release safety rejects adhoc macOS signatures and accepts Developer ID signatures', () => {
  assert.deepEqual(classifyMacSignatureOutput('Signature=adhoc\nTeamIdentifier=not set'), {
    signed_for_distribution: false,
    team_identifier: null,
    adhoc: true,
  });
  assert.deepEqual(classifyMacSignatureOutput('Signature size=9105\nTeamIdentifier=ABCDE12345'), {
    signed_for_distribution: true,
    team_identifier: 'ABCDE12345',
    adhoc: false,
  });
});

test('release safety detects vendor runtime linkage and requires VexDB distribution authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-safety-'));
  try {
    mkdirSync(join(root, 'server', 'src'), { recursive: true });
    mkdirSync(join(root, 'server', 'vendor', 'vexdb_lite'), { recursive: true });
    writeFileSync(join(root, 'server', 'src', 'runtime.js'), 'import "@openai/codex";\n');
    assert.deepEqual(findVendorRuntimeUsage(root), ['server/src/runtime.js']);
    assert.equal(hasVexDistributionAuthorization(root), false);
    writeFileSync(
      join(root, 'server', 'vendor', 'vexdb_lite', 'LICENSE'),
      'Permission is hereby granted to use and distribute this software.\n',
    );
    writeFileSync(
      join(root, 'server', 'vendor', 'vexdb_lite', 'RELEASE-PROVENANCE.md'),
      'https://github.com/VexDB-THU/VexDB-Lite/releases/tag/v0.0.17\n',
    );
    writeFileSync(
      join(root, 'server', 'vendor', 'vexdb_lite', 'SHA256SUMS'),
      'aaa  macos/vexdb_lite.dylib\nbbb  windows-x64/vexdb_lite.dll\n',
    );
    assert.equal(hasVexDistributionAuthorization(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release safety recognizes the DSH runtime sandbox defaults and ask-mode approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-safety-'));
  const agents = join(root, 'server', 'src', 'engine', 'agents');
  const runtime = join(root, 'server', 'src', 'engine', 'dsh_runtime');
  try {
    mkdirSync(agents, { recursive: true });
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(agents, 'approval_mode.js'), `
      const APPROVAL_MODE_SETTINGS = Object.freeze({
        ask: Object.freeze({
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        }),
      });
      export function normalizeApprovalMode(value) {
        const mode = String(value || "").trim().toLowerCase();
        return Object.hasOwn(APPROVAL_MODE_SETTINGS, mode) ? mode : "ask";
      }
    `);
    writeFileSync(join(runtime, 'desktop_web.patch.yml'), `
      - id: webserver
        config:
          host: 127.0.0.1
    `);
    writeFileSync(join(agents, 'workspace_agent.js'), `
      import { DshWorkspaceRuntime } from "../dsh_runtime/workspace_runtime.js";
      const runtime = new DshWorkspaceRuntime({});
      const result = await runtime.execute({ agentContext, streamCallback, cwd });
    `);
    assert.equal(hasAgentSandboxDefault(root), true);
    writeFileSync(join(runtime, 'desktop_web.patch.yml'), `
      - id: agents
        config:
          approvalPolicy: "never"
    `);
    assert.equal(hasAgentSandboxDefault(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('community skin assets need an explicit redistribution decision before release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-assets-'));
  const runtime = join(root, 'server', 'src', 'engine', 'dsh_runtime');
  try {
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'featured_plugins.json'), JSON.stringify({ plugins: [] }));
    writeFileSync(join(runtime, 'community_plugin_registry.json'), JSON.stringify({
      plugins: [{
        id: 'skin-center',
        name: 'Skin Center',
        source: '@example/skin-center@1.0.0',
        category: 'skins',
      }],
    }));
    assert.match(inspectCommunityAssetLicenseBoundary(root).join('\n'), /缺少资产许可审查记录/);

    writeFileSync(join(runtime, 'community_plugin_registry.json'), JSON.stringify({
      plugins: [{
        id: 'skin-center',
        name: 'Skin Center',
        source: '@example/skin-center@1.0.0',
        category: 'skins',
        license: 'Apache-2.0',
        asset_surface: 'skin-assets',
        asset_review: {
          status: 'blocked',
          redistribution: 'blocked',
          asset_licenses: ['Apache-2.0', 'CC-BY-NC-SA-4.0'],
          reason_zh: '资产许可未完成，暂不随包分发。',
          evidence: 'https://example.test/skin-license',
        },
      }],
    }));
    assert.deepEqual(inspectCommunityAssetLicenseBoundary(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows acceptance receipt requires every real install lifecycle check', () => {
  const receipt = createWindowsAcceptanceReceipt({
    installer: 'release/dsh-desktop-0.0.1-win-x64.exe',
    unpackedApp: 'release/win-unpacked',
    checks: WINDOWS_ACCEPTANCE_CHECKS.map((name) => ({ name, passed: true, duration_ms: 1 })),
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: '2026-08-21T00:01:00.000Z',
  });
  assert.equal(isWindowsAcceptanceReceipt(receipt), true);
  assert.equal(isWindowsAcceptanceReceipt({ ...receipt, checks: receipt.checks.slice(1) }), false);
  assert.equal(isWindowsAcceptanceReceipt({ ...receipt, passed: false }), false);
});

test('packaged smoke uses a platform system path without inheriting the user PATH', () => {
  const systemPath = systemOnlyPath();
  assert.match(systemPath, process.platform === 'win32' ? /System32/i : /\/usr\/bin/);
  assert.match(pathWithPackagedBin('packaged-bin'), /^packaged-bin[;:]/);
});

test('bundled pnpm keeps only the Node runtime files needed by the wrapper', () => {
  assert.deepEqual(BUNDLED_PNPM_FILES, ['bin', 'dist', 'LICENSE', 'package.json']);
  assert.equal(BUNDLED_PNPM_FILES.includes('artifacts'), false);
});
