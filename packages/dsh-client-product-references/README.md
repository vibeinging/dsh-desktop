# `@deepseek-ai/dsh-client-product-references`

This private desktop-adapter Bundle contributes product workspace files and App conversations through the official `inputTriggers` registry. Both sources use the rc.7 `@` trigger alongside the official subagent source. Picking a file writes `@<authorized-path> ` into the shared draft, while picking a conversation writes `#<title> `; the package owns the source roster and matching but never reads the product DOM or App storage.

Candidates come from the narrow `dshWorkProductReferences` Client service provided by `@deepseek-ai/dsh-work-shell`. The service fences calls by the selected DSH Session and delegates to the currently mounted product workspace. The package can be installed, disabled, or replaced through the Profile without changing `AgentConversation`.

The public rc.7 InputTrigger contract only accepts `/` and `@`, so a typed `#` cannot open a standard source menu without an upstream contract change. Its query is the current no-whitespace token. Conversation candidates therefore share the `@` menu and keep `#` only as their inserted product text. The standalone development page retains its local `@` and `#` picker because no DSH Client Host exists there.
