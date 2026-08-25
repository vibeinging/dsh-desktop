#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectCommunityAssetLicenseBoundary,
  inspectFeaturedArtifacts,
  inspectFeaturedMeasurement,
  inspectOfficialWebReleaseBoundary,
} from './release-boundary.mjs';
import {
  readSignerIdentity,
  resolveCommitSha,
  validateReleaseEvidenceReceipt,
} from './release-evidence-receipt.mjs';
import {
  isLiveModelEvidenceReceipt,
} from './live-model-evidence.mjs';
import {
  isMacosDmgInstallerEvidenceReceipt,
  isMacosDmgNotarizationEvidenceReceipt,
  isNativeHostEvidenceReceipt,
} from './release-evidence-receipt.mjs';
import { isWindowsAcceptanceReceipt } from './windows-acceptance-receipt.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const TEXT_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue']);

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function readJson(path) {
  try { return JSON.parse(readText(path)); } catch { return null; }
}

function check(id, status, detail, evidence = null) {
  return { id, status, detail, evidence };
}

function walkFiles(path, output = []) {
  if (!existsSync(path)) return output;
  const info = statSync(path);
  if (info.isFile()) {
    output.push(path);
    return output;
  }
  for (const name of readdirSync(path)) {
    if (new Set(['node_modules', 'dist', 'release', '.desktop-build']).has(name)) continue;
    walkFiles(join(path, name), output);
  }
  return output;
}

export function findVendorRuntimeUsage(root) {
  const paths = [
    join(root, 'server', 'src'),
    join(root, 'electron', 'main.js'),
    join(root, 'electron', 'preload.js'),
    join(root, 'server', 'package.json'),
    join(root, 'electron', 'package.json'),
  ];
  const pattern = /(?:github\.com\/openai\/codex|@openai\/codex|codex-rs|codex-cli)/i;
  return paths.flatMap((path) => walkFiles(path))
    .filter((path) => TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))))
    .flatMap((path) => {
      const text = readText(path);
      return pattern.test(text) ? [path.slice(root.length + 1)] : [];
    });
}

export function hasVexDistributionAuthorization(root) {
  const vendor = join(root, 'server', 'vendor', 'vexdb_lite');
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
    .map((name) => readText(join(vendor, name)))
    .find(Boolean) || '';
  const authorization = readText(join(vendor, 'DISTRIBUTION-AUTHORIZATION.md'));
  const provenance = readText(join(vendor, 'RELEASE-PROVENANCE.md'));
  const checksums = readText(join(vendor, 'SHA256SUMS'));
  const hasDistributionTerms = (
    license.includes('Permission is hereby granted')
    && license.includes('distribute')
  ) || authorization.length > 0;
  return hasDistributionTerms
    && provenance.includes('VexDB-THU/VexDB-Lite/releases/tag/v0.0.17')
    && checksums.includes('macos/vexdb_lite.dylib')
    && checksums.includes('windows-x64/vexdb_lite.dll');
}

