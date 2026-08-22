import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDesktopPnpm,
  createDesktopProfileHostServices,
  createDesktopProfiles,
  resolveDesktopDshInvocation,
  resolveDesktopPnpmInvocation,
} from "../../packages/dsh-desktop-profile-host/src/index.js";

async function desktopFixture() {
  const root = await mkdtemp(join(tmpdir(), "dsh-desktop-profile-host-"));
  const profile = join(root, "profiles", "web");
  const cli = join(root, "runtime", "lib", "bin.js");
  const anchor = join(root, "runtime", "package.json");
  const pnpm = join(root, "pnpm-runtime", "bin", "pnpm.cjs");
  await mkdir(profile, { recursive: true });
  await mkdir(join(root, "runtime", "lib"), { recursive: true });
  await mkdir(join(root, "pnpm-runtime", "bin"), { recursive: true });
  await mkdir(join(root, "pnpm-bin"), { recursive: true });
  await writeFile(join(profile, "package.json"), "{}\n");
  await writeFile(anchor, JSON.stringify({ name: "@deepseek-ai/dsh", bin: { dsh: "lib/bin.js" } }));
  await writeFile(cli, "export {};\n");
  await writeFile(pnpm, "module.exports = {};\n");
  return {
    root,
    profile,
    cli,
    pnpm,
    env: {
      DSH_HOME: root,
      DSH_RUNTIME_HOME: root,
      DSH_DESKTOP_PROFILE_NAME: "web",
      DSH_RUNTIME_DISTRIBUTION: "npm",
      DSH_RUNTIME_INSTALL_ANCHOR: anchor,
      DSH_PNPM_BIN_DIR: join(root, "pnpm-bin"),
    },
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = 424242;
    this.exitCode = null;
  }
}

test("desktopProfiles publishes one immutable active Profile and refuses a guessed switch", async () => {
  const fixture = await desktopFixture();
  const profiles = createDesktopProfiles({ env: fixture.env });
  assert.deepEqual(profiles.current, { name: "web", dir: fixture.profile });
  assert.deepEqual(profiles.list(), [{
    name: "web",
    dir: fixture.profile,
    current: true,
    selectable: true,
  }]);
  await profiles.select("web");
  await assert.rejects(profiles.select("headless"), { code: "DSH_DESKTOP_PROFILE_SELECTION_UNSUPPORTED" });
  profiles.dispose();
  assert.throws(() => profiles.list(), { code: "DSH_DESKTOP_PROFILE_DISPOSED" });
});

test("desktopPnpm anchors plugin mutations to the official DSH CLI and active Profile", async () => {
  const fixture = await desktopFixture();
  const launches = [];
  const children = [];
  const spawn = (file, args, options) => {
    launches.push({ file, args, options });
    const child = new FakeChild();
    children.push(child);
    return child;
  };
  const dsh = resolveDesktopDshInvocation(fixture.env, ["--expose-internals"]);
  const pnpm = resolveDesktopPnpmInvocation(fixture.env);
  assert.equal(dsh.args.at(-1), fixture.cli);
  assert.equal(pnpm.args[0], fixture.pnpm);

  const service = createDesktopPnpm({
    env: fixture.env,
    current: { name: "web", dir: fixture.profile },
    spawn,
  });
  const install = service.runPlugin(["add", "example-plugin@1.2.3"], fixture.root);
  assert.deepEqual(launches[0].args.slice(-5), [
    "plugin",
    "--profile",
    "web",
    "add",
    "example-plugin@1.2.3",
  ]);
  assert.equal(launches[0].options.cwd, fixture.root);
  assert.equal(launches[0].options.env.CI, "1");
  assert.throws(
    () => service.runPlugin(["remove", "example-plugin"], fixture.root),
    { code: "DSH_DESKTOP_PNPM_BUSY" },
  );
  children[0].exitCode = 0;
  children[0].emit("close", 0, null);
  assert.deepEqual(await install.done, { exitCode: 0, signal: null });

  const direct = service.run(["--version"]);
  assert.deepEqual(launches[1].args, [fixture.pnpm, "--version"]);
  assert.equal(launches[1].options.cwd, fixture.profile);
  children[1].exitCode = 0;
  children[1].emit("close", 0, null);
  await direct.done;
  await service.dispose();
  assert.throws(() => service.run(["--version"]), { code: "DSH_DESKTOP_PNPM_DISPOSED" });
});

test("desktop Profile Host services share the same generation snapshot", async () => {
  const fixture = await desktopFixture();
  const services = createDesktopProfileHostServices({ env: fixture.env, spawn: () => new FakeChild() });
  assert.deepEqual(services.desktopProfiles.current, { name: "web", dir: fixture.profile });
  assert.equal(typeof services.desktopPnpm.runPlugin, "function");
  await services.dispose();
});
