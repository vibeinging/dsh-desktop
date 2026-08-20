# DSH Model Inheritance

This portable Profile Bundle keeps a DSH sub-Agent on the provider, model, token limit, and reasoning effort resolved for its parent Agent. It uses only the official Agent lifecycle and request waterfalls, so it can run in both the official Web Profile and DSH Desktop without Electron, ProductHost, preload, or app-owned state.

The Bundle records the parent target after normal DSH settings and request resolution. When DSH creates a Session with `origin: subagent` and `parentSession`, it resolves the parent through the official Agent registry, adds the inherited provider and model to system-prompt variables, and pins the same target onto the child request. A missing parent or a parent that has not completed request resolution leaves the child unchanged.

Every listener is Agent-scoped and is removed on `agent/disposed` or Bundle disposal. The Bundle does not copy credentials, change the parent request, create a second model catalog, or bypass provider validation. Its compatibility test installs the package through the official Profile command and boots it inside an unmodified official Web Profile.
