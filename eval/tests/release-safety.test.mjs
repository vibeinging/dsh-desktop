import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  classifyMacSignatureOutput,
  findVendorRuntimeUsage,
  hasAgentSandboxDefault,
  hasVexDistributionAuthorization,
  inspectReleaseSafety,
} from '../../scripts/release-safety.mjs';
import {
  inspectCommunityAssetLicenseBoundary,
  inspectFeaturedArtifacts,
  inspectFeaturedMeasurement,
  inspectPublicReleaseAssets,
  inspectRetiredRendererReferences,
} from '../../scripts/release-boundary.mjs';
import {
  WINDOWS_ACCEPTANCE_CHECKS,
  createWindowsAcceptanceReceipt,
  isWindowsAcceptanceReceipt,
} from '../../scripts/windows-acceptance-receipt.mjs';
import {
  LIVE_MODEL_EVIDENCE_CHECKS,
  createLiveModelEvidenceReceipt,
  inspectLiveModelHistory,
  isLiveModelEvidenceReceipt,
} from '../../scripts/live-model-evidence.mjs';
import {
  isMacosDmgInstallerEvidenceReceipt,
  isMacosDmgNotarizationEvidenceReceipt,
  isNativeHostEvidenceReceipt,
  releaseEvidenceChecks,
  resolveCommitSha,
  sha256Path,
  validateReleaseEvidenceReceipt,
  createReleaseEvidenceReceipt,
} from '../../scripts/release-evidence-receipt.mjs';
import {
  pathWithPackagedBin,
  systemOnlyPath,
} from '../../electron/scripts/packaged-smoke-environment.mjs';
import {
  parseNotaryResult,
  resolveDmgPath,
} from '../../electron/scripts/notarize-macos-dmg.mjs';
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

