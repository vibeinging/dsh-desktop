/** Compact desktop chrome with a non-modal projection of Electron's update state. */

export const DESKTOP_TITLEBAR_HEIGHT = 36;
export const DESKTOP_TITLEBAR_ID = "dsh-desktop-titlebar";

export const desktopChromeCss = `
html, body { margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }

#${DESKTOP_TITLEBAR_ID} {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 2147483000;
  box-sizing: border-box;
  height: ${DESKTOP_TITLEBAR_HEIGHT}px;
  background: transparent;
  -webkit-app-region: drag;
  user-select: none;
}

#${DESKTOP_TITLEBAR_ID} .dsh-update {
  position: absolute;
  top: 5px;
  right: 12px;
  -webkit-app-region: no-drag;
  font-family: inherit;
  font-size: 12px;
  color: var(--dsw-alias-text-primary, #272933);
}
#${DESKTOP_TITLEBAR_ID} .dsh-update[hidden] { display: none; }
.dsh-update-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease-out, border-color 140ms ease-out;
}
.dsh-update-button:hover { background: rgb(110 115 135 / 10%); }
.dsh-update-button[data-available="true"] {
  color: #4054a6;
  background: #e9edf9;
  border-color: #d6dff4;
}
.dsh-update-button[data-available="true"]:hover { background: #dce4f8; }
.dsh-update-button:focus-visible, .dsh-update-notes:focus-visible {
  outline: 2px solid #6f83cb;
  outline-offset: 3px;
}
.dsh-update-button:disabled { cursor: default; opacity: .72; }
.dsh-update-icon { width: 13px; height: 13px; flex: none; }
.dsh-update-label { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-update-popover {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  width: 360px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1, #dddfe7);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #fbfbfd);
  color: var(--dsw-alias-text-primary, #272933);
  box-shadow: 0 12px 38px rgb(25 29 45 / 14%), 0 2px 6px rgb(25 29 45 / 5%);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  transition: opacity 150ms cubic-bezier(.22,1,.36,1), transform 150ms cubic-bezier(.22,1,.36,1), visibility 150ms;
  user-select: text;
  overflow: hidden;
}
.dsh-update[data-open="true"] .dsh-update-popover { opacity: 1; visibility: visible; transform: none; }
.dsh-update-heading { padding: 17px 18px 13px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e8e9ef); }
.dsh-update-title { margin: 0 0 5px; font-size: 14px; font-weight: 600; line-height: 1.4; }
.dsh-update-version { margin: 0; font-size: 11px; color: var(--dsw-alias-text-secondary, #717582); }
.dsh-update-notes {
  box-sizing: border-box;
  max-height: 350px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px 18px 17px;
  font-size: 12px;
  line-height: 1.75;
  white-space: normal;
  overflow-wrap: anywhere;
}
.dsh-update-notes :first-child { margin-top: 0; }
.dsh-update-notes :last-child { margin-bottom: 0; }
.dsh-update-notes h1, .dsh-update-notes h2, .dsh-update-notes h3, .dsh-update-notes h4 {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.4;
}
.dsh-update-notes h1 { font-size: 14px; }
.dsh-update-notes h2, .dsh-update-notes h3, .dsh-update-notes h4 { font-size: 13px; }
.dsh-update-notes p { margin: 6px 0; }
.dsh-update-notes ul, .dsh-update-notes ol { margin: 6px 0; padding-left: 20px; }
.dsh-update-notes li { margin: 2px 0; }
.dsh-update-notes code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  background: rgb(110 115 135 / 12%);
  border-radius: 4px;
  padding: 0 3px;
}
.dsh-update-notes pre {
  margin: 8px 0;
  padding: 8px 10px;
  overflow: auto;
  background: rgb(110 115 135 / 10%);
  border-radius: 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.dsh-update-notes pre code { background: transparent; padding: 0; }
.dsh-update-notes a { color: #4054a6; text-decoration: underline; }
.dsh-update-notes blockquote { margin: 6px 0; padding-left: 12px; border-left: 2px solid rgb(110 115 135 / 30%); color: var(--dsw-alias-text-secondary, #717582); }
.dsh-update-footer {
  margin: 0;
  padding: 11px 18px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e8e9ef);
  color: var(--dsw-alias-text-secondary, #717582);
  font-size: 11px;
  line-height: 1.5;
}
.dsh-update-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

@media (prefers-color-scheme: dark) {
  #${DESKTOP_TITLEBAR_ID} {
    background: transparent;
  }
  #${DESKTOP_TITLEBAR_ID} .dsh-update { color: var(--dsw-alias-text-primary, #e1e3eb); }
  .dsh-update-button[data-available="true"] { color: #c0ccff; background: #2a3046; border-color: #3c4667; }
  .dsh-update-button[data-available="true"]:hover { background: #343e5b; }
  .dsh-update-popover { background: var(--dsw-alias-bg-base, #222329); color: var(--dsw-alias-text-primary, #e1e3eb); border-color: var(--dsw-alias-border-l1, #3b3d48); }
  .dsh-update-heading, .dsh-update-footer { border-color: var(--dsw-alias-border-l1, #3b3d48); }
  .dsh-update-version, .dsh-update-footer { color: var(--dsw-alias-text-secondary, #aaaeba); }
  .dsh-update-notes code { background: rgb(255 255 255 / 10%); }
  .dsh-update-notes pre { background: rgb(255 255 255 / 7%); }
  .dsh-update-notes a { color: #c0ccff; }
  .dsh-update-notes blockquote { border-color: rgb(255 255 255 / 22%); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-update-button, .dsh-update-popover { transition: none; }
}
`;

