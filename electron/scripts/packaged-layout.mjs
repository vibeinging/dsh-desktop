import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function windowsExecutable(dir) {
  const preferred = join(dir, 'DSH Desktop.exe');
  if (existsSync(preferred)) return preferred;
  const candidates = readdirSync(dir)
    .filter((name) => extname(name).toLowerCase() === '.exe')
    .filter((name) => !/^(uninstall|elevate|squirrel)/i.test(name));
  if (candidates.length !== 1) {
    throw new Error(`无法确定 Windows 主程序，请直接传入 .exe 路径: ${dir}`);
  }
  return join(dir, candidates[0]);
}

function linuxExecutable(dir) {
  // electron-builder 的 Linux 可执行名默认取包名（dsh-desktop）而非 productName；
  // 显式配置见 electron/package.json 的 linux.executableName。
  for (const name of ['DSH Desktop', 'dsh-desktop']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  const candidates = readdirSync(dir)
    .filter((name) => !name.includes('.'))
    .filter((name) => !isDirectory(join(dir, name)));
  if (candidates.length !== 1) {
    throw new Error(`无法确定 Linux 主程序，请直接传入可执行文件路径: ${dir}`);
  }
  return join(dir, candidates[0]);
}

export function resolvePackagedLayout(input) {
  if (!input) throw new Error('请传入 .app、Windows .exe、Linux 目录或可执行文件');
  const target = resolve(input);

  if (target.endsWith('.app') && isDirectory(target)) {
    const appName = basename(target, '.app');
    return {
      platform: 'darwin',
      executable: join(target, 'Contents', 'MacOS', appName),
      resourcesDir: join(target, 'Contents', 'Resources'),
    };
  }

  const appDir = isDirectory(target) ? target : dirname(target);
  const hasResources = isDirectory(join(appDir, 'resources'));

  if (hasResources) {
    if (isDirectory(target)) {
      // unpacked 目录：win-unpacked 里有 .exe；linux-unpacked 只有无扩展名主程序。
      const hasWindowsExe = readdirSync(target)
        .some((name) => extname(name).toLowerCase() === '.exe');
      if (hasWindowsExe) {
        return {
          platform: 'win32',
          executable: windowsExecutable(target),
          resourcesDir: join(appDir, 'resources'),
        };
      }
      // AppImage 是 squashfs 单文件，不能直接当目录探测；冒烟一律指向 linux-unpacked。
      return {
        platform: 'linux',
        executable: linuxExecutable(target),
        resourcesDir: join(appDir, 'resources'),
      };
    }
    if (extname(target).toLowerCase() === '.exe') {
      return { platform: 'win32', executable: target, resourcesDir: join(appDir, 'resources') };
    }
    if (existsSync(target)) {
      return { platform: 'linux', executable: target, resourcesDir: join(appDir, 'resources') };
    }
  }

  throw new Error(`不支持的打包产物: ${target}`);
}
