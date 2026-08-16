# DeepSeek Harness Desktop App Workbench Pages

This private Profile Bundle owns the product catalog for the review, browser, files, artifacts, and sites pages. It contributes only `dshWork.product` metadata and does not register a Tool, execute Client code, access Electron IPC, or own Session state.

The current entries name trusted components shipped with DeepSeek Harness Desktop App and enter the app-owned `agent.workbench.tool` Slot. They are therefore `desktop-adapter` contributions, not portable official-Web plugins. User-installed Bundles cannot name these components; community UI needs the separate isolated Client contribution path.

Keeping the catalog in its own Bundle lets each built-in page be removed or replaced by a reviewed community Bundle without changing the context bridge or the desktop shell. OpenPencil remains the preferred community design surface; existing Canvas and Site pages remain only where their versioned product workflow is different.