/** Project updater states to a single explicit action and its accompanying explanation. */
export function updatePresentation(state) {
  const version = String(state?.latest?.version || "");
  const percent = Math.min(100, Math.max(0, Math.round(Number(state?.progress?.percent) || 0)));
  const variants = {
    available: { label: `更新 ${version}`, title: "有新版本可用", hint: "点击更新按钮后下载并安装，完成后应用会重启。", action: "install" },
    checking: { label: "检查中…", title: "正在检查更新", hint: "检查完成后会在这里显示结果。" },
    downloading: { label: `下载中 ${percent}%`, title: "正在下载更新", hint: "下载完成并通过配置检查后，应用会自动安装并重启。" },
    downloaded: { label: "准备更新…", title: "正在检查应用配置", hint: "检查通过后会安装更新并重启。" },
    installing: { label: "正在更新…", title: "正在安装更新", hint: "应用即将重新启动。" },
    blocked: { label: "更新已暂停", title: "更新已暂停", hint: "处理插件配置后，点击按钮重新检查更新。", action: "check" },
    error: { label: "重试更新", title: "暂时无法完成更新", hint: "点击按钮重新检查更新。", action: "check" },
    "up-to-date": { label: "检查更新", title: "已是最新版本", hint: "点击按钮可再次检查。", action: "check" },
    idle: { label: "检查更新", title: "应用更新", hint: "点击按钮检查是否有新版本。", action: "check" },
  };
  return { ...(variants[state?.status] || variants.idle), version, available: state?.status === "available" };
}

/** Escape text that will be embedded inside generated release-note HTML. */
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Return a link target only for the http(s) loopback-free web, never javascript: or data:. */
function safeNoteHref(value) {
  const href = String(value || "").trim();
  if (/^https?:\/\/[^/\s]+\S*$/i.test(href)) return href;
  return null;
}

const NOTE_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "IMG", "LINK", "META", "INPUT", "BUTTON", "FORM", "VIDEO", "AUDIO", "CANVAS"]);
const NOTE_HTML_BLOCK = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE", "BLOCKQUOTE"]);
const NOTE_HTML_INLINE = new Set(["STRONG", "B", "EM", "I", "CODE", "A", "BR", "SPAN"]);

/** Serialize one remote HTML node as generated tags; text is escaped and only safe nodes survive. */
function serializeNoteNode(node) {
  if (node.nodeType === 3) return escapeHtmlText(node.textContent || "");
  if (NOTE_SKIP_TAGS.has(node.nodeName)) return "";
  if (node.nodeName === "BR") return "<br>";
  const inline = NOTE_HTML_INLINE.has(node.nodeName);
  const block = NOTE_HTML_BLOCK.has(node.nodeName);
  if (!inline && !block) {
    // Unknown container: keep its text but drop the tag and any of its attributes.
    return [...node.childNodes].map(serializeNoteNode).join("");
  }
  const tag = node.nodeName.toLowerCase();
  let open = `<${tag}>`;
  if (tag === "a") {
    const href = safeNoteHref(node.getAttribute?.("href"));
    open = href ? `<a href="${escapeHtmlText(href)}">` : "";
  }
  const inner = [...node.childNodes].map(serializeNoteNode).join("");
  if (!open) return inner;
  const close = `</${tag}>`;
  if (tag === "li") return `\n  <li>${inner.trim()}</li>`;
  if (block) return `\n${open}${inner}${close}`;
  return open + inner + close;
}

