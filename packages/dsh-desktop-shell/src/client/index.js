/** Browser half: promotes the dshmarket plugin market to a first-class home panel
 * and adds a sidebar-footer share/star entry.
 *
 * dshmarket renders its whole market UI only as a settings section; on the desktop that
 * buries discovery behind 设置 while the home 插件 page manages installs. The market
 * service (ctx.provide("market") from dshmarket's client) hands the full panel to any
 * host that wants it in its own container, plus a switch for its settings section. This
 * bundle renders that panel as a main panel beside 插件 and retires the settings entry,
 * leaving 设置 → 插件 → 插件市场 tab as the market's own settings, as on dsh web.
 *
 * The footer action turns satisfied users into stars and word of mouth: one entry,
 * two menu items (open the repository, copy a share blurb).
 */

const REPO_URL = "https://github.com/vibeinging/dsh-desktop?utm_source=dsh-desktop-app";
const SHARE_TEXT = "DSH Desktop — DeepSeek Harness 桌面增强版：各种小编精选插件开箱即用——小鲸鱼记账、Worktree、上下文洞察…\nhttps://github.com/vibeinging/dsh-desktop";
const FOOTER_STYLE_ID = "dsh-desktop-shell-footer-style";
const FOOTER_CSS = `
.dsh-shell-footer-wrap { position: relative; display: inline-flex; }
.dsh-shell-footer-button {
  display: inline-flex; align-items: center; gap: 7px;
  min-height: 30px; padding: 0 8px; margin: 0;
  border: none; border-radius: 7px; background: transparent;
  color: var(--dsw-alias-fg-subtle, #686d78); font: inherit; font-size: 12px;
  white-space: nowrap; line-height: 1.4;
  cursor: pointer; transition: background-color 140ms ease, color 140ms ease;
}
.dsh-shell-footer-button:hover { background: var(--dsw-alias-bg-layer-2, rgb(35 39 47 / 8%)); color: var(--dsw-alias-fg-base, inherit); }
.dsh-shell-footer-button:focus-visible { outline: 2px solid var(--dsw-alias-focus-ring, #5474cc); outline-offset: 1px; }
/* 宿主环境可能给 svg 设大尺寸或不约束，双保险：CSS 锁定 + 组件里 svg 自带 width/height 属性。 */
.dsh-shell-footer-button svg, .dsh-shell-footer-wrap > svg, .dsh-shell-footer-menu svg {
  width: 16px; height: 16px; flex: 0 0 auto;
}
.dsh-shell-footer-menu {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 60;
  display: flex; flex-direction: column; width: max-content; min-width: 208px;
  padding: 4px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, rgb(35 39 47 / 14%));
  border-radius: 10px; line-height: 1.4;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 10px 28px rgb(15 18 24 / 16%);
}
.dsh-shell-footer-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border: none; border-radius: 7px;
  background: transparent; color: inherit; font: inherit; font-size: 12.5px;
  white-space: nowrap; text-decoration: none; cursor: pointer; text-align: left;
  width: 100%; box-sizing: border-box;
}
.dsh-shell-footer-item:hover { background: var(--dsw-alias-bg-layer-2, #f0f1f4); }
.dsh-shell-footer-item[data-ok="true"] { color: var(--dsw-alias-accent-fg, #34519a); }
@media (prefers-color-scheme: dark) {
  .dsh-shell-footer-menu { background: var(--dsw-alias-bg-layer-1, #202126); }
  .dsh-shell-footer-item:hover { background: var(--dsw-alias-bg-layer-2, #2a2b31); }
}
`;

