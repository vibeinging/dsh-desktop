/** Build the browser half into the DSH module-loader wrapper. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(root, "src", "client", "index.js");
const outputPath = join(root, "lib", "client.js");
const source = await readFile(sourcePath, "utf8");
const body = source.replace("export function createWorktreeClient", "function createWorktreeClient");
if (body === source) throw new Error("Worktree Client source export was not found");
const indented = body.split("\n").map((line) => line ? `    ${line}` : "").join("\n");
const output = `window.__ModuleLoader__.load({\n  id: "@vibeinging/dsh-client-ui-worktree",\n  factory: (require) => {\n${indented}\n    return createWorktreeClient(require("react"));\n  },\n});\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
