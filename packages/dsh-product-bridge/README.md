# DeepSeek Harness Desktop App Product Bridge

English | [中文](README.zh.md)

This private Profile Bundle extends the official DSH Web Profile without importing or changing a DSH source checkout. It owns the App context, memory, and model-inheritance glue and no longer registers any Tool or workbench page. It consumes the session-addressed `productHost` service provided by `@deepseek-ai/dsh-work-product-host-ipc`; the separate `@deepseek-ai/dsh-project-tools` Bundle owns `project_list` and `conversation_list`, `@deepseek-ai/dsh-canvas-tools` owns the four Canvas/Site tools, `@deepseek-ai/dsh-structured-ui-tools` owns `ui_render`, `@deepseek-ai/dsh-office-tools` consumes `officeArtifactHost`, and `@deepseek-ai/dsh-workbench-pages` owns the app workbench catalog.

The child sends only a DSH Session id. The separate IPC adapter binds each request to one authorized DeepSeek Harness Desktop App Session, user, and project, then the parent handles project, conversation, Canvas/Site, and Office requests through one controlled dispatcher. Requests cannot select another identity or project. Canvas/Site approval belongs to the Canvas Bundle, while Office approval belongs to the Office Bundle. Every call produces normal durable DSH tool events; successful writes also project a hidden workspace event so the live interface and recovered history open the same Canvas, Site, or artifact.

Before every model step enters, the same parent-owned binding resolves the allowed App instructions, project instructions, and global/project memory. The bridge adds them as immutable user messages to the `agent/pre-step` entering batch and logs them in the DSH Session Log with `dsh-work-context` and `dsh-work-memory` provenance. A read failure skips only that addition; it does not replace the user's messages or create a second history.

The bridge also tracks the provider/model finally resolved for a parent Agent. When DSH creates a sub-Agent, it pins that target before the first request so the child cannot fall back to the process startup default. Later parent requests continue through normal settings resolution.

Runtime readiness, product IPC, request correlation, cancellation, and shutdown cleanup now belong to `@deepseek-ai/dsh-work-product-host-ipc`, not this feature Bundle.

The removed project Plugin mount, Skill, and MCP stores are not projected through ProductHost. Their catalog methods return an empty generation, while Profile Bundle Skills and tools remain owned by DSH's native registries.

## Model Experience

The model receives authorized instructions and memory from this Bundle in the same Session Log. The Project Bundle contributes `project_list` and `conversation_list` through `productHost`; the Canvas Bundle contributes `canvas_inspect`, `canvas_create`, `canvas_edit`, and `canvas_suggest` through `productHost`; the Structured UI Bundle contributes `ui_render` through `productHost`; the Office Bundle contributes the three `artifact_office_*` tools through `officeArtifactHost`. Canvas and Site writes use immutable base versions, while Office inspection retains stable edit anchors and omits UI preview SVG data from model results. `ui_render` validates a bounded structured document in the parent process and restores the same interactive surface from DSH history.

## Known Limitations and Deferred Work

- The published rc.6 SDK does not contain a ProductHost package. The private `@deepseek-ai/dsh-work-product-host-ipc` adapter therefore provides the transport-independent services for now; this Bundle owns only context, memory, and model glue. Project, Canvas, Structured UI, and Office tools are independent consumers. It can switch to a future published DSH provider without moving IPC back into feature code.
- The rc.6 SDK packages are publicly readable and do not require `NPM_TOKEN`, but development must explicitly pin the `next`/rc.6 release family because `latest` still points to older releases for some leaf packages. Development must not link DSH source or mix different RC families.
- The package is private; a packaged build must include the same reviewed Bundle revision and matching official NPM SDK versions.
