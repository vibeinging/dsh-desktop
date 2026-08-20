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

const TASK_BOARD_DEPENDENCIES = Object.freeze({
  schemastery: "^3.18.0",
});

/** Return the exact dependency projection reviewed for the aggregate Client release. */
export function reviewedCommunityClientDependencies() {
  return DSH_WEB_UI_DEPENDENCIES;
}

/** Return the exact dependency projection reviewed for the task-board release. */
export function reviewedTaskBoardDependencies() {
  return TASK_BOARD_DEPENDENCIES;
}

const REVIEWED_COMMUNITY_CLIENTS = Object.freeze(new Map([
  ["dshmarket", Object.freeze({ version: "1.9.0" })],
  ["@linxin666/dsh-web-ui-all", Object.freeze({
    version: "0.1.20",
    bundlePatch: "./cordis.patch.yml",
    dependencies: DSH_WEB_UI_DEPENDENCIES,
    integrity: "sha512-mPMXmPfO0rc/3hmv8Aw71UOJqTDVW2T3VWuN6dIgiMpDlRQp9O0BCaLh13j6LjH0WB9fAS+9DmUVix8sLLwNLA==",
    review: Object.freeze({
      session: "任务看板会读取 Session 与 Workspace，并可从看板启动 Agent 任务",
      capabilities: Object.freeze([
        "读取本地仓库与图片",
        "启动 Git、SSH 与电源保持进程",
        "访问 SSH、远程 Web 和模型服务网络",
      ]),
    }),
  })],
  ["@linxin666/dsh-client-ui-task-board", Object.freeze({
    version: "0.1.20",
    bundlePatch: "./cordis.patch.yml",
    dependencies: TASK_BOARD_DEPENDENCIES,
    integrity: "sha512-7Llft+DOb8aPX8wz+5CVtkK8YoZSVBPQech+0pS7F2+YYlzgp6NWL5mEjtXhIlSjTplNwi5GC3c6BD1DzYm3EA==",
    review: Object.freeze({
      session: "任务看板使用官方 DSH Session.prompt 启动任务，并读取当前 Workspace 状态",
      capabilities: Object.freeze([
        "读取当前 DSH Session 与 Workspace",
        "写入任务看板数据",
        "按用户操作启动 DSH Session 任务",
      ]),
    }),
  })],
  ["@linxin666/dsh-chat-recovery", Object.freeze({
    version: "0.2.5",
    bundlePatch: "./cordis.patch.yml",
    requiredDshRuntime: "0.1.0-rc.8",
    integrity: "sha512-vuPCcZfBgJijpVyNpb9VJgSuIB+7Zo+4RsZiDN3m6We3T7uekDcr1FlbcB4+xNKFCnxaJKCKb1ROBCoXbyCfbQ==",
    review: Object.freeze({
      session: "编辑和重试通过官方 Session fork 契约创建子 Session，原始历史保持不变",
      capabilities: Object.freeze([
        "读取当前会话的已完成消息",
        "按用户操作 fork 并重新提交文本消息",
        "在浏览器端监督可恢复错误的重试",
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
  if (policy.integrity !== undefined && plugin?.integrity !== policy.integrity) return false;
  return true;
}

/** Return the exact review policy for one community Client, without runtime state. */
export function reviewedCommunityClientPolicy(name) {
  return REVIEWED_COMMUNITY_CLIENTS.get(String(name || "")) || null;
}

/** Return the reviewed capability projection for one exact community release. */
export function reviewedCommunityClientReview(plugin) {
  if (!isReviewedCommunityClient(plugin)) return null;
  return REVIEWED_COMMUNITY_CLIENTS.get(plugin?.name)?.review || null;
}
