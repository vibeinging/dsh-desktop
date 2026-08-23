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

const DSH_MARKET_DEPENDENCIES = Object.freeze({
  "js-yaml": "^4.1.0",
  undici: "^7.29.0",
});

const MULTIMEDIA_INPUT_DEPENDENCIES = Object.freeze({});

/** Return the exact dependency projection reviewed for the aggregate Client release. */
export function reviewedCommunityClientDependencies() {
  return DSH_WEB_UI_DEPENDENCIES;
}

/** Return the exact dependency projection reviewed for the task-board release. */
export function reviewedTaskBoardDependencies() {
  return TASK_BOARD_DEPENDENCIES;
}

/** Return the exact dependency projection reviewed for the default plugin market. */
export function reviewedDshMarketDependencies() {
  return DSH_MARKET_DEPENDENCIES;
}

/** Return the exact dependency projection reviewed for the multimedia input release. */
export function reviewedMultimediaInputDependencies() {
  return MULTIMEDIA_INPUT_DEPENDENCIES;
}

const REVIEWED_COMMUNITY_CLIENTS = Object.freeze(new Map([
  ["dshmarket", Object.freeze({
    version: "1.17.1",
    bundlePatch: "./cordis.patch.yml",
    dependencies: DSH_MARKET_DEPENDENCIES,
    integrity: "sha512-DQRK0dg0duXhDOqw6LWy5m6GkG3oLiTXC9pM6W9mi1gCbqM1ofgSPuyPOGCsE+06qHsiF65j/urpvCyvhhCPNw==",
    review: Object.freeze({
      session: "插件市场不读取 Session 内容；所有 Profile 变更由用户在市场界面确认",
      capabilities: Object.freeze([
        "读取和修改当前 DSH Profile",
        "通过受控 pnpm 安装、更新和卸载插件",
        "访问社区目录、npm、GitHub 和用户选择的备份服务",
      ]),
    }),
  })],
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
    version: "0.2.7",
    bundlePatch: "./cordis.patch.yml",
    dependencies: TASK_BOARD_DEPENDENCIES,
    integrity: "sha512-9Gnd12bcCtUTf4UVI0h5Bzm/fPwn+PEQqqi9+dt80wden0RwivpK7hzQ8VGRjImX5dGESAYFvkStNObEpC3bLA==",
    review: Object.freeze({
      session: "任务看板创建独立 DSH Session 执行任务，并读取 Workspace、Session 状态和完成历史",
      capabilities: Object.freeze([
        "读取当前 DSH Session 与 Workspace",
        "在 DSH_HOME 写入任务账本和执行记录",
        "按用户操作或 Host cron 启动 DSH Session 任务",
        "可选启动固定的系统防休眠 helper",
      ]),
    }),
  })],
  ["dsh-multimedia-webui-input", Object.freeze({
    version: "0.1.0",
    bundlePatch: "./cordis.patch.yml",
    dependencies: MULTIMEDIA_INPUT_DEPENDENCIES,
    integrity: "sha512-p79qgcvquYISotp4tU8ddnDuY3TBth8lG1Mwa6d5U74GCOrRA/jQpX724yar4SyBE4Dfiit2O2bN+Q+TSxBSHw==",
    review: Object.freeze({
      session: "附件只在用户发送时复制到当前 Session 工作区，发送失败保留草稿与待发送附件",
      capabilities: Object.freeze([
        "读取用户主动选择的文件和文件夹",
        "向当前 Session 工作区的 .dsh/tmp/attachments 写入附件",
        "按用户二次确认清理带插件所有权标记的附件目录",
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
  const normalized = actual ?? {};
  if (typeof normalized !== "object" || Array.isArray(normalized)) return false;
  const actualEntries = Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right));
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
