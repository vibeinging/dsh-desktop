/** Desktop Profile identity and controlled package-operation services. */

import { spawn as spawnProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const name = "dsh-desktop-profile-host";
export const inject = [];

function desktopProfileError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateArgs(args) {
  if (!Array.isArray(args) || args.length === 0
    || args.some((value) => typeof value !== "string" || !value || value.includes("\0"))) {
    throw desktopProfileError("desktopPnpm requires non-empty, NUL-free arguments", "DSH_DESKTOP_PNPM_ARGS_INVALID");
  }
  return [...args];
}

function validateDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw desktopProfileError(`${label} must be an absolute, NUL-free path`, "DSH_DESKTOP_PNPM_DIRECTORY_INVALID");
  }
  return resolve(path);
}

function readManifest(path, code) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest must be an object");
    return value;
  } catch (error) {
    throw desktopProfileError(`cannot read ${path}: ${error?.message || error}`, code);
  }
}

/** Resolve the immutable active Profile identity for one desktop generation. */
export function resolveDesktopCurrentProfile(env = process.env) {
  const profile = String(env.DSH_DESKTOP_PROFILE_NAME || "").trim();
  const dshHome = String(env.DSH_HOME || env.DSH_RUNTIME_HOME || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw desktopProfileError("DSH_DESKTOP_PROFILE_NAME is missing or invalid", "DSH_DESKTOP_PROFILE_NAME_INVALID");
  }
  if (!dshHome || !isAbsolute(dshHome) || dshHome.includes("\0")) {
    throw desktopProfileError("DSH_HOME must be an absolute desktop runtime path", "DSH_DESKTOP_HOME_INVALID");
  }
  const dir = resolve(dshHome, "profiles", profile);
  if (!existsSync(join(dir, "package.json"))) {
    throw desktopProfileError(`active DSH Profile is missing: ${dir}`, "DSH_DESKTOP_PROFILE_MISSING");
  }
  return Object.freeze({ name: profile, dir });
}

/** Create the public, generation-scoped desktopProfiles service. */
export function createDesktopProfiles({ env = process.env } = {}) {
  const current = resolveDesktopCurrentProfile(env);
  const profilesRoot = dirname(current.dir);
  let closed = false;
  const assertOpen = () => {
    if (closed) throw desktopProfileError("desktopProfiles generation is disposed", "DSH_DESKTOP_PROFILE_DISPOSED");
  };
  return Object.freeze({
    current,
    list() {
      assertOpen();
      return Object.freeze(readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9._-]+$/.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          dir: join(profilesRoot, entry.name),
          current: entry.name === current.name,
          selectable: entry.name === current.name,
        }))
        .filter((entry) => existsSync(join(entry.dir, "package.json")))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(Object.freeze));
    },
    async select(profile) {
      assertOpen();
      if (profile !== current.name) {
        throw desktopProfileError(
          `DSH Desktop currently exposes only the active ${current.name} Profile`,
          "DSH_DESKTOP_PROFILE_SELECTION_UNSUPPORTED",
        );
      }
    },
    dispose() {
      closed = true;
    },
  });
}

/** Resolve the official DSH CLI invocation anchored by the desktop runtime. */
export function resolveDesktopDshInvocation(env = process.env, execArgv = process.execArgv) {
  const anchor = String(env.DSH_RUNTIME_INSTALL_ANCHOR || "").trim();
  if (!anchor || !isAbsolute(anchor) || anchor.includes("\0")) {
    throw desktopProfileError("DSH_RUNTIME_INSTALL_ANCHOR is missing", "DSH_DESKTOP_DSH_ANCHOR_INVALID");
  }
  const manifest = readManifest(anchor, "DSH_DESKTOP_DSH_MANIFEST_INVALID");
  const root = dirname(anchor);
  const declared = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.dsh;
  const sourceEntry = join(root, "src", "bin.ts");
  const entry = env.DSH_RUNTIME_DISTRIBUTION === "source" && existsSync(sourceEntry)
    ? sourceEntry
    : resolve(root, declared || "lib/bin.js");
  if (!existsSync(entry)) {
    throw desktopProfileError(`official DSH CLI entry is missing: ${entry}`, "DSH_DESKTOP_DSH_ENTRY_MISSING");
  }
  return Object.freeze({
    file: process.execPath,
    args: Object.freeze([...execArgv, entry]),
  });
}

