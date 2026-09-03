/** Browser half: official Web slot contributions backed by DSH Workspaces. */

export function createWorktreeClient(React) {
  const { createElement: h, useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React;
  const inject = ["slots", "workspaces"];
  const route = "/dsh-worktree";
  const maxBranchLength = 120;
  const styleId = "dsh-worktree-client-style";
  const css = `
.dsh-worktree-view {
  container-type: inline-size;
  min-height: 100%;
  padding: clamp(18px, 3vw, 34px) clamp(16px, 4vw, 52px) 48px;
  overflow: auto;
  color: var(--dsw-alias-fg-base, #20232a);
  background: var(--dsw-alias-bg-base, #f7f7f9);
}
.dsh-worktree-shell { width: min(880px, 100%); margin: 0 auto; }
.dsh-worktree-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 13%));
}
.dsh-worktree-heading h2 {
  margin: 0;
  font: inherit;
  font-size: clamp(18px, 2.4vw, 24px);
  font-weight: 650;
  letter-spacing: -0.02em;
}
.dsh-worktree-heading p {
  max-width: 62ch;
  margin: 6px 0 0;
  color: var(--dsw-alias-fg-subtle, #686d78);
  font-size: 12px;
  line-height: 1.6;
}
.dsh-worktree-button,
.dsh-worktree-input {
  box-sizing: border-box;
  min-height: 32px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 16%));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.dsh-worktree-button {
  padding: 0 12px;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease;
}
.dsh-worktree-button:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l2, rgb(35 39 47 / 28%));
  background: var(--dsw-alias-bg-layer-2, #f0f1f4);
}
.dsh-worktree-button:focus-visible,
.dsh-worktree-input:focus-visible {
  outline: 2px solid var(--dsw-alias-focus-ring, #5474cc);
  outline-offset: 2px;
}
.dsh-worktree-button:disabled { cursor: default; opacity: 0.48; }
.dsh-worktree-button[data-primary="true"] {
  border-color: var(--dsw-alias-accent-solid, #3f5da8);
  background: var(--dsw-alias-accent-solid, #3f5da8);
  color: var(--dsw-alias-accent-solid-fg, #f8f9ff);
}
.dsh-worktree-button[data-danger="true"] {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-danger-fg, #b43c45);
}
.dsh-worktree-create { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 180ms cubic-bezier(.22, 1, .36, 1); }
.dsh-worktree-create[data-open="true"] { grid-template-rows: 1fr; }
.dsh-worktree-create-inner { min-height: 0; overflow: hidden; }
.dsh-worktree-form {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) auto auto;
  gap: 8px;
  padding: 16px 0 4px;
}
.dsh-worktree-input { width: 100%; padding: 0 10px; }
.dsh-worktree-status {
  min-height: 30px;
  padding: 12px 0;
  color: var(--dsw-alias-fg-subtle, #686d78);
  font-size: 12px;
  line-height: 1.55;
}
.dsh-worktree-status[data-error="true"] { color: var(--dsw-alias-danger-fg, #b43c45); }
.dsh-worktree-list { margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 13%)); }
.dsh-worktree-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  min-height: 66px;
  padding: 13px 0 13px 15px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 11%));
}
.dsh-worktree-row::before {
  content: "";
  position: absolute;
  inset: 18px auto 18px 0;
  width: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2, rgb(35 39 47 / 24%));
}
.dsh-worktree-row[data-current="true"]::before { background: var(--dsw-alias-accent-solid, #3f5da8); }
.dsh-worktree-row-main { min-width: 0; }
.dsh-worktree-row-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-worktree-row-title strong {
  overflow: hidden;
  color: var(--dsw-alias-fg-base, #20232a);
  font-size: 13px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-worktree-badge {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-accent-solid, #3f5da8) 11%, transparent);
  color: var(--dsw-alias-accent-fg, #34519a);
  font-size: 10px;
  font-weight: 600;
}
.dsh-worktree-path {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: var(--dsw-alias-fg-subtle, #686d78);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-worktree-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.dsh-worktree-empty {
  padding: 28px 0;
  color: var(--dsw-alias-fg-subtle, #686d78);
  font-size: 12px;
  line-height: 1.6;
}
.dsh-worktree-sidebar-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-fg-subtle, #686d78);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsh-worktree-sidebar-action:hover { background: var(--dsw-alias-bg-layer-2, #eceef2); color: var(--dsw-alias-fg-base, #20232a); }
.dsh-worktree-sidebar-action:focus-visible { outline: 2px solid var(--dsw-alias-focus-ring, #5474cc); outline-offset: 2px; }
.dsh-worktree-branch-mark { width: 14px; height: 14px; }
.dsh-worktree-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  pointer-events: auto;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, #f7f7f9) 38%, transparent);
}
.dsh-worktree-overlay-panel {
  position: relative;
  box-sizing: border-box;
  width: min(920px, calc(100% - 24px));
  max-width: 100%;
  height: 100%;
  border-left: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 13%));
  background: var(--dsw-alias-bg-base, #f7f7f9);
  box-shadow: -22px 0 52px rgb(22 26 35 / 12%);
}
.dsh-worktree-overlay-close {
  position: absolute;
  z-index: 2;
  top: 14px;
  right: 16px;
}
.dsh-worktree-overlay-empty { padding: 72px 44px; color: var(--dsw-alias-fg-subtle, #686d78); font-size: 13px; }
@container (max-width: 560px) {
  .dsh-worktree-heading, .dsh-worktree-row { grid-template-columns: 1fr; align-items: start; }
  .dsh-worktree-heading .dsh-worktree-button { justify-self: start; }
  .dsh-worktree-form { grid-template-columns: 1fr 1fr; }
  .dsh-worktree-form .dsh-worktree-input { grid-column: 1 / -1; }
  .dsh-worktree-actions { justify-content: flex-start; }
  .dsh-worktree-path { white-space: normal; overflow-wrap: anywhere; }
}
@media (max-width: 720px) {
  .dsh-worktree-overlay-panel { width: 100vw; }
}
@media (prefers-color-scheme: dark) {
  .dsh-worktree-view { color: var(--dsw-alias-fg-base, #e8e9ee); background: var(--dsw-alias-bg-base, #17181c); }
  .dsh-worktree-button, .dsh-worktree-input { background: var(--dsw-alias-bg-layer-1, #202126); }
}
`;

  let overlayOpen = false;
  const overlayListeners = new Set();
  const setOverlayOpen = (next) => {
    if (overlayOpen === next) return;
    overlayOpen = next;
    for (const listener of overlayListeners) listener();
  };
  const subscribeOverlay = (listener) => {
    overlayListeners.add(listener);
    return () => overlayListeners.delete(listener);
  };
  const useOverlayOpen = () => useSyncExternalStore(subscribeOverlay, () => overlayOpen, () => false);

  async function requestWorktrees(payload) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(data?.error || `Worktree 请求失败 (${response.status})`);
    return data;
  }

  function WorktreeRow({ row, workspace, busy, confirm, onOpen, onConfirm, onRemove }) {
    const current = row.active === true;
    const hasSessions = Boolean(workspace?.sessionIds?.length);
    return h("div", {
      className: "dsh-worktree-row",
      "data-current": current ? "true" : undefined,
      "data-testid": `dsh-worktree-row-${row.id}`,
    },
    h("div", { className: "dsh-worktree-row-main" },
      h("div", { className: "dsh-worktree-row-title" },
        h("strong", { title: row.branch }, row.branch),
        row.main ? h("span", { className: "dsh-worktree-badge" }, "主检出") : null,
        current ? h("span", { className: "dsh-worktree-badge" }, "当前会话") : null,
        hasSessions ? h("span", { className: "dsh-worktree-badge" }, `${workspace.sessionIds.length} 个会话`) : null,
      ),
      h("code", { className: "dsh-worktree-path", title: row.path }, row.path),
    ),
    h("div", { className: "dsh-worktree-actions" },
      h("button", {
        type: "button",
        className: "dsh-worktree-button",
        disabled: current || busy,
        onClick: () => onOpen(row.path),
        "data-testid": `dsh-worktree-open-${row.id}`,
      }, current ? "正在使用" : "打开会话"),
      row.main ? null : h("button", {
        type: "button",
        className: "dsh-worktree-button",
        "data-danger": "true",
        disabled: current || busy || hasSessions,
        title: hasSessions ? "先归档或移走关联会话，再删除 Worktree" : undefined,
        onClick: confirm ? () => onRemove(row) : () => onConfirm(row.path),
        "data-testid": `dsh-worktree-remove-${row.id}`,
      }, confirm ? "确认删除" : "删除"),
    ));
  }

  function WorktreeView({ sessionId, useWorkspaces, createWorkspace, deleteWorkspace, startSession }) {
    const workspaces = useWorkspaces((state) => state.items);
    const [snapshot, setSnapshot] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [branchName, setBranchName] = useState("");
    const [pending, setPending] = useState("");
    const [confirmPath, setConfirmPath] = useState("");

    const refresh = useCallback(async () => {
      setLoading(true);
      setError("");
      try {
        setSnapshot(await requestWorktrees({ action: "list", sessionId }));
      } catch (requestError) {
        setError(requestError?.message || String(requestError));
      } finally {
        setLoading(false);
      }
    }, [sessionId]);

    useEffect(() => {
      let alive = true;
      setLoading(true);
      setSnapshot(null);
      setError("");
      requestWorktrees({ action: "list", sessionId }).then((next) => {
        if (alive) setSnapshot(next);
      }).catch((requestError) => {
        if (alive) setError(requestError?.message || String(requestError));
      }).finally(() => {
        if (alive) setLoading(false);
      });
      return () => { alive = false; };
    }, [sessionId]);

    const workspaceByPath = useMemo(() => new Map(workspaces.map((workspace) => [workspace.path, workspace])), [workspaces]);
    const rows = useMemo(() => {
      if (!snapshot?.gitRepository || !snapshot.main) return [];
      return [
        { ...snapshot.main, id: "main", main: true },
        ...(Array.isArray(snapshot.items) ? snapshot.items.map((item) => ({ ...item, main: false })) : []),
      ];
    }, [snapshot]);

    const adoptAndOpen = async (path) => {
      const workspace = workspaceByPath.get(path) || await createWorkspace(path);
      startSession(workspace.workspaceId);
      return workspace;
    };

    const openPath = async (path) => {
      if (pending) return;
      setPending(`open:${path}`);
      setError("");
      try {
        await adoptAndOpen(path);
      } catch (openError) {
        setError(openError?.message || String(openError));
      } finally {
        setPending("");
      }
    };

    const submitCreate = async (event) => {
      event.preventDefault();
      if (pending) return;
      const branch = branchName.trim();
      if (branch.length > maxBranchLength) {
        setError(`分支名称不能超过 ${maxBranchLength} 个字符`);
        return;
      }
      setPending("create");
      setError("");
      let created = null;
      try {
        const result = await requestWorktrees({ action: "create", sessionId, branchName: branch || undefined });
        created = result.item;
        await adoptAndOpen(created.path);
        setBranchName("");
        setCreateOpen(false);
      } catch (createError) {
        if (created?.path) await requestWorktrees({ action: "remove", sessionId, path: created.path }).catch(() => {});
        setError(createError?.message || String(createError));
      } finally {
        setPending("");
      }
    };

    const removeRow = async (row) => {
      if (pending || row.active) return;
      const workspace = workspaceByPath.get(row.path);
      if (workspace?.sessionIds?.length) {
        setError("这个 Workspace 还有关联会话，不能删除 Worktree");
        return;
      }
      setPending(`remove:${row.path}`);
      setConfirmPath("");
      setError("");
      let registrationRemoved = false;
      try {
        if (workspace) {
          await deleteWorkspace(workspace.workspaceId);
          registrationRemoved = true;
        }
        await requestWorktrees({ action: "remove", sessionId, path: row.path });
        await refresh();
      } catch (removeError) {
        if (registrationRemoved) await createWorkspace(row.path).catch(() => {});
        setError(removeError?.message || String(removeError));
      } finally {
        setPending("");
      }
    };

    const busy = Boolean(pending);
    return h("section", { className: "dsh-worktree-view", "data-testid": "dsh-worktree-view" },
      h("div", { className: "dsh-worktree-shell" },
        h("header", { className: "dsh-worktree-heading" },
          h("div", null,
            h("h2", null, "Git Worktree"),
            h("p", null, "为独立任务创建隔离检出。每个 Worktree 会作为官方 Workspace 打开，不会改变当前会话的固定工作目录。"),
          ),
          h("button", {
            type: "button",
            className: "dsh-worktree-button",
            "data-primary": "true",
            disabled: busy || loading || snapshot?.gitRepository === false,
            onClick: () => {
              setCreateOpen((open) => !open);
              setError("");
            },
            "aria-expanded": createOpen,
            "data-testid": "dsh-worktree-create-toggle",
          }, createOpen ? "收起" : "新建 Worktree"),
        ),
        h("div", { className: "dsh-worktree-create", "data-open": createOpen ? "true" : undefined },
          h("div", { className: "dsh-worktree-create-inner" },
            h("form", { className: "dsh-worktree-form", onSubmit: submitCreate },
              h("input", {
                className: "dsh-worktree-input",
                value: branchName,
                maxLength: maxBranchLength + 1,
                placeholder: "分支名称，可留空自动生成",
                "aria-label": "Worktree 分支名称",
                disabled: busy,
                onChange: (event) => {
                  setBranchName(event.currentTarget.value);
                  setError("");
                },
                "data-testid": "dsh-worktree-branch-input",
              }),
              h("button", {
                type: "button",
                className: "dsh-worktree-button",
                disabled: busy,
                onClick: () => {
                  setCreateOpen(false);
                  setBranchName("");
                  setError("");
                },
              }, "取消"),
              h("button", {
                type: "submit",
                className: "dsh-worktree-button",
                "data-primary": "true",
                disabled: busy,
                "data-testid": "dsh-worktree-create-submit",
              }, pending === "create" ? "创建中" : "创建并打开"),
            ),
          ),
        ),
        h("div", {
          className: "dsh-worktree-status",
          "data-error": error ? "true" : undefined,
          role: error ? "alert" : "status",
          "aria-live": "polite",
        }, error || (loading ? "正在读取 Git Worktree" : "")),
        !loading && !error && snapshot?.gitRepository === false
          ? h("div", { className: "dsh-worktree-empty", "data-testid": "dsh-worktree-not-git" }, "当前会话目录不是 Git 仓库。请先从一个 Git Workspace 新建会话。")
          : null,
        rows.length > 0 ? h("div", { className: "dsh-worktree-list", "aria-busy": busy },
          ...rows.map((row) => h(WorktreeRow, {
            key: row.path,
            row,
            workspace: workspaceByPath.get(row.path),
            busy,
            confirm: confirmPath === row.path,
            onOpen: openPath,
            onConfirm: setConfirmPath,
            onRemove: removeRow,
          })),
        ) : null,
        !loading && !error && snapshot?.gitRepository && rows.length === 1
          ? h("div", { className: "dsh-worktree-empty", "data-testid": "dsh-worktree-empty" }, "还没有受管 Worktree。新建后会直接打开一个隔离会话。")
          : null,
      ),
    );
  }

  function BranchMark() {
    return h("svg", { className: "dsh-worktree-branch-mark", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
      h("circle", { cx: "4", cy: "3", r: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
      h("circle", { cx: "4", cy: "13", r: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
      h("circle", { cx: "12", cy: "5", r: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
      h("path", { d: "M4 4.5v7M5.5 10.5c4 0 5-1.8 5-4", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
    );
  }

  function WorktreeSidebarAction({ wide }) {
    useEffect(installStyle, []);
    return h("button", {
      type: "button",
      className: "dsh-worktree-sidebar-action",
      "aria-label": "打开 Git Worktree",
      onClick: () => setOverlayOpen(true),
      "data-testid": "dsh-worktree-sidebar-action",
    }, h(BranchMark), wide ? h("span", null, "Worktree") : null);
  }

  function WorktreeOverlay({ useSessions, useWorkspaces, createWorkspace, deleteWorkspace, startSession }) {
    const open = useOverlayOpen();
    const sessionId = useSessions((state) => state.current);
    useEffect(() => {
      if (!open) return undefined;
      const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setOverlayOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [open]);
    if (!open) return null;
    return h("div", {
      className: "dsh-worktree-overlay",
      role: "presentation",
      onMouseDown: (event) => {
        if (event.currentTarget === event.target) setOverlayOpen(false);
      },
      "data-testid": "dsh-worktree-overlay",
    },
    h("aside", { className: "dsh-worktree-overlay-panel", "aria-label": "Git Worktree 管理" },
      h("button", {
        type: "button",
        className: "dsh-worktree-button dsh-worktree-overlay-close",
        onClick: () => setOverlayOpen(false),
        "aria-label": "关闭 Git Worktree",
      }, "关闭"),
      sessionId
        ? h(WorktreeView, { sessionId, useWorkspaces, createWorkspace, deleteWorkspace, startSession })
        : h("div", { className: "dsh-worktree-overlay-empty" }, "请先在一个 Git Workspace 中打开会话，再管理 Worktree。"),
    ));
  }

  function installStyle(documentRef = document) {
    const style = documentRef.createElement("style");
    style.id = styleId;
    style.textContent = css;
    const previous = documentRef.getElementById(styleId);
    if (previous) previous.replaceWith(style);
    else documentRef.head.append(style);
    return () => style.remove();
  }

  function apply(ctx) {
    const workspaceActions = () => ({
      createWorkspace: (path) => ctx.workspaces.create({ path }),
      deleteWorkspace: (workspaceId) => ctx.workspaces.delete(workspaceId),
      startSession: (workspaceId) => ctx.workspaces.startSession(workspaceId),
    });
    ctx.slots.inject("conversation.view", () => ctx.slots.register({
      name: "conversation.view",
      id: "worktree",
      order: 20,
      label: () => "Worktree",
      inject: workspaceActions,
    }, WorktreeView));
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "worktree",
      order: 10,
    }, WorktreeSidebarAction));
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
      name: "shell.overlay",
      id: "worktree",
      order: 10,
      inject: workspaceActions,
    }, WorktreeOverlay));
  }

  return { apply, inject };
}
