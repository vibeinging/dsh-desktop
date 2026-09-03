window.__ModuleLoader__.load({
  id: "@vibeinging/dsh-desktop-chrome",
  factory() {
    const inject = [];
    const titlebarHeight = 36;
    const overlayMargin = 12;
    const titlebarId = "dsh-desktop-titlebar";
    const css = `
html[data-dsh-desktop-chrome="mac"] #root {
  box-sizing: border-box;
  height: 100vh;
  padding-top: ${titlebarHeight}px;
}

html[data-dsh-desktop-chrome="mac"] [data-dsh-panel] {
  padding-top: ${titlebarHeight}px;
}

html[data-dsh-desktop-chrome="mac"] [data-dsh-toggle-cluster] {
  top: ${titlebarHeight + 3}px;
}

html[data-dsh-desktop-chrome="mac"] body > [role="menu"] {
  max-height: calc(100dvh - ${titlebarHeight + (overlayMargin * 2)}px);
}

#${titlebarId} {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 2147483000;
  box-sizing: border-box;
  height: ${titlebarHeight}px;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #f4f5f8));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(18 25 38 / 10%));
  -webkit-app-region: drag;
  user-select: none;
}

@media (prefers-color-scheme: dark) {
  #${titlebarId} {
    background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #19191d));
    border-bottom-color: var(--dsw-alias-border-l1, rgb(255 255 255 / 8%));
  }
}
`;
    function supportsIntegratedDesktopChrome({ userAgent = "", platform = "" } = {}) {
      return /Electron\//.test(userAgent) && /Mac/i.test(platform || userAgent);
    }
    function installDesktopChrome({ document: documentRef = document, navigator: navigatorRef = navigator } = {}) {
      if (!supportsIntegratedDesktopChrome(navigatorRef)) return () => {};

      const root = documentRef.documentElement;
      const style = documentRef.createElement("style");
      const titlebar = documentRef.createElement("div");
      style.dataset.dshDesktopChromeStyle = "true";
      style.textContent = css;
      titlebar.id = titlebarId;
      titlebar.dataset.dshDesktopTitlebar = "true";
      titlebar.setAttribute("aria-hidden", "true");
      root.dataset.dshDesktopChrome = "mac";
      documentRef.head.append(style);
      documentRef.body.prepend(titlebar);

      return () => {
        titlebar.remove();
        style.remove();
        delete root.dataset.dshDesktopChrome;
      };
    }
    function apply(ctx) {
      ctx.effect(
        () => installDesktopChrome(),
        "dsh desktop chrome: macOS title-bar safe area",
      );
    }
    return { apply, inject };
  },
});
