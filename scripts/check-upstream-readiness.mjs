#!/usr/bin/env node
// 上游 DSH SDK 整体升级就绪检查（零依赖，node >= 24）。
//
// 三道门全部通过才可启动 server/package.json + packages/* + vendored tarballs 的整体升级：
//   G1 上游 SDK 稳定版已发布（@deepseek-ai/dsh 存在精确 stable 版本）
//   G2 dsh-better-sidebar 已有 peer 接受目标版本的发行版
//   G3 dshmarket 已有 peer 接受目标版本的发行版
//
// 用法：
//   npm run check:upstream-readiness              # 默认目标 0.2.0
//   node scripts/check-upstream-readiness.mjs --target=0.2.0
//
// 已知非阻塞项（升级时同步处理，不在门内）：
//   - @vibeinging/dsh-session-teams 为自家包，升级时放宽其精确 peer 钉
//   - ds-harness-remote 需 >= 0.4.14（peer 已无上界，稳定版可满足）
//   - @linxin666/dsh-client-ui-task-board 无 @deepseek-ai SDK peer

// ---------- 最小 semver（覆盖 peer range 常见形态；实现 node-semver 预发布排除规则） ----------

function parseSemver(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) throw new Error(`非法 semver: ${v}`);
  return {
    ma: Number(m[1]),
    mi: Number(m[2]),
    pa: Number(m[3]),
    pre: m[4] ? m[4].split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s)) : null,
  };
}

function cmpPre(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === 'number') {
      return -1;
    } else if (typeof y === 'number') {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function cmpSemver(a, b) {
  if (a.ma !== b.ma) return a.ma < b.ma ? -1 : 1;
  if (a.mi !== b.mi) return a.mi < b.mi ? -1 : 1;
  if (a.pa !== b.pa) return a.pa < b.pa ? -1 : 1;
  return cmpPre(a.pre, b.pre);
}

function evalComparator(t, op, bound) {
  const c = cmpSemver(t, bound);
  switch (op) {
    case '':
    case '=':
      return c === 0;
    case '>':
      return c > 0;
    case '>=':
      return c >= 0;
    case '<':
      return c < 0;
    case '<=':
      return c <= 0;
    case '^':
      if (bound.ma > 0) return t.ma === bound.ma && c >= 0;
      if (bound.mi > 0) return t.ma === 0 && t.mi === bound.mi && c >= 0;
      return t.ma === 0 && t.mi === 0 && t.pa === bound.pa && c >= 0;
    case '~':
      return t.ma === bound.ma && t.mi === bound.mi && c >= 0;
    default:
      return false;
  }
}

function satisfies(version, range) {
  const t = parseSemver(version);
  for (const rawSet of range.split('||')) {
    const set = rawSet.trim();
    if (set === '' || set === '*' || set === 'x') {
      if (!t.pre) return true;
      continue;
    }
    const comparators = [];
    let ok = true;
    for (const token of set.split(/\s+/)) {
      if (token === '*' || token === 'x') continue;
      const m = /^(\^|~|>=|<=|>|=)?v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(token);
      if (!m) {
        ok = false;
        break;
      }
      comparators.push({ op: m[1] ?? '', bound: parseSemver(token.replace(/^(\^|~|>=|<=|>|=)?v?/, '')) });
    }
    if (!ok || comparators.length === 0) continue;
    // 预发布排除规则：目标是预发布时，集合内须存在同 [major,minor,patch] 且带预发布的比较器
    if (t.pre) {
      const gate = comparators.some(
        (c) => c.bound.pre && c.bound.ma === t.ma && c.bound.mi === t.mi && c.bound.pa === t.pa,
      );
      if (!gate) continue;
    }
    if (comparators.every((c) => evalComparator(t, c.op, c.bound))) return true;
  }
  return false;
}

function selfTest() {
  const cases = [
    ['0.2.0-rc.1', '>=0.1.5-alpha.1', false],
    ['0.2.0-rc.1', '^0.1.7-rc.1', false],
    ['0.2.0-rc.1', '^0.1.5-rc.1', false],
    ['0.2.0', '>=0.1.5-alpha.1', true],
    ['0.2.0', '^0.1.7-rc.1', false],
    ['0.1.5-rc.1', '^0.1.2-alpha.2', false],
    ['0.1.5-rc.2', '<=0.1.5-rc.1', false],
    ['0.1.5-rc.2', '>=0.1.5-alpha.1', true],
    ['0.2.0', '>=0.1.1-rc.2 <0.1.2 || >=0.1.2-alpha.1 <=0.1.2-rc.1 || >=0.1.5-alpha.1', true],
    ['0.1.5-rc.1', '4.0.2', false],
    ['4.0.2', '4.0.2', true],
  ];
  for (const [v, r, want] of cases) {
    const got = satisfies(v, r);
    if (got !== want) {
      throw new Error(`semver 自检失败: satisfies('${v}', '${r}') = ${got}，期望 ${want}`);
    }
  }
}

// ---------- npm registry ----------

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  return res.json();
}