/** Resolve the packaged pnpm JavaScript entry without consulting system PATH. */
export function resolveDesktopPnpmInvocation(env = process.env) {
  const binDir = String(env.DSH_PNPM_BIN_DIR || "").trim();
  if (!binDir || !isAbsolute(binDir) || binDir.includes("\0")) {
    throw desktopProfileError("DSH_PNPM_BIN_DIR is missing", "DSH_DESKTOP_PNPM_MISSING");
  }
  const entry = resolve(binDir, "..", "pnpm-runtime", "bin", "pnpm.cjs");
  if (!existsSync(entry)) {
    throw desktopProfileError(`packaged pnpm entry is missing: ${entry}`, "DSH_DESKTOP_PNPM_MISSING");
  }
  return Object.freeze({ file: process.execPath, args: Object.freeze([entry]) });
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawnProcess("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref?.();
    } catch {
      child.kill();
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function processHandle(child, release, signal) {
  let settled = false;
  let killTimer = null;
  const cancel = () => {
    if (settled) return;
    terminateProcessTree(child);
    killTimer = setTimeout(() => {
      if (settled || !child.pid) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 2_000);
    killTimer.unref?.();
  };
  const onAbort = () => cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  const done = new Promise((resolveDone, rejectDone) => {
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectDone(error);
      release();
    });
    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      resolveDone({ exitCode, signal: exitSignal });
      release();
    });
  }).finally(() => {
    if (killTimer) clearTimeout(killTimer);
    signal?.removeEventListener("abort", onAbort);
  });
  return Object.freeze({ stdout: child.stdout, stderr: child.stderr, done, cancel });
}

/** Create the public, generation-scoped desktopPnpm service. */
export function createDesktopPnpm({
  env = process.env,
  current = resolveDesktopCurrentProfile(env),
  spawn = spawnProcess,
} = {}) {
  let active = null;
  let closed = false;
  const start = (invocation, args, cwd, signal) => {
    if (closed) throw desktopProfileError("desktopPnpm generation is disposed", "DSH_DESKTOP_PNPM_DISPOSED");
    if (active) throw desktopProfileError("another desktop pnpm operation is already running", "DSH_DESKTOP_PNPM_BUSY");
    if (signal?.aborted) throw desktopProfileError("desktopPnpm operation was already aborted", "DSH_DESKTOP_PNPM_ABORTED");
    const child = spawn(invocation.file, [...invocation.args, ...validateArgs(args)], {
      cwd,
      env: { ...env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const handle = processHandle(child, () => {
      if (active === handle) active = null;
    }, signal);
    active = handle;
    return handle;
  };
  const service = Object.freeze({
    run(args, signal) {
      return start(resolveDesktopPnpmInvocation(env), args, current.dir, signal);
    },
    runPlugin(args, invokingDir, signal) {
      const cwd = validateDirectory(invokingDir, "desktopPnpm invoking directory");
      const invocation = resolveDesktopDshInvocation(env);
      return start(invocation, ["plugin", "--profile", current.name, ...validateArgs(args)], cwd, signal);
    },
    async dispose() {
      closed = true;
      const operation = active;
      operation?.cancel();
      await operation?.done.catch(() => {});
    },
  });
  return service;
}

/** Build both public Host services from one immutable Profile snapshot. */
export function createDesktopProfileHostServices({ env = process.env, spawn = spawnProcess } = {}) {
  const desktopProfiles = createDesktopProfiles({ env });
  const desktopPnpm = createDesktopPnpm({ env, current: desktopProfiles.current, spawn });
  return Object.freeze({
    desktopProfiles,
    desktopPnpm,
    async dispose() {
      desktopProfiles.dispose();
      await desktopPnpm.dispose();
    },
  });
}

/** Register the desktop services before community Loader entries mount. */
export function apply(ctx) {
  const services = createDesktopProfileHostServices();
  ctx.provide("desktopProfiles", services.desktopProfiles);
  ctx.provide("desktopPnpm", services.desktopPnpm);
  ctx.effect(() => () => services.dispose(), "dsh desktop Profile Host services");
}
