import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const profileNodeModules = String(process.env.DSH_PROFILE_NODE_MODULES || "").trim();
const profileRequire = profileNodeModules
  ? createRequire(join(profileNodeModules, "__dsh_profile_loader__.cjs"))
  : null;

function isBareSpecifier(specifier) {
  return !specifier.startsWith(".")
    && !specifier.startsWith("/")
    && !specifier.startsWith("node:")
    && !specifier.startsWith("file:")
    && !specifier.startsWith("data:");
}

/**
 * Resolve a DSH Profile dependency when Electron's Node loader cannot walk to the profile root.
 * @param {string} specifier - The module specifier requested by the DSH loader.
 * @param {object} context - The Node ESM loader context.
 * @param {(specifier: string, context: object) => Promise<object>} nextResolve - The next resolver in the chain.
 * @returns {Promise<object>} The resolved module URL and loader result metadata.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!profileRequire || !isBareSpecifier(specifier)) throw error;
    try {
      return { url: pathToFileURL(profileRequire.resolve(specifier)).href, shortCircuit: true };
    } catch {
      throw error;
    }
  }
}
