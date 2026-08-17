# `@deepseek-ai/dsh-client-product-attachments`

This Client Bundle owns the visible draft-attachment list. Before the first DSH Session exists, it uses the explicit desktop-shell root extension `dsh-work.composer.pre-session`; after a Session is bound, it moves to the standard `conversation.input.dock` Slot. It consumes only the Session-fenced `dshWorkProductAttachments` service published by `@deepseek-ai/dsh-work-shell`; local paths and attachment bytes stay in the App owner.

Image thumbnails reuse the official rc.6 `AttachmentRail` React atom. Non-image files, folders, media, and artifact selections remain desktop product projections because the official atom currently accepts images only. The Bundle can be disabled or replaced through the Profile without changing the product composer.

This package is a `desktop-adapter`, not a portable replacement for the official Web attachment controller. Official `ui-conversation` keeps browser `File` objects and temporary image ids inside its private controller, while the desktop App admits local paths through its trusted host. The two flows share DSH prompt and durable image contracts but do not pretend to share one draft store.
