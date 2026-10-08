/** Browser half: promotes the dshmarket plugin market to a first-class home panel.
 *
 * dshmarket renders its whole market UI only as a settings section; on the desktop that
 * buries discovery behind 设置 while the home 插件 page manages installs. The market
 * service (ctx.provide("market") from dshmarket's client) hands the full panel to any
 * host that wants it in its own container, plus a switch for its settings section. This
 * bundle renders that panel as a main panel beside 插件 and retires the settings entry,
 * leaving 设置 → 插件 → 插件市场 tab as the market's own settings, as on dsh web.
 */

export function createForkShellClient(React) {
  const { createElement: h } = React;
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
    return h("svg", { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
      h("path", { d: "M2.5 4.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
      h("path", { d: "M1.5 4.5h13L11 2H5L1.5 4.5Z", stroke: "currentColor", strokeWidth: "1.4", strokeLinejoin: "round" }),
      h("path", { d: "M6.5 8h3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
    );
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
    try {
      market.setSettingsVisible(false);
    } catch {
      // A market build without the settings switch keeps both entries; harmless.
    }
  }

  return { apply, inject };
}
