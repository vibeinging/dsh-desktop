# @deepseek-ai/dsh-office-tools

This DSH Profile Bundle contributes `artifact_office_inspect`, `artifact_office_create`, and `artifact_office_edit` to every Agent scope. It consumes the narrow `officeArtifactHost` service instead of importing the desktop server, Renderer, database, Electron bridge, or IPC transport.

The current package is a `desktop-adapter`: `@deepseek-ai/dsh-work-product-host-ipc` provides the session-addressed Host service, while this Bundle owns tool schemas, DSH registration, approval for writes, and lifecycle cleanup. Another DSH host can reuse the same feature by providing `officeArtifactHost`. The package can become `portable` after that Host contract and a non-desktop provider are published independently and pass an unmodified official Web Profile test.
