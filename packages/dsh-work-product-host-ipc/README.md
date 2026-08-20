# @vibeinging/dsh-work-product-host-ipc

This desktop-adapter Bundle exposes session-bound product services and a narrow `browserWorkspaceHost` service. The Browser Workspace surface stays in Electron's trusted main process; the official Web and Client Bundles never receive a preload, Electron object, or generic IPC channel.

Browser methods accept only HTTP(S) targets, bounded tab identifiers, bounded layout values, and explicit session context. Unknown methods, unbound DSH Sessions, unsafe URLs, arbitrary paths, and JavaScript execution are rejected.

This private DSH Profile Bundle is the desktop transport adapter between the DSH child process and the DSH Desktop parent. It owns the correlated `product-request`, `product-cancel`, and `product-response` wire, then provides two narrow Cordis services: `productHost` for project, context, Canvas, and structured UI capabilities, and `officeArtifactHost` for Office artifact inspection, creation, and editing.

Feature Bundles consume those services and never import the desktop server, database, Renderer, Electron preload, or process wire. Every call carries the initiating DSH Session id and optional cancellation signal. The parent remains responsible for resolving the App Session, user, project, permissions, credentials, storage, and method allowlist.

This package is a `desktop-adapter`, not a portable official-Web plugin. It requires the Electron-owned parent IPC channel. The split keeps the consumer contracts independent from transport so a future published DSH ProductHost provider can replace this adapter without moving tool or UI behavior back into the shell.
