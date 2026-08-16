# @deepseek-ai/dsh-project-tools

This DSH Profile Bundle contributes `project_list` and `conversation_list` to every Agent scope. It consumes the session-addressed `productHost` service instead of importing the desktop server, database, Renderer, Electron bridge, or IPC transport.

The package is a `desktop-adapter`: the Host resolves the initiating DSH Session to an authorized user, App Session, and project, while this Bundle owns the tool schemas, presentation, registration, and lifecycle cleanup. Another DSH host can reuse the same tools by providing compatible `projectList(request, call)` and `conversationList(request, call)` methods.

The package can become `portable` after a public ProductHost provider is available to an unmodified official Web Profile. The published rc.6 SDK does not currently contain that provider, so this package does not link an unpublished DSH source checkout or claim standalone official-Web compatibility.
