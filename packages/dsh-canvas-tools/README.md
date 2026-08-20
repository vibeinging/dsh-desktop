# @vibeinging/dsh-canvas-tools

This DSH Profile Bundle contributes `canvas_inspect`, `canvas_create`, `canvas_edit`, and `canvas_suggest` to every Agent scope. The tools cover versioned documents, code Canvases, and local single-file HTML Sites. They consume `productHost` without importing product storage, the Renderer, Electron, or IPC transport.

The package owns schemas, tool presentation, DSH write approval, registration, and lifecycle cleanup. The desktop parent remains authoritative for the App Session, project, immutable version checks, suggestions, and storage. Another host can reuse the Bundle by providing compatible `canvasInspect`, `canvasCreate`, `canvasEdit`, and `canvasSuggest` methods.

This package remains a `desktop-adapter` until a non-desktop ProductHost provider can supply the same versioned artifact contract in an unmodified official Web Profile. OpenPencil remains the preferred community plugin for design-specific preview and editing; this Bundle does not duplicate that design surface.
