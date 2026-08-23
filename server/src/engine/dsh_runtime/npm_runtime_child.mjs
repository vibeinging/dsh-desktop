// NPM DSH runtime child.
//
// The wrapper is the process entry so Node never resolves the official CLI
// through the Profile loader. It registers that loader only for subsequent
// Profile imports, then loads the fixed CLI through a file URL.

import { register } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Return a portable ESM URL for the fixed DSH CLI entry. */
export function npmRuntimeEntryUrl(entryPath) {
  return pathToFileURL(entryPath).href;
}

/** Register Profile dependency resolution after the process entry is loaded. */
export function registerProfileModuleLoader(environment = process.env) {
  const loaderPath = String(environment.DSH_PROFILE_MODULE_LOADER_PATH || "").trim();
  if (!loaderPath) return false;
  register(pathToFileURL(loaderPath).href, import.meta.url);
  return true;
}

/** Start the official DSH CLI inside the already initialized child process. */
export async function runNpmRuntimeChild(environment = process.env) {
  const entryPath = String(environment.DSH_CLI_ENTRY_PATH || "").trim();
  if (!entryPath) throw new Error("缺少 DSH_CLI_ENTRY_PATH");
  registerProfileModuleLoader(environment);
  await import(npmRuntimeEntryUrl(entryPath));
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedScript === fileURLToPath(import.meta.url)) await runNpmRuntimeChild();
