# `@deepseek-ai/dsh-client-product-search-mode`

This private desktop-adapter Bundle contributes the App web policy control through the standard `conversation.input.left` Slot. It preserves the three explicit turn modes: `auto`, `required`, and `off`. The package owns the visible control, bilingual copy, and cycle order; it does not read the product DOM or send a prompt.

The narrow `dshWorkProductSearchMode` Client service is provided by `@deepseek-ai/dsh-work-shell`. It exposes an observable projection for the selected DSH Session and routes a user click back to the current product draft policy. Removing this Bundle removes the button, so the App-managed Profile keeps it installed whenever product web policy is enabled. Standalone development keeps its local control because no DSH Client Host exists there.

This remains a desktop adapter rather than a portable DSH Web plugin. The modes configure App-owned web-search and citation policy carried with the next turn; they are not an official DSH Session projection. A future portable replacement must first define that policy on an official logged Session seam.