test('public README assets exclude retired Renderer screenshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-public-assets-'));
  const imageRoot = join(root, 'docs', 'images', 'readme');
  try {
    mkdirSync(imageRoot, { recursive: true });
    writeFileSync(join(imageRoot, 'dsh-work-home.png'), 'retired');
    assert.deepEqual(inspectPublicReleaseAssets(root), [
      '公开素材仍包含退役 UI 图片：docs/images/readme/dsh-work-home.png',
    ]);
    rmSync(join(imageRoot, 'dsh-work-home.png'));
    writeFileSync(join(imageRoot, 'dsh-official-web-session-loopback.png'), 'current');
    assert.deepEqual(inspectPublicReleaseAssets(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release boundary rejects retired Renderer source reads without banning current renderer concepts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-retired-renderer-'));
  const testRoot = join(root, 'eval', 'tests');
  try {
    mkdirSync(testRoot, { recursive: true });
    const fixture = join(testRoot, 'fixture.test.mjs');
    const retiredRendererDir = String.fromCharCode(114, 101, 110, 100, 101, 114, 101, 114);
    const retiredSourceDir = String.fromCharCode(115, 114, 99);
    writeFileSync(fixture, `
      const currentWebContents = window.webContents;
      const packageWasRetired = existsSync(join(root, ${JSON.stringify(retiredRendererDir)}, 'package.json'));
    `);
    assert.deepEqual(inspectRetiredRendererReferences(root), []);

    writeFileSync(fixture, `
      const legacySource = readFileSync(join(root, ${JSON.stringify(retiredRendererDir)}, ${JSON.stringify(retiredSourceDir)}, 'main.tsx'), 'utf8');
    `);
    assert.match(inspectRetiredRendererReferences(root).join('\n'), /fixture\.test\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release boundary consumes every generated curated-plugin projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-featured-projections-'));
  const artifactRoot = join(root, '.desktop-build', 'featured-plugins');
  const runtimeRoot = join(root, 'server', 'src', 'engine', 'dsh_runtime');
  const name = '@vibeinging/example-bundle';
  const tarball = 'vibeinging-example-bundle-1.0.0.tgz';
  const bytes = Buffer.from('bundle');
  const hash = createHash('sha256').update(bytes).digest('hex');
  try {
    mkdirSync(join(artifactRoot, 'licenses'), { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(join(runtimeRoot, 'featured_plugins.json'), JSON.stringify({
      schema_version: 1,
      profile: 'web',
      plugins: [{
        name,
        package_path: 'packages/example-bundle',
        license: 'BSD-3-Clause',
      }],
    }));
    writeFileSync(join(artifactRoot, tarball), bytes);
    writeFileSync(join(artifactRoot, 'licenses', 'BSD-3-Clause.txt'), 'license');
    writeFileSync(join(artifactRoot, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      profile: 'web',
      plugins: [{
        name,
        package_path: 'packages/example-bundle',
        package_license: 'BSD-3-Clause',
        license_file: 'licenses/BSD-3-Clause.txt',
        tarball,
        sha256: hash,
        size_bytes: bytes.length,
      }],
    }));
    writeFileSync(join(artifactRoot, 'profile-install.json'), JSON.stringify({
      profile: 'web',
      commands: [{ name, tarball, sha256: hash }],
    }));
    writeFileSync(join(artifactRoot, 'permissions.json'), JSON.stringify({
      plugins: [{ name }],
    }));
    writeFileSync(join(artifactRoot, 'test-expected.json'), JSON.stringify({
      profile: 'web',
      bundles: [name],
      tarballs: [{ name, tarball, sha256: hash, size_bytes: bytes.length }],
    }));
    writeFileSync(join(artifactRoot, 'evaluation.json'), JSON.stringify({
      schema_version: 1,
      profile: 'web',
      source: 'server/src/engine/dsh_runtime/featured_plugins.json',
      plugins: [{
        name,
        version: undefined,
        package_path: 'packages/example-bundle',
        license: 'BSD-3-Clause',
        portability: undefined,
        permissions: undefined,
        tarball,
        sha256: hash,
        size_bytes: bytes.length,
      }],
    }));
    writeFileSync(join(artifactRoot, 'THIRD_PARTY_NOTICES.md'), 'notice');
    assert.deepEqual(inspectFeaturedArtifacts(root, { required: true }), []);

    writeFileSync(join(artifactRoot, 'evaluation.json'), JSON.stringify({
      schema_version: 1,
      profile: 'web',
      source: 'server/src/engine/dsh_runtime/featured_plugins.json',
      plugins: [],
    }));
    assert.match(inspectFeaturedArtifacts(root).join('\n'), /evaluation\.json 与精选插件 manifest 不一致/);

    writeFileSync(join(artifactRoot, 'test-expected.json'), JSON.stringify({
      profile: 'web',
      bundles: [],
      tarballs: [],
    }));
    assert.match(inspectFeaturedArtifacts(root).join('\n'), /test-expected\.json 与精选插件 manifest 不一致/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('featured-plugin measurement rejects source and artifact drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-featured-measurement-'));
  const artifactRoot = join(root, '.desktop-build', 'featured-plugins');
  const reportRoot = join(root, '.desktop-build', 'reports');
  const runtimeRoot = join(root, 'server', 'src', 'engine', 'dsh_runtime');
  const sourcePath = join(runtimeRoot, 'featured_plugins.json');
  const artifactPath = join(artifactRoot, 'manifest.json');
  const source = JSON.stringify({ profile: 'web', plugins: [] });
  const artifact = JSON.stringify({ profile: 'web', plugins: [] });
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  try {
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(reportRoot, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(sourcePath, source);
    writeFileSync(artifactPath, artifact);
    writeFileSync(join(reportRoot, 'featured-plugin-evaluation.json'), JSON.stringify({
      schema_version: 2,
      git_commit_sha: 'not-a-git-checkout',
      featured_source: {
        reference: 'server/src/engine/dsh_runtime/featured_plugins.json',
        sha256: hash(source),
      },
      artifact_manifest: {
        reference: 'featured-plugins/manifest.json',
        sha256: hash(artifact),
      },
      plugins: [],
    }));
    assert.deepEqual(inspectFeaturedMeasurement(root, { required: true }), []);
    writeFileSync(sourcePath, JSON.stringify({ profile: 'web', plugins: [], drift: true }));
    assert.match(inspectFeaturedMeasurement(root, { required: true }).join('\n'), /源 manifest SHA-256/);
    writeFileSync(sourcePath, source);
    writeFileSync(artifactPath, JSON.stringify({ profile: 'web', plugins: [], drift: true }));
    assert.match(inspectFeaturedMeasurement(root, { required: true }).join('\n'), /产物 manifest SHA-256/);
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

test('featured-plugin measurement rejects a plugin whose status is not passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-featured-measurement-status-'));
  const artifactRoot = join(root, '.desktop-build', 'featured-plugins');
  const reportRoot = join(root, '.desktop-build', 'reports');
  const runtimeRoot = join(root, 'server', 'src', 'engine', 'dsh_runtime');
  const plugin = {
    name: '@example/featured-bundle',
    tarball: 'example-featured-bundle.tgz',
    sha256: 'a'.repeat(64),
  };
  try {
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(reportRoot, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(join(runtimeRoot, 'featured_plugins.json'), '{}');
    writeFileSync(join(artifactRoot, 'manifest.json'), JSON.stringify({ plugins: [plugin] }));
    writeFileSync(join(reportRoot, 'featured-plugin-evaluation.json'), JSON.stringify({
      schema_version: 2,
      git_commit_sha: 'not-a-git-checkout',
      featured_source: { sha256: createHash('sha256').update('{}').digest('hex') },
      artifact_manifest: {
        sha256: createHash('sha256').update(JSON.stringify({ plugins: [plugin] })).digest('hex'),
      },
      plugins: [{ ...plugin, status: 'failed' }],
    }));
    assert.match(inspectFeaturedMeasurement(root, { required: true }).join('\n'), /status 不是 passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('live-model evidence receipt binds the current artifacts and rejects drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-live-model-receipt-'));
  const app = join(root, 'DSH Desktop.app');
  const featuredManifest = join(app, 'Contents', 'Resources', 'featured-plugins', 'manifest.json');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources', 'featured-plugins'), { recursive: true });
  mkdirSync(join(root, 'server', 'src', 'engine', 'dsh_runtime'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'MacOS', 'DSH Desktop'), 'app');
  writeFileSync(join(root, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json'), '{}');
  writeFileSync(featuredManifest, '{}');
  try {
    const responseMarker = 'DSH-LIVE-MODEL-test-marker';
    const history = {
      entries: [
        { event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
        { event: { type: 'assistant/message', seq: 2, data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `已完成 ${responseMarker}` }],
            source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          },
        } } },
        { event: { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } } },
      ],
    };
    assert.deepEqual(inspectLiveModelHistory(history, { responseMarker }), {
      ok: true,
      completed: true,
      terminalFailure: false,
      assistantText: `已完成 ${responseMarker}`,
      provider: 'deepseek-official',
      providerName: 'DeepSeek',
      errors: [],
    });
    assert.deepEqual(inspectLiveModelHistory({ events: history.entries }, { responseMarker }), {
      ok: true,
      completed: true,
      terminalFailure: false,
      assistantText: `已完成 ${responseMarker}`,
      provider: 'deepseek-official',
      providerName: 'DeepSeek',
      errors: [],
    });
    const receipt = createLiveModelEvidenceReceipt({
      root,
      appPath: app,
      screenshot: '/tmp/live-model/official-web-session-flow.png',
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
      signerIdentity: 'Developer ID Application: DSH Desktop (TEAM123)',
      startedAt: '2026-08-21T00:00:00.000Z',
      completedAt: '2026-08-21T00:01:00.000Z',
      history,
      responseMarker,
    });
    assert.equal(isLiveModelEvidenceReceipt(receipt), true);
    assert.equal(receipt.credentials_persisted, false);
    assert.equal(receipt.provider, 'deepseek-official');
    assert.equal(receipt.provider_name, 'DeepSeek');
    assert.equal(receipt.model_response_marker, responseMarker);
    assert.equal(receipt.checks.length, LIVE_MODEL_EVIDENCE_CHECKS.length);
    assert.deepEqual(receipt.screenshot_refs, ['live-model-evidence/official-web-session-flow.png']);
    assert.deepEqual(validateReleaseEvidenceReceipt(receipt, {
      root,
      kind: 'live-model',
      appPath: app,
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
      platform: 'darwin',
      arch: 'arm64',
      signerIdentity: 'Developer ID Application: DSH Desktop (TEAM123)',
    }), []);
    assert.equal(isLiveModelEvidenceReceipt({ ...receipt, credentials_persisted: true }), false);
    assert.equal(isLiveModelEvidenceReceipt({ ...receipt, checks: receipt.checks.slice(1) }), false);
    assert.equal(isLiveModelEvidenceReceipt({
      ...receipt,
      featured_manifest: {
        ...receipt.featured_manifest,
        source: { ...receipt.featured_manifest.source, reference: 'elsewhere/featured_plugins.json' },
      },
    }), false);
    assert.equal(isLiveModelEvidenceReceipt({ ...receipt, provider: 'fake-provider' }), false);
    assert.equal(isLiveModelEvidenceReceipt({ ...receipt, model_response_marker: '' }), false);
    assert.throws(() => createLiveModelEvidenceReceipt({
      root,
      appPath: app,
      screenshot: '/tmp/live-model/official-web-session-flow.png',
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
      signerIdentity: 'Developer ID Application: DSH Desktop (TEAM123)',
      startedAt: '2026-08-21T00:00:00.000Z',
      completedAt: '2026-08-21T00:01:00.000Z',
      responseMarker,
      history: {
        entries: [
          { event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'prompt' }] } } },
          { event: { type: 'turn/end', seq: 2, data: {
            reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'missing key' } },
          } } },
        ],
      },
    }), /MISSING_CREDENTIAL|assistant 文本|completed/);
    assert.match(validateReleaseEvidenceReceipt({
      ...receipt,
      git_commit_sha: 'b'.repeat(40),
    }, {
      root,
      kind: 'live-model',
      appPath: app,
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
    }).join('\n'), /git_commit_sha/);
    assert.match(validateReleaseEvidenceReceipt({
      ...receipt,
      artifacts: { ...receipt.artifacts, app: { ...receipt.artifacts.app, sha256: '0'.repeat(64) } },
    }, {
      root,
      kind: 'live-model',
      appPath: app,
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
    }).join('\n'), /App SHA-256/);
    rmSync(featuredManifest);
    assert.match(validateReleaseEvidenceReceipt(receipt, {
      root,
      kind: 'live-model',
      appPath: app,
      featuredManifestPath: featuredManifest,
      commitSha: 'a'.repeat(40),
    }).join('\n'), /当前精选产物 manifest 不存在/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('each release receipt kind rejects incomplete, failed, wrong-level, and string checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-receipt-contract-'));
  const app = join(root, 'DSH Desktop.app');
  const dmg = join(root, 'dsh-desktop.dmg');
  const featuredManifest = join(app, 'Contents', 'Resources', 'featured-plugins', 'manifest.json');
  const sourceManifest = join(root, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json');
  const commitSha = 'a'.repeat(40);
  const signerIdentity = 'Developer ID Application: DSH Desktop (TEAM123)';
  const common = {
    root,
    appPath: app,
    featuredManifestPath: featuredManifest,
    commitSha,
    platform: 'darwin',
    arch: 'arm64',
    signerIdentity,
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: '2026-08-21T00:01:00.000Z',
  };
  const cases = [
    {
      kind: 'live-model',
      evidenceLevel: 'packaged-electron-live-model',
      checks: ['official-web-launch', 'session-create', 'session-history', 'provider-success', 'model-response-success'],
      validator: isLiveModelEvidenceReceipt,
    },
    {
      kind: 'macos-dmg-notarization',
      evidenceLevel: 'macos-dmg-notarization',
      checks: ['notarytool-accepted', 'dmg-stapled', 'dmg-stapler-validate', 'dmg-gatekeeper-open', 'payload-stapler-validate', 'payload-gatekeeper-execute'],
      validator: isMacosDmgNotarizationEvidenceReceipt,
    },
    {
      kind: 'macos-dmg-installer',
      evidenceLevel: 'macos-dmg-installer-electron',
      checks: ['mount', 'copy', 'install', 'activate', 'uninstall', 'restart', 'detach'],
      validator: isMacosDmgInstallerEvidenceReceipt,
    },
    {
      kind: 'native-host',
      evidenceLevel: 'packaged-electron-native-host',
      nativeHostMode: 'window',
      checks: releaseEvidenceChecks('native-host', 'window'),
      validator: isNativeHostEvidenceReceipt,
    },
  ];
  try {
    mkdirSync(join(app, 'Contents', 'Resources', 'featured-plugins'), { recursive: true });
    mkdirSync(join(root, 'server', 'src', 'engine', 'dsh_runtime'), { recursive: true });
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'MacOS', 'DSH Desktop'), 'app');
    writeFileSync(sourceManifest, '{}');
    writeFileSync(featuredManifest, '{}');
    writeFileSync(dmg, 'dmg');
    for (const item of cases) {
      const receipt = createReleaseEvidenceReceipt({
        ...common,
        kind: item.kind,
        evidenceLevel: item.evidenceLevel,
        ...(item.kind === 'macos-dmg-notarization' || item.kind === 'macos-dmg-installer' ? { dmgPath: dmg } : {}),
        ...(item.nativeHostMode ? { nativeHostMode: item.nativeHostMode } : {}),
        checks: item.checks.map((name) => ({ name, passed: true })),
      });
      if (item.kind === 'live-model') {
        Object.assign(receipt, {
          live_model_version: 'dsh.live-model.evidence.v1',
          provider: 'deepseek-official',
          provider_name: 'DeepSeek',
          model_response_marker: 'DSH-LIVE-MODEL-test-marker',
          credentials_persisted: false,
          screenshot_refs: ['live-model-evidence/smoke.png'],
        });
      }
      assert.equal(item.validator(receipt), true, `${item.kind} valid receipt`);
      const validate = (candidate) => validateReleaseEvidenceReceipt(candidate, {
        kind: item.kind,
        verifyContent: false,
      });
      assert.match(validate({ ...receipt, checks: receipt.checks.slice(1) }).join('\n'), /必需检查项|缺少检查项/);
      assert.match(validate({
        ...receipt,
        checks: receipt.checks.map((check, index) => index === 0 ? { ...check, passed: false } : check),
      }).join('\n'), /未通过/);
      assert.match(validate({ ...receipt, evidence_level: 'anything' }).join('\n'), /evidence_level/);
      assert.match(validate({ ...receipt, checks: receipt.checks.map((check) => check.name) }).join('\n'), /对象数组/);
      assert.match(validate({
        ...receipt,
        checks: [...receipt.checks, { name: 'not-a-real-release-check', passed: true }],
      }).join('\n'), /未知检查项/);
      assert.match(validate({
        ...receipt,
        checks: [...receipt.checks, { ...receipt.checks[0] }],
      }).join('\n'), /检查项重复/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('formal release commit binding rejects an environment SHA different from HEAD', () => {
  assert.throws(() => resolveCommitSha(process.cwd(), { DSH_RELEASE_COMMIT_SHA: 'b'.repeat(40) }, { requireMatch: true }), /checkout 不一致/);
});

test('native Host receipts require the complete mode-specific operation contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-host-receipt-contract-'));
  const app = join(root, 'DSH Desktop.app');
  const featuredManifest = join(app, 'Contents', 'Resources', 'featured-plugins', 'manifest.json');
  const sourceManifest = join(root, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json');
  const common = {
    root,
    appPath: app,
    featuredManifestPath: featuredManifest,
    commitSha: 'a'.repeat(40),
    platform: 'darwin',
    arch: 'arm64',
    signerIdentity: 'Developer ID Application: DSH Desktop (TEAM123)',
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: '2026-08-21T00:01:00.000Z',
    kind: 'native-host',
    evidenceLevel: 'packaged-electron-native-host',
  };
  try {
    mkdirSync(join(app, 'Contents', 'Resources', 'featured-plugins'), { recursive: true });
    mkdirSync(join(root, 'server', 'src', 'engine', 'dsh_runtime'), { recursive: true });
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'MacOS', 'DSH Desktop'), 'app');
    writeFileSync(sourceManifest, '{}');
    writeFileSync(featuredManifest, '{}');
    const create = (mode, checks) => createReleaseEvidenceReceipt({
      ...common,
      nativeHostMode: mode,
      checks: checks.map((name) => ({ name, passed: true })),
    });
    const windowReceipt = create('window', releaseEvidenceChecks('native-host', 'window'));
    const dialogsReceipt = create('dialogs', releaseEvidenceChecks('native-host', 'dialogs'));
    assert.equal(isNativeHostEvidenceReceipt(windowReceipt, { mode: 'window' }), true);
    assert.equal(isNativeHostEvidenceReceipt(dialogsReceipt, { mode: 'dialogs' }), true);
    assert.equal(isNativeHostEvidenceReceipt({
      ...windowReceipt,
      checks: windowReceipt.checks.slice(0, 3),
    }), false);
    assert.equal(isNativeHostEvidenceReceipt({
      ...windowReceipt,
      native_host_mode: 'dialogs',
    }), false);
    assert.equal(isNativeHostEvidenceReceipt({
      ...windowReceipt,
      checks: windowReceipt.checks.filter(({ name }) => name !== 'restore'),
    }), false);
    assert.equal(isNativeHostEvidenceReceipt({
      ...dialogsReceipt,
      checks: dialogsReceipt.checks.filter(({ name }) => name !== 'session-bound-directory-dialog-open'),
    }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('formal release commit binding rejects an invalid current checkout even with a supplied SHA', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-invalid-release-checkout-'));
  try {
    assert.throws(
      () => resolveCommitSha(root, { DSH_RELEASE_COMMIT_SHA: 'a'.repeat(40) }, { requireMatch: true }),
      /当前 checkout 没有有效 git commit SHA/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows native Host receipts bind the EXE artifact separately from the unpacked directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-windows-native-host-receipt-'));
  const appDirectory = join(root, 'release', 'win-unpacked');
  const executable = join(appDirectory, 'DSH Desktop.exe');
  const resourcesManifest = join(appDirectory, 'resources', 'featured-plugins', 'manifest.json');
  const sourceManifest = join(root, 'server', 'src', 'engine', 'dsh_runtime', 'featured_plugins.json');
  const commitSha = 'a'.repeat(40);
  const signerIdentity = 'CN=DSH Desktop, O=DSH, C=CN';
  try {
    mkdirSync(join(appDirectory, 'resources', 'featured-plugins'), { recursive: true });
    mkdirSync(join(root, 'server', 'src', 'engine', 'dsh_runtime'), { recursive: true });
    writeFileSync(executable, 'signed Windows executable');
    writeFileSync(join(appDirectory, 'resources', 'version.txt'), 'resources');
    writeFileSync(sourceManifest, '{}');
    writeFileSync(resourcesManifest, '{}');
    const create = (mode) => createReleaseEvidenceReceipt({
      root,
      appPath: executable,
      featuredManifestPath: resourcesManifest,
      commitSha,
      platform: 'win32',
      arch: 'x64',
      signerIdentity,
      startedAt: '2026-08-21T00:00:00.000Z',
      completedAt: '2026-08-21T00:01:00.000Z',
      kind: 'native-host',
      evidenceLevel: 'packaged-electron-native-host',
      nativeHostMode: mode,
      checks: releaseEvidenceChecks('native-host', mode).map((name) => ({ name, passed: true })),
    });
    const validate = (receipt, mode = receipt.native_host_mode, overrides = {}) => validateReleaseEvidenceReceipt(receipt, {
      root,
      kind: 'native-host',
      appPath: executable,
      featuredManifestPath: resourcesManifest,
      commitSha,
      platform: 'win32',
      arch: 'x64',
      signerIdentity,
      ...overrides,
      nativeHostMode: mode,
    });
    const windowReceipt = create('window');
    const dialogsReceipt = create('dialogs');
    assert.equal(windowReceipt.artifacts.app.sha256, sha256Path(executable));
    assert.notEqual(windowReceipt.artifacts.app.sha256, sha256Path(appDirectory));
    assert.deepEqual(validate(windowReceipt), []);
    assert.deepEqual(validate(dialogsReceipt), []);
    assert.match(validate({
      ...windowReceipt,
      artifacts: { ...windowReceipt.artifacts, app: { ...windowReceipt.artifacts.app, sha256: 'b'.repeat(64) } },
    }).join('\n'), /App SHA-256/);
    assert.match(validate({ ...windowReceipt, git_commit_sha: 'b'.repeat(40) }).join('\n'), /git_commit_sha/);
    assert.match(validate(windowReceipt, 'window', { platform: 'darwin' }).join('\n'), /platform/);
    assert.match(validate(windowReceipt, 'window', { arch: 'arm64' }).join('\n'), /arch/);
    assert.match(validate(windowReceipt, 'window', { signerIdentity: 'Other signer' }).join('\n'), /signer_identity/);
    assert.match(validate({ ...windowReceipt, native_host_mode: 'dialogs' }).join('\n'), /未知检查项|native_host_mode/);
    assert.match(validate({
      ...dialogsReceipt,
      checks: dialogsReceipt.checks.filter(({ name }) => name !== 'session-bound-directory-dialog-open'),
    }).join('\n'), /必需检查项/);
    const nativeSmoke = readFileSync(new URL('../../electron/scripts/smoke-packaged-native-host.mjs', import.meta.url), 'utf8');
    assert.match(nativeSmoke, /const receiptArtifactPath = packagedLayout\.platform === 'win32' \? executable : packagedArtifactPath/);
    assert.match(nativeSmoke, /appPath: receiptArtifactPath/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows formal gate requires separate window and dialogs receipts', () => {
  const resultVariables = [
    'DSH_RELEASE_COMMIT_SHA',
    'DSH_NATIVE_HOST_WINDOW_RESULT_FILE',
    'DSH_NATIVE_HOST_DIALOGS_RESULT_FILE',
  ];
  const saved = Object.fromEntries(resultVariables.map((name) => [name, process.env[name]]));
  try {
    for (const name of resultVariables) delete process.env[name];
    const report = inspectReleaseSafety({
      root: process.cwd(),
      scope: 'windows',
      appPath: join(tmpdir(), 'dsh-missing-win-unpacked', 'DSH Desktop.exe'),
      requireEvidence: true,
    });
    const nativeChecks = report.checks.filter(({ id }) => id.startsWith('windows_native_host_'));
    assert.deepEqual(nativeChecks.map(({ id }) => id), [
      'windows_native_host_window_receipt',
      'windows_native_host_dialogs_receipt',
    ]);
    assert.equal(nativeChecks.every(({ status }) => status === 'block'), true);
  } finally {
    for (const name of resultVariables) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('macOS release workflow persists the real live-model receipt', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/macos-release-evidence.yml', import.meta.url), 'utf8');
  assert.match(workflow, /DSH_LIVE_MODEL_RESULT_FILE=/);
  assert.match(workflow, /live-model-evidence\/result\.json/);
  assert.match(workflow, /DEEPSEEK_API_KEY:/);
  assert.match(workflow, /test -n "\$DEEPSEEK_API_KEY"/);
  assert.match(workflow, /npm run release:verify:mac -- --require-evidence/);
  assert.doesNotMatch(workflow, /inputs:\s*[\s\S]*live_model:/);
});

test('release workflows reject wrong refs and missing credentials before dependency installation', () => {
  const mac = readFileSync(new URL('../../.github/workflows/macos-release-evidence.yml', import.meta.url), 'utf8');
  const windowsSigned = readFileSync(new URL('../../.github/workflows/windows-release-evidence.yml', import.meta.url), 'utf8');
  const windowsUnsigned = readFileSync(new URL('../../.github/workflows/windows-release.yml', import.meta.url), 'utf8');
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const workflow of [mac, windowsSigned, windowsUnsigned]) {
    const preflightIndex = workflow.indexOf('- name: Validate release');
    const installIndex = workflow.indexOf('- name: Install');
    assert.ok(preflightIndex >= 0 && installIndex > preflightIndex);
    assert.match(workflow, /GITHUB_REF_TYPE/);
    assert.match(workflow, /GITHUB_REF_NAME/);
  }
  assert.match(mac, /CSC_NAME: 26C311958B22397631A857D0482CD2F0EA0BF2AA/);
  assert.match(mac, /Missing required release secret/);
  assert.match(windowsSigned, /WIN_CSC_LINK/);
  assert.match(windowsSigned, /Missing required release secret/);
  assert.match(windowsUnsigned, /dsh-desktop-win-x64-unsigned/);
  assert.match(ci, /branches: \[dev, main\]/);
  assert.doesNotMatch(ci, /tags:/);
});

test('macOS release workflow runs the DMG installer lifecycle smoke', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/macos-release-evidence.yml', import.meta.url), 'utf8');
  assert.match(workflow, /npm run smoke:macos:installer/);
  assert.match(workflow, /macos-installer-evidence\/result\.json/);
  assert.match(workflow, /macos-installer-evidence/);
  assert.match(workflow, /xcrun notarytool history/);
  assert.match(workflow, /apple-notary-history\.json/);
  assert.match(workflow, /DSH_MACOS_DMG_NOTARY_RESULT_FILE/);
  assert.match(workflow, /macos-dmg-evidence\/result\.json/);
  assert.match(workflow, /npm run smoke:native-host/);
  assert.match(workflow, /npm run smoke:native-host:dialogs/);
  assert.match(workflow, /DSH_NATIVE_HOST_WINDOW_RESULT_FILE/);
  assert.match(workflow, /DSH_NATIVE_HOST_DIALOGS_RESULT_FILE/);
  assert.match(workflow, /native-host-window-evidence/);
  assert.match(workflow, /native-host-dialogs-evidence/);
  assert.match(workflow, /xcrun stapler validate/);
  assert.match(workflow, /spctl --assess --type execute/);
});

test('macOS DMG notarization selects the current architecture and keeps the receipt credential-free', () => {
  assert.equal(
    resolveDmgPath('/workspace', '0.0.1', 'arm64', (candidate) => candidate.endsWith('dsh-desktop-0.0.1-mac-arm64.dmg')),
    '/workspace/release/dsh-desktop-0.0.1-mac-arm64.dmg',
  );
  assert.deepEqual(parseNotaryResult('{"status":"Accepted","id":"submission-1"}'), {
    status: 'Accepted',
    id: 'submission-1',
  });
  assert.deepEqual(parseNotaryResult('{"notarizationStatus":"Invalid"}'), {
    status: 'Invalid',
    id: null,
  });
});

test('Windows release evidence workflow requires signing, installer acceptance, and signature verification', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/windows-release-evidence.yml', import.meta.url), 'utf8');
  const electronPackage = JSON.parse(readFileSync(new URL('../../electron/package.json', import.meta.url), 'utf8'));
  assert.match(workflow, /WIN_CSC_LINK:/);
  assert.match(workflow, /WIN_CSC_KEY_PASSWORD:/);
  assert.match(workflow, /DSH_RELEASE_COMMIT_SHA:/);
  assert.match(workflow, /npm run package:win\b/);
  assert.match(workflow, /npm run measure:featured-plugins/);
  assert.match(workflow, /smoke:win:acceptance/);
  assert.match(workflow, /npm run smoke:native-host/);
  assert.match(workflow, /npm run smoke:native-host:dialogs/);
  assert.match(workflow, /DSH_NATIVE_HOST_WINDOW_RESULT_FILE/);
  assert.match(workflow, /DSH_NATIVE_HOST_DIALOGS_RESULT_FILE/);
  assert.match(workflow, /native-host-window-evidence/);
  assert.match(workflow, /native-host-dialogs-evidence/);
  assert.match(workflow, /release:verify:win -- --require-evidence/);
  assert.match(workflow, /featured-plugin-evaluation\.json/);
  assert.match(workflow, /windows-x64-acceptance\.json/);
  assert.match(electronPackage.scripts['package:win:project'], /release:verify:win -- --allow-blockers/);
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
