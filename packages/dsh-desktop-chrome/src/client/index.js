/** Browser half: a compact macOS Electron drag strip outside official Web content. */

export const inject = [];

export const DESKTOP_TITLEBAR_HEIGHT = 36;
export const DESKTOP_TITLEBAR_ID = "dsh-desktop-titlebar";

export const desktopChromeCss = `
html[data-dsh-desktop-chrome="mac"] #root {
  box-sizing: border-box;
  height: 100vh;
  padding-top: ${DESKTOP_TITLEBAR_HEIGHT}px;
}

#${DESKTOP_TITLEBAR_ID} {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 2147483000;
  box-sizing: border-box;
  height: ${DESKTOP_TITLEBAR_HEIGHT}px;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #f4f5f8));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgb(18 25 38 / 10%));
  -webkit-app-region: drag;
  user-select: none;
}

@media (prefers-color-scheme: dark) {
  #${DESKTOP_TITLEBAR_ID} {
    background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #19191d));
    border-bottom-color: var(--dsw-alias-border-l1, rgb(255 255 255 / 8%));
  }
}
`;

/** Return whether the current browser is the macOS Electron desktop host. */
export function supportsIntegratedDesktopChrome({ userAgent = "", platform = "" } = {}) {
  return /Electron\//.test(userAgent) && /Mac/i.test(platform || userAgent);
}

/** Install the title-bar node and its scoped stylesheet. */
export function installDesktopChrome({ document: documentRef = document, navigator: navigatorRef = navigator } = {}) {
  if (!supportsIntegratedDesktopChrome(navigatorRef)) return () => {};

  const root = documentRef.documentElement;
  const style = documentRef.createElement("style");
  const titlebar = documentRef.createElement("div");
  style.dataset.dshDesktopChromeStyle = "true";
  style.textContent = desktopChromeCss;
  titlebar.id = DESKTOP_TITLEBAR_ID;
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

/** Register the desktop chrome with the DSH Client lifecycle. */
export function apply(ctx) {
  ctx.effect(
    () => installDesktopChrome(),
    "dsh desktop chrome: macOS title-bar safe area",
  );
}
