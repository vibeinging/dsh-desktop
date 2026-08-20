// Reviewed community Client releases are kept separate from the app-owned
// default list. They describe a preflight decision, not runtime state.

const DSH_WEB_UI_DEPENDENCIES = Object.freeze({
  "@linxin666/dsh-client-ui-community-plugins": "0.1.20",
  "@linxin666/dsh-client-ui-aionui-panel": "0.1.20",
  "@linxin666/dsh-client-ui-task-board": "0.1.20",
  "@linxin666/dsh-client-ui-git-graph": "0.1.20",
  "@linxin666/dsh-pet": "0.1.20",
  "@linxin666/dsh-remote-web-ui": "0.1.20",
  "@linxin666/dsh-live-stats": "0.1.20",
  "@linxin666/dsh-ssh": "0.1.20",
  "@linxin666/dsh-tool-describe-image": "0.1.20",
  "@linxin666/dsh-liangshen": "0.1.20",
  "@linxin666/dsh-client-ui-web-ui-settings": "0.1.20",
  "@linxin666/dsh-skins": "0.1.20",
  "@linxin666/dsh-client-ui-skin-center": "0.1.20",
});

/** Return the exact dependency projection reviewed for the aggregate Client release. */
export function reviewedCommunityClientDependencies() {
  return DSH_WEB_UI_DEPENDENCIES;
}

const REVIEWED_COMMUNITY_CLIENTS = Object.freeze(new Map([
  ["dshmarket", Object.freeze({ version: "1.9.0" })],
  ["@linxin666/dsh-web-ui-all", Object.freeze({
    version: "0.1.20",
    bundlePatch: "./cordis.patch.yml",
    dependencies: DSH_WEB_UI_DEPENDENCIES,
    review: Object.freeze({
      session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
      capabilities: Object.freeze([
        "读取本地仓库与图片",
        "启动 Git、SSH 与电源保持进程",
        "访问 SSH、远程 Web 和模型服务网络",
      ]),
    }),
  })],
]));

function sameDependencyManifest(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return actualEntries.length === expectedEntries.length
    && actualEntries.every(([name, version], index) => (
      name === expectedEntries[index][0] && version === expectedEntries[index][1]
    ));
}

/** Return whether an installed community Client matches the reviewed release. */
export function isReviewedCommunityClient(plugin) {
  const policy = REVIEWED_COMMUNITY_CLIENTS.get(plugin?.name);
  if (!policy || policy.version !== plugin?.manifest?.version) return false;
  if (policy.bundlePatch !== undefined && plugin?.manifest?.dsh?.bundle?.patch !== policy.bundlePatch) return false;
  if (policy.dependencies !== undefined
    && !sameDependencyManifest(plugin?.manifest?.dependencies, policy.dependencies)) return false;
  return true;
}

/** Return the reviewed capability projection for one exact community release. */
export function reviewedCommunityClientReview(plugin) {
  if (!isReviewedCommunityClient(plugin)) return null;
  return REVIEWED_COMMUNITY_CLIENTS.get(plugin?.name)?.review || null;
}
