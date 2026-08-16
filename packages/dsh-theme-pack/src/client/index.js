export const inject = ["theme"];

const SOURCE = "@deepseek-ai/dsh-theme-pack";

/** Apply the same blue token layer in the official Web Profile and dsh-work. */
export function apply(ctx) {
  ctx.effect(() => ctx.theme.overrideTokens(SOURCE, {
    "--dsw-alias-brand-primary": {
      light: "#405fd2",
      dark: "#7b9cff",
    },
  }));
}
