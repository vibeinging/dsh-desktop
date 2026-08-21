# @vibeinging/dsh-work-product-host-ipc

This desktop-adapter Bundle exposes session-bound product services and narrow `browserWorkspaceHost`, `fileDialogHost`, and `windowHost` services. The Browser Workspace, native file dialogs, and window operations stay in Electron's trusted main process; the official Web and Client Bundles never receive a preload, Electron object, or generic IPC channel.

Browser methods accept only HTTP(S) targets, bounded tab identifiers, bounded layout values, and explicit session context. File dialogs accept only bounded titles, filters, and user-visible open operations; window methods are limited to reading state, focusing, minimizing, maximizing, and restoring. Unknown methods, unbound DSH Sessions, unsafe URLs, arbitrary paths, and JavaScript execution are rejected.

This private DSH Profile Bundle is the desktop transport adapter between the DSH child process and the DSH Desktop parent. It owns the correlated `product-request`, `product-cancel`, and `product-response` wire, then provides narrow Cordis services: `productHost` for project, context, Canvas, and structured UI capabilities, `officeArtifactHost` for Office artifact inspection, creation, and editing, and the native services described above.

Each official Web Agent announces its DSH Session to the parent for the lifetime of that Agent. An announced Session may use only the `DESKTOP_NATIVE_METHODS` allowlist; it does not become a dsh-work user, project, or App Session binding. Business ProductHost methods still require the separately authorized parent identity, and releasing the Agent removes the native-only authorization and aborts its pending native requests.

Feature Bundles consume those services and never import the desktop server, database, Renderer, Electron preload, or process wire. Every call carries the initiating DSH Session id and optional cancellation signal. The parent remains responsible for resolving the App Session, user, project, permissions, credentials, storage, and method allowlist.

This package is a `desktop-adapter`, not a portable official-Web plugin. It requires the Electron-owned parent IPC channel. The split keeps the consumer contracts independent from transport so a future published DSH ProductHost provider can replace this adapter without moving tool or UI behavior back into the shell.
