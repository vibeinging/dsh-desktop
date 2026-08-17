# DeepSeek Harness Desktop App Structured UI Tools

This private Profile Bundle owns the `ui_render` tool and follows the public DSH Agent and Tool lifecycle. It consumes the session-addressed `productHost` service and never accesses Electron IPC, the product database, or Renderer code directly.

The parent Host validates the complete structured document against a bounded component schema before storing it. Buttons and forms submit a visible next user message; the document cannot run hidden JavaScript or request arbitrary desktop capabilities.

The Bundle is currently a `desktop-adapter` because the published rc.7 SDK does not provide ProductHost. It can become `portable` when an official or community Host provider implements the same narrow `uiRender` method without changing the Tool Bundle.
