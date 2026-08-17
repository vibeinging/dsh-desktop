# `@deepseek-ai/dsh-client-product-workspaces`

This private desktop-adapter Bundle replaces the official `ui-workspace` Client row and owns the App project picker in the standard root-scoped `conversation.hero.workspace` Slot. The Profile disables the former provider before this Bundle registers because the standard Slot has one seat. It provides project search, selection, folder onboarding, and project creation without reading product DOM or importing the desktop navigation store.

The narrow observable `dshWorkProductWorkspaces` service is provided by `@deepseek-ai/dsh-work-shell`. It exposes only display-safe workspace identities and explicit actions. Replacing this Bundle in the Profile leaves the standard single Slot available for another reviewed workspace plugin; standalone development keeps the local picker because no DSH Client Host exists there.

This package is not portable to an unmodified official Web Profile because App projects, folder onboarding, and project creation come from desktop product state. A portable replacement may take the same standard Slot if it uses only official Workspace services.
