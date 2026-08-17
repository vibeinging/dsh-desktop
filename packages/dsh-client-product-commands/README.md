# `@deepseek-ai/dsh-client-product-commands`

This private desktop-adapter Bundle owns the App-only `/new`, `/runs`, and `/trace` input contributions. It registers one lifecycle-bound source through the official `inputTriggers` registry, consumes the shared Session token before dispatch, and uses the active DSH Session id as its fence.

The Bundle declares every runtime service it reads, including `sessions`, and depends on the narrow `dshWorkProductActions` Client service provided by `@deepseek-ai/dsh-work-shell`. It does not import the shell implementation, touch the product DOM, maintain a command queue, or read App storage. The shell service only routes an accepted command to the current product handler; command names, descriptions, matching, and lifecycle belong to this removable Bundle.

This package is a `desktop-adapter`, not a portable official-Web plugin, because `/new`, `/runs`, and `/trace` open product-owned desktop surfaces. Official `/model`, `/compact`, Skill, Goal, permission, and other Profile commands remain owned by their own DSH plugins.