/** Convert one plain-Markdown source into generated safe HTML tags (the source HTML is escaped first). */
export function renderMarkdownNotes(value) {
  const raw = String(value || "").slice(0, 65_536);
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = [];
  let codeBlock = null;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInlineMarkdown(paragraph.join("\n"))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    out.push(`\n<ul>\n${list.map((item) => `  <li>${renderInlineMarkdown(item)}</li>`).join("\n")}\n</ul>`);
    list = [];
  };
  const pushBlock = (block) => { flushParagraph(); flushList(); out.push(block); };
  for (const originalLine of lines) {
    const line = originalLine.replace(/\s+$/g, "");
    if (codeBlock !== null) {
      if (/^```/.test(line)) { pushBlock(`\n<pre><code>${escapeHtmlText(codeBlock.join("\n"))}</code></pre>`); codeBlock = null; }
      else codeBlock.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushParagraph(); flushList(); codeBlock = []; continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      flushParagraph(); flushList();
      out.push(`\n<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^\s{0,3}([-*+])\s+(.*)$/);
    if (item) { flushParagraph(); list.push(item[2]); continue; }
    if (list.length > 0) { flushList(); }
    if (/^\s*$/.test(line)) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  if (codeBlock !== null) pushBlock(`\n<pre><code>${escapeHtmlText(codeBlock.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  return out.join("\n").trim();
}

/** Apply the safe inline Markdown subset to already line-level text (source HTML escaped first). */
function renderInlineMarkdown(value) {
  const text = escapeHtmlText(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, href) => {
      const target = safeNoteHref(href);
      return target ? `<a href="${escapeHtmlText(target)}">${label}</a>` : label;
    });
  return text
    .replace(/(?<![\t ])[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert remote release HTML or Markdown to safe HTML; remote scripts, images and styles never run. */
export function renderReleaseNotes(value, documentRef = document) {
  const raw = String(value || "").slice(0, 65_536);
  const looksLikeHtml = /<\/?(?:h[1-6]|p|ul|ol|li|div|br|pre|code|strong|em|a|blockquote)\b[^<>]*>/i.test(raw);
  if (looksLikeHtml && typeof documentRef?.createElement === "function") {
    try {
      const template = documentRef.createElement("template");
      template.innerHTML = raw;
      if (template.content?.childNodes?.length) {
        return [...template.content.childNodes].map(serializeNoteNode).join("").replace(/\n{3,}/g, "\n\n").trim();
      }
    } catch {
      // Without a working HTML parser the generated Markdown path below still escapes everything.
    }
  }
  return renderMarkdownNotes(raw);
}

/** Mount the updater button inside the trusted Host view; the official DSH page never receives the bridge. */
export function installUpdateButton({ document: documentRef = document, api, titlebar }) {
  const abort = new AbortController();
  const root = documentRef.createElement("div");
  root.className = "dsh-update";
  root.hidden = true;
  root.dataset.open = "false";
  const button = documentRef.createElement("button");
  button.className = "dsh-update-button";
  button.type = "button";
  button.setAttribute("aria-describedby", "dsh-update-popover");
  const icon = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("class", "dsh-update-icon");
  icon.setAttribute("aria-hidden", "true");
  const stroke = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  stroke.setAttribute("d", "M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3");
  stroke.setAttribute("fill", "none");
  stroke.setAttribute("stroke", "currentColor");
  stroke.setAttribute("stroke-width", "1.4");
  stroke.setAttribute("stroke-linecap", "round");
  stroke.setAttribute("stroke-linejoin", "round");
  icon.append(stroke);
  const label = documentRef.createElement("span");
  label.className = "dsh-update-label";
  button.append(icon, label);
  const popover = documentRef.createElement("section");
  popover.id = "dsh-update-popover";
  popover.className = "dsh-update-popover";
  popover.setAttribute("role", "tooltip");
  const heading = documentRef.createElement("header");
  heading.className = "dsh-update-heading";
  const title = documentRef.createElement("h2");
  title.className = "dsh-update-title";
  const version = documentRef.createElement("p");
  version.className = "dsh-update-version";
  heading.append(title, version);
  const notes = documentRef.createElement("div");
  notes.className = "dsh-update-notes";
  notes.tabIndex = 0;
  notes.setAttribute("aria-label", "更新日志");
  const footer = documentRef.createElement("p");
  footer.className = "dsh-update-footer";
  const status = documentRef.createElement("span");
  status.className = "dsh-update-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  popover.append(heading, notes, footer);
  root.append(button, popover, status);
  titlebar.removeAttribute("aria-hidden");
  titlebar.append(root);
  let state = null;
  let lastLayout = "";
  let hoverTimer;
  let operation = false;
  let generation = 0;
  let lastNotes = "";
  const reportLayout = () => {
    const expanded = root.dataset.open === "true";
    const layout = {
      expanded,
      contentHeight: 60 + heading.offsetHeight + Math.min(350, notes.scrollHeight) + footer.offsetHeight,
    };
    const serialized = JSON.stringify(layout);
    if (serialized !== lastLayout) { lastLayout = serialized; api.layout(layout); }
  };
  const show = () => { clearTimeout(hoverTimer); root.dataset.open = "true"; reportLayout(); };
  const hide = () => { clearTimeout(hoverTimer); root.dataset.open = "false"; reportLayout(); };
  const constrainNotes = () => {
    if (root.dataset.open === "true") {
      notes.style.maxHeight = `${Math.min(350, Math.max(60, documentRef.defaultView.innerHeight - heading.offsetHeight - footer.offsetHeight - 60))}px`;
    }
  };
  documentRef.defaultView.addEventListener("resize", constrainNotes, { signal: abort.signal });
  root.addEventListener("pointerenter", () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(show, 180);
  });
  root.addEventListener("pointerleave", () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (!root.contains(documentRef.activeElement)) hide();
    }, 160);
  });
  root.addEventListener("focusin", show);
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) hide();
  });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root.dataset.open === "true") {
      if (notes === documentRef.activeElement) button.focus();
      hide();
    }
  }, { signal: abort.signal });
  documentRef.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target)) hide();
  }, { signal: abort.signal });

  const render = (next) => {
    state = next;
    root.hidden = !state?.enabled;
    const view = updatePresentation(state);
    label.textContent = view.label;
    button.dataset.available = String(view.available);
    button.disabled = operation || !view.action;
    button.setAttribute("aria-label", view.available ? `下载并安装 ${view.version}，悬停查看更新日志` : view.label);
    title.textContent = view.title;
    version.textContent = `当前 ${state?.currentVersion || ""}${view.version ? `  /  最新 ${view.version}` : ""}`;
    const source = state?.latest?.notes || {};
    const text = state?.error || [...(source.features || []), ...(source.improvements || []), ...(source.fixes || [])].join("\n\n");
    if (text !== lastNotes) {
      lastNotes = text;
      const html = text ? renderReleaseNotes(text, documentRef) : "";
      if (html) notes.innerHTML = html;
      else notes.textContent = "暂无更新日志。";
    }
    footer.textContent = view.hint;
    const announcement = `${view.title}${view.available ? ` ${view.version}` : ""}`;
    if (status.textContent !== announcement) status.textContent = announcement;
    reportLayout();
  };
  const call = (method, payload = {}) => api[method](payload);
  const unsubscribe = api.subscribe((next) => {
    generation += 1;
    if (!abort.signal.aborted) render(next);
  });
  const stopFocus = api.onFocus(() => { button.focus(); show(); });
  const stopDismiss = api.onDismiss(hide);
  const initialGeneration = generation;
  void call("state").then((next) => {
    if (!abort.signal.aborted && generation === initialGeneration) render(next);
  }).catch(() => {
    if (!abort.signal.aborted && generation === initialGeneration) render({ enabled: true, status: "error", error: "暂时无法读取更新状态。" });
  });
  button.addEventListener("click", async (event) => {
    const action = updatePresentation(state).action;
    if (operation || !action) return;
    const requestedGeneration = ++generation;
    operation = true;
    button.disabled = true;
    // Pointer clicks should not leave the hover panel pinned by focus after leaving it.
    if (event.detail > 0) button.blur();
    try {
      const next = await call(action, action === "install" ? { version: state.latest.version } : {});
      if (!abort.signal.aborted && generation === requestedGeneration) render(next);
    } catch (error) {
      if (!abort.signal.aborted) render({ ...state, status: "error", error: error.message });
    } finally {
      operation = false;
      if (!abort.signal.aborted) render(state);
    }
  });
  return () => {
    abort.abort();
    unsubscribe();
    stopFocus();
    stopDismiss();
    clearTimeout(hoverTimer);
    root.remove();
  };
}

/** Mount only in the packaged local page, never on the official Web surface. */
if (typeof window !== "undefined" && window.dshAppUpdate) {
  const style = document.createElement("style");
  style.textContent = desktopChromeCss;
  document.head.append(style);
  const titlebar = document.createElement("div");
  titlebar.id = DESKTOP_TITLEBAR_ID;
  document.body.append(titlebar);
  const dispose = installUpdateButton({ api: window.dshAppUpdate, titlebar });
  window.addEventListener("pagehide", dispose, { once: true });
}