export function hasAgentSandboxDefault(root) {
  const workspaceAgent = readText(join(root, 'server', 'src', 'engine', 'agents', 'workspace_agent.js'));
  const desktopProfile = readText(join(root, 'server', 'src', 'engine', 'dsh_runtime', 'desktop_web.patch.yml'));
  const approvalMode = readText(join(root, 'server', 'src', 'engine', 'agents', 'approval_mode.js'));
  // Since the 2026-08 DSH runtime migration, app conversations execute through
  // the DSH Web profile, whose defaults are on-request approval and a
  // workspace-write sandbox. The app-level gate therefore asserts that the
  // agent path routes through DshWorkspaceRuntime, the desktop profile overlay
  // does not relax those defaults, and the local fallback default stays "ask".
  const routesThroughDshRuntime = /DshWorkspaceRuntime/.test(workspaceAgent)
    && /runtime\.execute\(\{ agentContext, streamCallback, cwd \}\)/.test(workspaceAgent);
  const profileDoesNotRelaxSandbox = !/approvalPolicy:\s*["']never["']/.test(desktopProfile)
    && !/sandbox:\s*["'](?:unrestricted|host)["']/.test(desktopProfile)
    && !/["'](?:unattended|full)["']/.test(desktopProfile);
  const localDefaultStaysAsk = /return Object\.hasOwn\(APPROVAL_MODE_SETTINGS, mode\) \? mode : "ask"/.test(approvalMode)
    && /ask: Object\.freeze\(\{[\s\S]*?approvalPolicy:\s*["']on-request["'][\s\S]*?sandbox:\s*["']workspace-write["']/.test(approvalMode);
  return routesThroughDshRuntime && profileDoesNotRelaxSandbox && localDefaultStaysAsk;
}

export function classifyMacSignatureOutput(output) {
  const text = String(output || '');
  const team = text.match(/TeamIdentifier=([^\s]+)/)?.[1] || '';
  const adhoc = /Signature=adhoc|flags=.*adhoc/i.test(text);
  return {
    signed_for_distribution: Boolean(team && team !== 'not' && !adhoc),
    team_identifier: team && team !== 'not' ? team : null,
    adhoc,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

function readReceipt(path) {
  const value = readJson(path);
  return value && typeof value === 'object' ? value : null;
}

function resolveMacDmg(root, appPath) {
  const packageJson = readJson(join(root, 'package.json')) || {};
  const arch = String(appPath || '').includes(`${sep}mac${sep}`) ? 'x64' : 'arm64';
  const candidate = join(root, 'release', `dsh-desktop-${packageJson.version}-mac-${arch}.dmg`);
  return existsSync(candidate) ? candidate : null;
}

const EVIDENCE_RECEIPT_VALIDATORS = Object.freeze({
  'live-model': isLiveModelEvidenceReceipt,
  'macos-dmg-notarization': isMacosDmgNotarizationEvidenceReceipt,
  'macos-dmg-installer': isMacosDmgInstallerEvidenceReceipt,
  'native-host': isNativeHostEvidenceReceipt,
});

function inspectEvidenceReceiptRows({
  root,
  appPath,
  resourcesManifest,
  dmgPath = null,
  platform,
  arch,
  signerIdentity,
  commit,
  requireEvidence = false,
  rows,
}) {
  return rows.map(([id, environmentName, kind, nativeHostMode]) => {
    const receiptPath = String(process.env[environmentName] || '').trim();
    if (!receiptPath) {
      return check(
        id,
        requireEvidence ? 'block' : 'manual',
        requireEvidence
          ? `缺少 ${environmentName}；正式发行需要真实回执（无 API key 或 smoke 失败均不得放行）`
          : `未提供 ${environmentName}；正式发行请使用 --require-evidence`,
        environmentName,
      );
    }
    if (!existsSync(receiptPath)) return check(id, 'block', `找不到回执：${receiptPath}`, receiptPath);
    const receipt = readReceipt(receiptPath);
    if (!receipt) return check(id, 'block', `回执不是有效 JSON：${receiptPath}`, receiptPath);
    const errors = EVIDENCE_RECEIPT_VALIDATORS[kind](receipt, { mode: nativeHostMode })
      ? []
      : [`${kind} 回执未通过该类型的固定 checks/evidence_level 契约`];
    errors.push(...validateReleaseEvidenceReceipt(receipt, {
      root,
      kind,
      appPath,
      dmgPath: kind === 'macos-dmg-notarization' || kind === 'macos-dmg-installer' ? dmgPath : null,
      featuredManifestPath: resourcesManifest,
      commitSha: commit,
      platform,
      arch,
      signerIdentity,
      nativeHostMode,
    }));
    return check(
      id,
      errors.length === 0 ? 'pass' : 'block',
      errors.length === 0 ? `回执绑定当前 ${platform}/${arch} 产物、精选 manifest 和 commit ${commit}` : errors.join('；'),
      receiptPath,
    );
  });
}

function inspectMacEvidenceReceipts(root, appPath, { requireEvidence = false } = {}) {
  const app = resolve(appPath);
  const resourcesManifest = join(app, 'Contents', 'Resources', 'featured-plugins', 'manifest.json');
  const dmg = resolveMacDmg(root, app);
  const arch = String(app).includes(`${sep}mac${sep}`) ? 'x64' : 'arm64';
  let commit;
  try {
    commit = resolveCommitSha(root, process.env, { requireMatch: true });
  } catch (error) {
    return [check('release_receipt_commit', 'block', error.message, root)];
  }
  return inspectEvidenceReceiptRows({
    root,
    appPath: app,
    resourcesManifest,
    dmgPath: dmg,
    platform: 'darwin',
    arch,
    signerIdentity: readSignerIdentity(app, process.env, { allowOverride: false }),
    commit,
    requireEvidence,
    rows: [
      ['mac_live_model_receipt', 'DSH_LIVE_MODEL_RESULT_FILE', 'live-model'],
      ['mac_dmg_notarization_receipt', 'DSH_MACOS_DMG_NOTARY_RESULT_FILE', 'macos-dmg-notarization'],
      ['macos_installer_receipt', 'DSH_MACOS_INSTALLER_RESULT_FILE', 'macos-dmg-installer'],
      ['mac_native_host_window_receipt', 'DSH_NATIVE_HOST_WINDOW_RESULT_FILE', 'native-host', 'window'],
      ['mac_native_host_dialogs_receipt', 'DSH_NATIVE_HOST_DIALOGS_RESULT_FILE', 'native-host', 'dialogs'],
    ],
  });
}

function inspectWindowsNativeHostReceipts(root, appPath, { requireEvidence = false } = {}) {
  const app = appPath ? resolve(appPath) : null;
  const resourcesManifest = app
    ? join(dirname(app), 'resources', 'featured-plugins', 'manifest.json')
    : null;
  let commit;
  try {
    commit = resolveCommitSha(root, process.env, { requireMatch: true });
  } catch (error) {
    return [check('windows_release_receipt_commit', 'block', error.message, root)];
  }
  return inspectEvidenceReceiptRows({
    root,
    appPath: app,
    resourcesManifest,
    platform: 'win32',
    arch: 'x64',
    signerIdentity: app ? readSignerIdentity(app, process.env, { allowOverride: false }) : '',
    commit,
    requireEvidence,
    rows: [
      ['windows_native_host_window_receipt', 'DSH_NATIVE_HOST_WINDOW_RESULT_FILE', 'native-host', 'window'],
      ['windows_native_host_dialogs_receipt', 'DSH_NATIVE_HOST_DIALOGS_RESULT_FILE', 'native-host', 'dialogs'],
    ],
  });
}

function staticChecks(root, scope, { requireMeasurement = false } = {}) {
  const checks = [];
  const privacy = readText(join(root, 'PRIVACY.md'));
  const security = readText(join(root, 'SECURITY.md'));
  const notices = readText(join(root, 'THIRD_PARTY_NOTICES.md'));
  const electronPackage = readJson(join(root, 'electron', 'package.json')) || {};
  const build = electronPackage.build || {};
  const mac = build.mac || {};
  const scripts = electronPackage.scripts || {};
  const extraResources = Array.isArray(build.extraResources) ? build.extraResources : [];
  const packagedLegal = new Set(extraResources.map((item) => item?.to).filter(Boolean));

  checks.push(check(
    'privacy_notice',
    privacy.includes('~/.dsh') && privacy.includes('workspace-write') && privacy.includes('on-request') ? 'pass' : 'block',
    '说明本地文件、联网边界、保留和删除规则',
    'PRIVACY.md',
  ));
  checks.push(check(
    'security_contact',
    security.includes('私下联系维护者') ? 'pass' : 'block',
    '提供不公开敏感信息的安全反馈入口',
    'SECURITY.md',
  ));
  checks.push(check(
    'third_party_notices',
    notices.includes('OpenAI Agent Runtime') && notices.includes('VexDB Lite') ? 'pass' : 'block',
    '记录关键第三方组件、运行时使用情况和二进制限制',
    'THIRD_PARTY_NOTICES.md',
  ));
  const vendorRuntimeUsage = findVendorRuntimeUsage(root);
  const vendorRuntimeLicense = join(root, 'legal', 'openai-agent-runtime-LICENSE.txt');
  const vendorRuntimeDistributionReady = vendorRuntimeUsage.length === 0 || (
    existsSync(vendorRuntimeLicense)
    && notices.includes('OpenAI Agent Runtime | 0.147.0 | Apache-2.0')
  );
  checks.push(check(
    'vendor_runtime_distribution',
    vendorRuntimeDistributionReady ? 'pass' : 'block',
    vendorRuntimeUsage.length === 0
      ? '生产代码未复制或链接第三方 Agent 运行时源码或二进制'
      : vendorRuntimeDistributionReady
        ? `第三方 Agent 运行时分发已记录并包含 Apache-2.0 许可证：${vendorRuntimeUsage.join(', ')}`
        : `第三方 Agent 运行时已进入生产依赖，但缺少 Apache-2.0 分发材料：${vendorRuntimeUsage.join(', ')}`,
    { usage: vendorRuntimeUsage, license: vendorRuntimeLicense },
  ));
  checks.push(check(
    'vexdb_lite_distribution',
    hasVexDistributionAuthorization(root) ? 'pass' : 'block',
    'VexDB Lite 必须同时保留许可证或分发授权、发行来源和随包文件 SHA-256',
    'server/vendor/vexdb_lite',
  ));
  checks.push(check(
    'legal_files_packaged',
    ['legal/LICENSE', 'legal/PRIVACY.md', 'legal/SECURITY.md', 'legal/THIRD_PARTY_NOTICES.md', 'legal/openai-agent-runtime-LICENSE.txt']
      .every((name) => packagedLegal.has(name)) ? 'pass' : 'block',
    '安装包包含许可证、隐私、安全和第三方说明',
    'electron/package.json#build.extraResources',
  ));
  checks.push(check(
    'agent_sandbox_default',
    hasAgentSandboxDefault(root) ? 'pass' : 'block',
    'Agent 默认使用受控工作区权限和按需审批',
    [
      'server/src/engine/agents/approval_mode.js',
      'server/src/engine/agents/workspace_agent.js',
      'server/src/engine/dsh_runtime/desktop_web.patch.yml',
    ],
  ));
  const webBoundaryErrors = inspectOfficialWebReleaseBoundary(root);
  checks.push(check(
    'official_web_release_boundary',
    webBoundaryErrors.length === 0 ? 'pass' : 'block',
    webBoundaryErrors.length === 0
      ? '主窗口只加载官方 DSH Web，发行包没有旧 Renderer、preload 或主题状态'
      : webBoundaryErrors.join('；'),
    ['electron/main.js', 'electron/package.json', 'electron/recovery.html', 'featured_plugins.json'],
  ));
  const communityAssetErrors = inspectCommunityAssetLicenseBoundary(root);
  checks.push(check(
    'community_asset_license_boundary',
    communityAssetErrors.length === 0 ? 'pass' : 'block',
    communityAssetErrors.length === 0
      ? '社区皮肤和视觉资产都有明确的许可证、来源和再分发结论；未批准资产不进入精选清单'
      : communityAssetErrors.join('；'),
    'server/src/engine/dsh_runtime/community_plugin_registry.json',
  ));
  const artifactErrors = inspectFeaturedArtifacts(root, { required: false });
  checks.push(check(
    'featured_plugin_artifacts',
    artifactErrors.length === 0 ? 'pass' : 'block',
    artifactErrors.length === 0
      ? '.desktop-build 中的精选插件 tarball、哈希和源码清单一致'
      : artifactErrors.join('；'),
    '.desktop-build/featured-plugins',
  ));
  const measurementPath = join(root, '.desktop-build', 'reports', 'featured-plugin-evaluation.json');
  const measurementErrors = inspectFeaturedMeasurement(root, { required: requireMeasurement });
  checks.push(check(
    'featured_plugin_measurement',
    measurementErrors.length > 0 ? 'block' : (requireMeasurement || existsSync(measurementPath) ? 'pass' : 'pass'),
    measurementErrors.length > 0
      ? measurementErrors.join('；')
      : requireMeasurement
        ? '精选插件测量报告与当前源/产物 manifest 一致'
        : '静态阶段不要求逐包测量报告；若存在则校验 hash',
    measurementPath,
  ));

  if (scope === 'all' || scope === 'macos') {
    checks.push(check(
      'mac_release_configuration',
      mac.hardenedRuntime === true
        && mac.notarize === false
        && String(scripts['package:mac:project'] || '').includes('forceCodeSigning=true')
        && String(scripts['package:mac:project'] || '').includes('scripts/notarize-macos-app.mjs')
        && String(scripts['package:mac:project'] || '').includes('--prepackaged')
        ? 'pass' : 'block',
      '正式 macOS 构建强制 Developer ID 签名，并用 notarytool Keychain 或环境凭据公证 App 和 DMG',
      'electron/package.json',
    ));
    const macEvidenceWorkflow = readText(join(root, '.github', 'workflows', 'macos-release-evidence.yml'));
    const macWorkflowRequirements = [
      'workflow_dispatch:',
      'APPLE_ID:',
      'APPLE_APP_SPECIFIC_PASSWORD:',
      'CSC_LINK:',
      'CSC_NAME: 26C311958B22397631A857D0482CD2F0EA0BF2AA',
      'Validate release ref and credentials',
      'GITHUB_REF_TYPE',
      'NPM_TOKEN',
      'npm run package:mac',
      'DSH_MACOS_DMG_NOTARY_RESULT_FILE',
      'macos-dmg-evidence',
      'npm run smoke:updater',
      'npm run smoke:community:packaged',
      'npm run smoke:macos:installer',
      'npm run measure:featured-plugins',
      'macos-installer-evidence',
      'npm run smoke:native-host',
      'npm run smoke:native-host:dialogs',
      'native-host-window-evidence',
      'native-host-dialogs-evidence',
      'xcrun stapler validate',
      'spctl --assess --type execute',
      'apple-notary-history.json',
      'DSH_LIVE_MODEL_RESULT_FILE=',
      'live-model-evidence/result.json',
      'DSH_RELEASE_COMMIT_SHA:',
      'DSH_MACOS_INSTALLER_RESULT_FILE',
      'DSH_NATIVE_HOST_WINDOW_RESULT_FILE',
      'DSH_NATIVE_HOST_DIALOGS_RESULT_FILE',
      'DEEPSEEK_API_KEY',
      'test -n "$DEEPSEEK_API_KEY"',
      'npm run release:verify:mac -- --require-evidence',
    ];
    const macPackageScripts = `${scripts['package:mac:project'] || ''}\n${scripts['package:mac:x64:project'] || ''}`;
    checks.push(check(
      'mac_release_evidence_workflow',
      macWorkflowRequirements.every((fragment) => macEvidenceWorkflow.includes(fragment))
        && macEvidenceWorkflow.includes('release/*.yml')
        && macEvidenceWorkflow.includes('release/*.blockmap')
        && macPackageScripts.includes('check:update-artifacts:mac')
        && macPackageScripts.includes('scripts/notarize-macos-app.mjs')
        && macPackageScripts.includes('scripts/notarize-macos-dmg.mjs') ? 'pass' : 'block',
      'macOS 发行证据 workflow 必须覆盖签名、公证、更新器元数据和社区打包 smoke',
      '.github/workflows/macos-release-evidence.yml',
    ));
  }
  if (scope === 'all' || scope === 'windows') {
    checks.push(check(
      'windows_release_configuration',
      String(scripts['package:win:project'] || '').includes('forceCodeSigning=true') ? 'pass' : 'block',
      '正式 Windows 构建强制代码签名',
      'electron/package.json',
    ));
    const windowsEvidenceWorkflow = readText(join(root, '.github', 'workflows', 'windows-release-evidence.yml'));
    const windowsPackageScripts = `${scripts['package:win:project'] || ''}\n${scripts['package:win:unsigned:project'] || ''}`;
    const windowsWorkflowRequirements = [
      'workflow_dispatch:',
      'WIN_CSC_LINK:',
      'WIN_CSC_KEY_PASSWORD:',
      'Validate release ref and credentials',
      'GITHUB_REF_TYPE',
      'NPM_TOKEN',
      'npm run package:win',
      'DSH_RELEASE_COMMIT_SHA:',
      'npm run measure:featured-plugins',
      'smoke:win:acceptance',
      'npm run smoke:native-host',
      'npm run smoke:native-host:dialogs',
      'native-host-window-evidence',
      'native-host-dialogs-evidence',
      'DSH_NATIVE_HOST_WINDOW_RESULT_FILE',
      'DSH_NATIVE_HOST_DIALOGS_RESULT_FILE',
      'release:verify:win -- --require-evidence',
    ];
    checks.push(check(
      'windows_release_evidence_workflow',
      windowsWorkflowRequirements.every((fragment) => windowsEvidenceWorkflow.includes(fragment))
        && windowsEvidenceWorkflow.includes('release/*.yml')
        && windowsEvidenceWorkflow.includes('release/*.blockmap')
        && windowsPackageScripts.includes('check:update-artifacts:win') ? 'pass' : 'block',
      'Windows 发行证据 workflow 必须覆盖签名、更新器元数据、安装器验收和 Authenticode 校验',
      '.github/workflows/windows-release-evidence.yml',
    ));
  }
  return checks;
}

function inspectMacBundle(appPath, { root = DEFAULT_ROOT, requireEvidence = false } = {}) {
  if (!appPath || !existsSync(appPath)) {
    return [check('mac_artifact', 'block', '找不到待发布 macOS .app', appPath || null)];
  }
  const signatureDetail = run('codesign', ['-dv', '--verbose=4', appPath]);
  const signature = classifyMacSignatureOutput(signatureDetail.output);
  const strict = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  const stapler = run('xcrun', ['stapler', 'validate', appPath]);
  return [
    check(
      'mac_developer_id_signature',
      signature.signed_for_distribution ? 'pass' : 'block',
      signature.signed_for_distribution
        ? `Developer ID 签名，Team ${signature.team_identifier}`
        : signature.adhoc ? '当前产物只有 adhoc 临时签名' : '当前产物没有可确认的 Developer ID 签名',
      signatureDetail.output.slice(0, 1_000),
    ),
    check('mac_signature_integrity', strict.ok ? 'pass' : 'block', 'codesign 严格校验', strict.output.slice(0, 1_000)),
    check('mac_gatekeeper', gatekeeper.ok ? 'pass' : 'block', 'Gatekeeper 接受待发布 App', gatekeeper.output.slice(0, 1_000)),
    check('mac_notarization_ticket', stapler.ok ? 'pass' : 'block', 'Apple 公证票据已附加或可验证', stapler.output.slice(0, 1_000)),
    ...inspectMacEvidenceReceipts(root, appPath, { requireEvidence }),
  ];
}

function inspectWindowsBundle(root, appPath, { requireEvidence = false } = {}) {
  const receiptPath = join(root, 'release', 'windows-x64-acceptance.json');
  const receipt = readJson(receiptPath);
  const checks = [check(
    'windows_installer_environment_acceptance',
    isWindowsAcceptanceReceipt(receipt) ? 'pass' : 'block',
    'Windows x64 运行环境需要保存完整的安装、启动、断网 Profile、恢复、权限边界、清理和卸载自动验收回执；物理设备另走 release-device Eval',
    receiptPath,
  )];
  if (process.platform !== 'win32') {
    checks.push(check('windows_code_signature', 'manual', 'Windows 签名只能在 Windows 产物或实机上验证', appPath || null));
    if (requireEvidence) checks.push(...inspectWindowsNativeHostReceipts(root, appPath, { requireEvidence }));
    return checks;
  }
  if (!appPath || !existsSync(appPath)) {
    checks.push(check('windows_code_signature', 'block', '找不到待发布 Windows 可执行文件', appPath || null));
    if (requireEvidence) checks.push(...inspectWindowsNativeHostReceipts(root, appPath, { requireEvidence }));
    return checks;
  }
  const command = `(Get-AuthenticodeSignature -FilePath '${String(appPath).replaceAll("'", "''")}').Status`;
  const signature = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
  checks.push(check(
    'windows_code_signature',
    signature.ok && /Valid/i.test(signature.output) ? 'pass' : 'block',
    'Windows Authenticode 签名有效',
    signature.output,
  ));
  if (requireEvidence) checks.push(...inspectWindowsNativeHostReceipts(root, appPath, { requireEvidence }));
  return checks;
}

export function inspectReleaseSafety({
  root = DEFAULT_ROOT,
  scope = 'all',
  staticOnly = false,
  appPath = null,
  requireEvidence = false,
} = {}) {
  const normalizedRoot = resolve(root);
  const checks = staticChecks(normalizedRoot, scope, { requireMeasurement: requireEvidence && !staticOnly });
  if (!staticOnly && (scope === 'all' || scope === 'macos')) {
    checks.push(...inspectMacBundle(resolve(appPath || join(normalizedRoot, 'release', 'mac-arm64', 'DSH Desktop.app')), {
      root: normalizedRoot,
      requireEvidence,
    }));
  }
  if (!staticOnly && (scope === 'all' || scope === 'windows')) {
    checks.push(...inspectWindowsBundle(normalizedRoot, appPath ? resolve(appPath) : null, { requireEvidence }));
  }
  const summary = {
    pass: checks.filter((item) => item.status === 'pass').length,
    block: checks.filter((item) => item.status === 'block').length,
    manual: checks.filter((item) => item.status === 'manual').length,
  };
  return {
    version: 'dsh.release-safety.v1',
    checked_at: new Date().toISOString(),
    scope,
    static_only: staticOnly,
    ready: summary.block === 0 && summary.manual === 0,
    summary,
    checks,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(arg('root', DEFAULT_ROOT));
  const scope = arg('scope', 'all');
  if (!new Set(['all', 'macos', 'windows']).has(scope)) throw new Error(`未知检查范围：${scope}`);
  const report = inspectReleaseSafety({
    root,
    scope,
    staticOnly: hasFlag('static'),
    appPath: arg('app'),
    requireEvidence: hasFlag('require-evidence'),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready && !hasFlag('allow-blockers')) process.exitCode = 1;
}