export function createForkShellClient(React) {
  const { createElement: h, useCallback, useEffect, useRef, useState } = React;
  const inject = ["slots", "market"];
  const PANEL_ID = "dsh-market";

  // The registered component closes over the market service, so the element identity
  // stays stable per render and React reconciles the market tree instead of remounting.
  function panelFor(market) {
    return function MarketPanelPage() {
      return market.render();
    };
  }

  function MarketIcon() {
    return h("svg", { viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", "aria-hidden": "true" },
      h("path", { d: "M2.5 4.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
      h("path", { d: "M1.5 4.5h13L11 2H5L1.5 4.5Z", stroke: "currentColor", strokeWidth: "1.4", strokeLinejoin: "round" }),
      h("path", { d: "M6.5 8h3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
    );
  }

  function StarIcon() {
    return h("svg", { viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", "aria-hidden": "true" },
      h("path", {
        d: "M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8z",
        stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round",
      }));
  }

  function ShareIcon() {
    return h("svg", { viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", "aria-hidden": "true" },
      h("path", { d: "M11 5.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }),
      h("path", { d: "M10.5 2.5 13 5l-2.5 2.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }),
      h("path", { d: "M13 5H7.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }),
    );
  }

  function FooterShareAction({ wide }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const wrapRef = useRef(null);

    useEffect(() => {
      if (!open) return undefined;
      const onPointerDown = (event) => {
        if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
        document.removeEventListener("mousedown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [open]);

    useEffect(() => {
      if (!copied && !failed) return undefined;
      const message = copied || failed;
      const timer = setTimeout(() => { if (message === copied) setCopied(false); else setFailed(false); }, 1800);
      return () => clearTimeout(timer);
    }, [copied, failed]);

    const copyShare = useCallback(async () => {
      // navigator.clipboard rejects without a focused document (e.g. during automation);
      // fall back to the execCommand path so a user click always gets feedback.
      let ok = false;
      try {
        await navigator.clipboard.writeText(SHARE_TEXT);
        ok = true;
      } catch {
        try {
          const scratch = document.createElement("textarea");
          scratch.value = SHARE_TEXT;
          scratch.style.position = "fixed";
          scratch.style.opacity = "0";
          document.body.append(scratch);
          scratch.select();
          ok = document.execCommand("copy");
          scratch.remove();
        } catch {
          ok = false;
        }
      }
      setCopied(ok);
      setFailed(!ok);
    }, []);

    return h("div", { className: "dsh-shell-footer-wrap", ref: wrapRef },
      h("button", {
        type: "button",
        className: "dsh-shell-footer-button",
        "aria-haspopup": "menu",
        "aria-expanded": open ? "true" : "false",
        "aria-label": "分享与 Star",
        "data-testid": "dsh-shell-share-action",
        onClick: () => setOpen((value) => !value),
      }, h(StarIcon), wide ? h("span", null, "分享与 Star") : null),
      open ? h("div", { className: "dsh-shell-footer-menu", role: "menu", "data-testid": "dsh-shell-share-menu" },
        h("a", {
          className: "dsh-shell-footer-item",
          role: "menuitem",
          href: REPO_URL,
          target: "_blank",
          rel: "noopener noreferrer",
          onClick: () => setOpen(false),
        }, h(StarIcon), h("span", null, "给 DSH Desktop 加星")),
        h("button", {
          type: "button",
          className: "dsh-shell-footer-item",
          role: "menuitem",
          "data-ok": copied ? "true" : undefined,
          "data-testid": "dsh-shell-share-copy",
          onClick: () => { void copyShare(); },
        }, h(ShareIcon), h("span", null, copied ? "已复制，去粘贴吧" : failed ? "复制失败，再试一次" : "复制分享文案")),
      ) : null);
  }

  function installFooterStyle(documentRef = document) {
    let style = documentRef.getElementById(FOOTER_STYLE_ID);
    if (!style) {
      style = documentRef.createElement("style");
      style.id = FOOTER_STYLE_ID;
      style.textContent = FOOTER_CSS;
      documentRef.head.append(style);
    }
    return () => style.remove();
  }

  function apply(ctx) {
    const market = ctx.market;
    ctx.slots.inject("main", () => ctx.slots.register({
      name: "main",
      key: PANEL_ID,
    }, panelFor(market)));
    ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
      name: "sidebar.panellist",
      id: PANEL_ID,
      order: 12,
      label: () => "插件市场",
    }, MarketIcon));
    ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
      name: "sidebar.footer.action",
      id: "dsh-share-star",
      order: 30,
    }, FooterShareAction));
    ctx.effect(() => installFooterStyle(), "dsh desktop shell: footer share styles");
    try {
      market.setSettingsVisible(false);
    } catch {
      // A market build without the settings switch keeps both entries; harmless.
    }
  }

  return { apply, inject };
}