const registryUrl = (name, version) =>
  `https://registry.npmjs.org/${encodeURIComponent(name)}${version ? `/${version}` : ''}`;

// ---------- 门检查 ----------

async function checkSdkStable(target) {
  const tags = (await fetchJson(`https://registry.npmjs.org/-/package/${encodeURIComponent('@deepseek-ai/dsh')}/dist-tags`)) ?? {};
  const exact = await fetchJson(registryUrl('@deepseek-ai/dsh', target));
  const lines = [
    `@deepseek-ai/dsh dist-tags: latest=${tags.latest ?? '?'}  next=${tags.next ?? '?'}  alpha=${tags.alpha ?? '?'}`,
  ];
  if (exact) {
    lines.push(`G1 ✅ 稳定版 ${target} 已发布（发布时间 ${exact.time ?? '?'}）`);
    return { pass: true, lines };
  }
  lines.push(`G1 ❌ 稳定版 ${target} 尚未发布（仅有预发布时，semver 预发布规则下插件 peer 互不兼容）`);
  return { pass: false, lines };
}

async function checkPluginPeer(name, sdkTarget, label, scanCount = 12) {
  const packument = await fetchJson(registryUrl(name));
  if (!packument?.versions) {
    return { pass: false, lines: [`${label} ❌ 无法获取 ${name} 的 packument`] };
  }
  const versions = Object.keys(packument.versions)
    .filter((v) => !v.includes('-'))
    .sort((a, b) => cmpSemver(parseSemver(b), parseSemver(a)))
    .slice(0, scanCount);
  const detail = [];
  for (const v of versions) {
    const peers = packument.versions[v].peerDependencies ?? {};
    const sdkPeers = Object.entries(peers).filter(([k]) => k.startsWith('@deepseek-ai/dsh-'));
    if (sdkPeers.length === 0) {
      detail.push({ v, accepts: true, note: '无 SDK peer' });
      continue;
    }
    const failed = sdkPeers.filter(([, r]) => !satisfies(sdkTarget, r));
    detail.push({ v, accepts: failed.length === 0, failed });
  }
  const firstAccept = detail.find((d) => d.accepts);
  if (firstAccept) {
    return {
      pass: true,
      lines: [
        `${label} ✅ ${name}@${versions[0] ?? '?'} 可用（最新 ${scanCount} 个版本中 ${firstAccept.v} 的 SDK peer 接受 ${sdkTarget}${
          firstAccept.note ? `（${firstAccept.note}）` : ''
        }）`,
      ],
    };
  }
  const latestSdkPeers = detail[0]?.failed ?? [];
  return {
    pass: false,
    lines: [
      `${label} ❌ ${name}@${versions[0] ?? '?'} 最新版本仍不接受 ${sdkTarget}`,
      ...latestSdkPeers.slice(0, 3).map(([k, r]) => `      ${k}: ${r}`),
    ],
  };
}

// ---------- 主流程 ----------

const args = process.argv.slice(2);
const target = args.find((a) => a.startsWith('--target='))?.slice(9) ?? '0.2.0';
selfTest();

console.log(`上游 DSH SDK 升级就绪检查（目标 ${target}）`);
console.log('');

const results = [];
const g1 = await checkSdkStable(target);
results.push({ name: 'G1 上游稳定版', ...g1 });
const g2 = await checkPluginPeer('dsh-better-sidebar', target, 'G2');
results.push({ name: 'G2 dsh-better-sidebar', ...g2 });
const g3 = await checkPluginPeer('dshmarket', target, 'G3');
results.push({ name: 'G3 dshmarket', ...g3 });

for (const r of results) {
  console.log(r.lines.join('\n'));
  console.log('');
}

console.log('升级时同步处理（非门内）：自家 session-teams 放宽精确 peer；ds-harness-remote 升至 >= 0.4.14；');
console.log('决策项：0.2.0 默认 Web 组合不含自动化任务，需启用 @deepseek-ai/dsh-experimental-schedule-bundle。');
console.log('');

if (results.every((r) => r.pass)) {
  console.log(`✅ 三道门全部通过：可启动 ${target} 整体升级（server/package.json 全家 + packages/* + vendored tarballs）。`);
  process.exit(0);
}
const blocked = results.filter((r) => !r.pass).map((r) => r.name);
console.log(`❌ 未就绪，阻塞项：${blocked.join('、')}。保持 0.1.5-rc.1 钉版。`);
process.exit(1);
