import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const HEADLESS_CONSOLE_HELPER = `let headlessConsoleReady = false;
function ensureHeadlessConsole(api) {
\tif (headlessConsoleReady || api.getConsoleCP() !== 0) {
\t\theadlessConsoleReady = true;
\t\treturn;
\t}
\tconst savedIn = api.getStdHandle(-10);
\tconst savedOut = api.getStdHandle(-11);
\tconst savedErr = api.getStdHandle(-12);
\tlet startupInfo;
\tlet processInfo;
\ttry {
\t\tstartupInfo = allocStartupInfo();
\t\tencodeStartupInfo(startupInfo, {
\t\t\tcb: 104,
\t\t\tdwFlags: 1,
\t\t\twShowWindow: 0
\t\t});
\t\tprocessInfo = allocProcessInfo();
\t\tconst sysRoot = process.env.SystemRoot || process.env.windir || "C:\\\\Windows";
\t\tconst cmdExe = \`\${sysRoot}\\\\System32\\\\cmd.exe\`;
\t\tif (api.createProcessW(cmdExe, \`"\${cmdExe}" /d /q /k\`, null, null, 0, 134217728, null, null, startupInfo, processInfo) !== 0) {
\t\t\tconst info = decodeProcessInfo(processInfo);
\t\t\tfor (let i = 0; i < 200; i++) {
\t\t\t\tif (api.attachConsole(info.dwProcessId) !== 0 || api.getLastError() === 5) {
\t\t\t\t\theadlessConsoleReady = true;
\t\t\t\t\tbreak;
\t\t\t\t}
\t\t\t\tapi.sleep(1);
\t\t\t}
\t\t\tif (info.hProcess !== null) {
\t\t\t\tapi.terminateProcess(info.hProcess, 0);
\t\t\t\tcloseBestEffort(api, info.hProcess);
\t\t\t}
\t\t\tcloseBestEffort(api, info.hThread);
\t\t}
\t} catch {} finally {
\t\tfreeNative(processInfo);
\t\tfreeNative(startupInfo);
\t\tif (!isNullPtr(savedIn)) api.setStdHandle(-10, savedIn);
\t\tif (!isNullPtr(savedOut)) api.setStdHandle(-11, savedOut);
\t\tif (!isNullPtr(savedErr)) api.setStdHandle(-12, savedErr);
\t\ttry {
\t\t\tapi.setConsoleCtrlHandler(null, 1);
\t\t} catch {}
\t}
}
`;

/**
 * Patch @deepseek-ai/dsh-win32-process source text so GUI-subsystem hosts
 * (DSH Desktop.exe with ELECTRON_RUN_AS_NODE=1) do not flash console windows
 * on Windows when spawning rg.exe or sandboxed powershell.exe.
 */
export function patchWin32ProcessSource(source) {
  if (typeof source !== "string" || source.includes("ensureHeadlessConsole")) {
    return { code: source, changed: false };
  }
  let next = source;

  // 1. Add Win32 console bindings to bindings()
  const stdHandleLine = 'getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"]),';
  if (next.includes(stdHandleLine) && !next.includes('getConsoleCP: bind(kernel32')) {
    next = next.replace(
      stdHandleLine,
      `${stdHandleLine}
\t\tsetStdHandle: bind(kernel32, "SetStdHandle", "int", ["int", PVOID]),
\t\tgetConsoleCP: bind(kernel32, "GetConsoleCP", "uint32", []),
\t\tattachConsole: bind(kernel32, "AttachConsole", "int", ["uint32"]),
\t\tsetConsoleCtrlHandler: bind(kernel32, "SetConsoleCtrlHandler", "int", [PVOID, "int"]),
\t\tsleep: bind(kernel32, "Sleep", "void", ["uint32"]),`,
    );
  }

  // 2. Attach headless console before CreateProcessAsUserW in createRestrictedProcess
  const restrictedTarget = "function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {\n\treturn api.createProcessAsUserW(";
  if (next.includes(restrictedTarget)) {
    next = next.replace(
      restrictedTarget,
      `${HEADLESS_CONSOLE_HELPER}function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {\n\tensureHeadlessConsole(api);\n\treturn api.createProcessAsUserW(`,
    );
  }

  // 3. Set STARTF_USESHOWWINDOW (dwFlags: 257) and SW_HIDE (wShowWindow: 0)
  next = next.replaceAll(
    "cb: 104,\n\t\t\tdwFlags: 256,",
    "cb: 104,\n\t\t\tdwFlags: 257,\n\t\t\twShowWindow: 0,",
  );

  // 4. Add CREATE_NO_WINDOW (0x08000000 -> 1028 | 134217728 = 134218756) to spawnCurrentTokenJobProcess
  next = next.replace(
    "api.createProcessW(options.applicationName, commandLine, null, null, 1, 1028, environment, options.cwd, startupInfo, processInfo)",
    "api.createProcessW(options.applicationName, commandLine, null, null, 1, 134218756, environment, options.cwd, startupInfo, processInfo)",
  );

  return { code: next, changed: next !== source };
}

/**
 * Resolve and patch @deepseek-ai/dsh-win32-process/lib/index.js from a DSH
 * installation anchor or server root directory.
 */
export function ensureWin32HeadlessConsolePatch({
  anchorPath = "",
  serverRoot = "",
  platform = process.platform,
} = {}) {
  if (platform !== "win32") return { patched: false, targetPath: null };
  let targetPath = null;
  if (serverRoot) {
    const candidate = join(resolve(serverRoot), "node_modules", "@deepseek-ai", "dsh-win32-process", "lib", "index.js");
    if (existsSync(candidate)) targetPath = candidate;
  }
  if (!targetPath && anchorPath && existsSync(anchorPath)) {
    try {
      const req = createRequire(resolve(anchorPath));
      const pkgJson = req.resolve("@deepseek-ai/dsh-win32-process/package.json");
      const candidate = join(dirname(pkgJson), "lib", "index.js");
      if (existsSync(candidate)) targetPath = candidate;
    } catch {
      // Ignore resolution errors when optional package is absent.
    }
  }
  if (!targetPath) return { patched: false, targetPath: null };
  try {
    const original = readFileSync(targetPath, "utf8");
    const { code, changed } = patchWin32ProcessSource(original);
    if (changed) writeFileSync(targetPath, code, "utf8");
    return { patched: changed, targetPath };
  } catch {
    return { patched: false, targetPath };
  }
}
