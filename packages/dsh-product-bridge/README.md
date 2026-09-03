# DSH Desktop Product Bridge

English | [中文](README.zh.md)

This private Profile Bundle extends the official DSH Web Profile without importing or changing a DSH source checkout. It owns only the App instruction context and no longer registers any Tool, page, model-inheritance hook, or memory provider. It consumes the session-addressed `productHost` service provided by `@vibeinging/dsh-work-product-host-ipc`; the portable `@vibeinging/dsh-model-inheritance` Bundle owns parent-to-sub-Agent model inheritance, the separate `@vibeinging/dsh-project-tools` Bundle owns `project_list` and `conversation_list`, `@vibeinging/dsh-canvas-tools` owns the four Canvas/Site tools, `@vibeinging/dsh-structured-ui-tools` owns `ui_render`, and `@vibeinging/dsh-office-tools` consumes `officeArtifactHost`. Long-term memory comes from the reviewed community `dsh-native-memory` Profile Bundle instead of an App-specific database and injection path.

The child sends only a DSH Session id. The separate IPC adapter binds each request to one authorized DSH Desktop Session, user, and project, then the parent handles parent-authorized conversation creation plus project, conversation, Canvas/Site, and Office requests through one controlled dispatcher. A conversation-creation request derives its identity and project from the initiating binding, creates an App Session and ordinary DSH Session together, and registers the new ProductHost binding before returning. Requests cannot select another identity or project. Canvas/Site approval belongs to the Canvas Bundle, while Office approval belongs to the Office Bundle. Every call produces normal durable DSH tool events; successful writes also project a hidden workspace event so the live interface and recovered history open the same Canvas, Site, or artifact.

Before every model step enters, the same parent-owned binding resolves the allowed App and project instructions. The bridge adds them as one immutable user message to the `agent/pre-step` entering batch and logs it in the DSH Session Log with `dsh-work-context` provenance. A read failure skips only that addition; it does not replace the user's messages or create a second history.

The separate portable `@vibeinging/dsh-model-inheritance` Bundle tracks the provider and model finally resolved for a parent Agent. When DSH creates a sub-Agent, that Bundle pins the target before the first request so the child cannot fall back to the process startup default. Later parent requests continue through normal settings resolution.

Runtime readiness, product IPC, request correlation, cancellation, and shutdown cleanup now belong to `@vibeinging/dsh-work-product-host-ipc`, not this feature Bundle.

The removed project Plugin mount, Skill, and MCP stores are not projected through ProductHost. Their catalog methods return an empty generation, while Profile Bundle Skills and tools remain owned by DSH's native registries.

## Model Experience

The model receives authorized App and project instructions from this Bundle in the same Session Log. The reviewed community memory Bundle owns long-term memory through official DSH storage, approval, Tool, Session query, and system-prompt seams. The portable Model Inheritance Bundle keeps sub-Agents on their parent's resolved model target. The Project Bundle contributes `project_list` and `conversation_list` through `productHost`; the Canvas Bundle contributes `canvas_inspect`, `canvas_create`, `canvas_edit`, and `canvas_suggest` through `productHost`; the Structured UI Bundle contributes `ui_render` through `productHost`; the Office Bundle contributes the three `artifact_office_*` tools through `officeArtifactHost`. Canvas and Site writes use immutable base versions, while Office inspection retains stable edit anchors and omits UI preview SVG data from model results. `ui_render` validates a bounded structured document in the parent process and restores the same interactive surface from DSH history.

## Known Limitations and Deferred Work

- The current public SDK does not provide this App-specific ProductHost. The private `@vibeinging/dsh-work-product-host-ipc` adapter therefore provides the transport-independent services; this Bundle owns only App instruction context. Model inheritance and memory are independent portable/community Bundles, while Project, Canvas, Structured UI, and Office tools are independent desktop consumers. It can switch to a future published DSH provider without moving IPC back into feature code.
- The `0.1.2-alpha.4` SDK packages are publicly readable and do not require `NPM_TOKEN`, but development must pin the exact release because registry dist-tags may lag behind published versions. Development must not link DSH source or mix different prerelease lines.
- The package is private; a packaged build must include the same reviewed Bundle revision and matching official NPM SDK versions.
