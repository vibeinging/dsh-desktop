'use strict';

// electron-updater 的 downloadUpdate() 会读取安装包内 Resources/app-update.yml；
// 检查更新只依赖运行时 setFeedURL，所以该文件缺失时按钮能发现新版本，
// 但一点击下载就 ENOENT（v0.2.4 及之前的 macOS 包全部如此）。打包钩子
// （scripts/write-app-update-config.mjs）与运行时自愈共用这里的配置来源。

function managedUpdateFeedUrl(apiBaseUrl, channel, platform, arch) {
  return `${String(apiBaseUrl).replace(/\/+$/, '')}/api/desktop/updates/${channel}/${platform}/${arch}`;
}

/**
 * 生成 app-update.yml 内容。托管更新源优先，其次固定 GitHub Releases；
 * 两者都没有配置时返回 null（调用方应跳过写入）。
 */
function buildAppUpdateConfigYaml({ apiBaseUrl = '', repository = null, channel = 'stable', platform, arch } = {}) {
  if (apiBaseUrl) {
    return [
      'provider: generic',
      `url: ${managedUpdateFeedUrl(apiBaseUrl, channel, platform, arch)}`,
      'useMultipleRangeRequest: false',
      '',
    ].join('\n');
  }
  if (repository && repository.owner && repository.repo) {
    return [
      'provider: github',
      `owner: ${repository.owner}`,
      `repo: ${repository.repo}`,
      'releaseType: release',
      '',
    ].join('\n');
  }
  return null;
}

module.exports = { buildAppUpdateConfigYaml, managedUpdateFeedUrl };
