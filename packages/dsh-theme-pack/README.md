# @deepseek-ai/dsh-theme-pack

This app-owned DSH Profile Bundle contributes the two product themes used by DeepSeek Harness Desktop App.

- `professional-blue` is the default product theme, with crisp cool-paper surfaces, restrained cobalt accents, and an ink-blue dark palette.
- `anime-blue` is optional and enables the anime home presentation with a softer sky-blue and periwinkle palette.

The Bundle owns installation and provenance through `dsh.bundle.patch`, and its patch inserts the `dsh-theme-pack` Cordis plugin row so Profile also owns runtime lifecycle. Its standard `dsh.client` entry applies the blue brand token through DSH `theme.overrideTokens()`, so the same package works in the official Web Profile and in DeepSeek Harness Desktop App. The compatibility test installs the local package with the official `dsh plugin --profile web add` command, boots the unmodified official Web Profile, and checks the applied theme token in a real sandboxed browser window. The transitional `dshWork.themes` descriptor supplies the desktop theme picker and the full fixed-field semantic palettes until that product surface moves to the standard DSH theme registry; it contains only renderer-safe hexadecimal colors and appearance tokens and never injects raw CSS.

Before exposing the Client surface, the product runtime adapter uses the official DSH Settings API to persist `ui-theme.preference: dark` only when that namespace has no user preference. An explicit `light`, `dark`, or `system` value is never overwritten. Product theme selection remains in DeepSeek Harness Desktop App's theme settings: a missing selection resolves to `professional-blue`, while an explicit `anime-blue` selection remains valid.
