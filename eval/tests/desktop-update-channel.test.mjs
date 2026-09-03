import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { updatePresentation, renderReleaseNotes } from '../../electron/app-update-ui.mjs';

const require = createRequire(import.meta.url);
const { handleAppUpdateRequest } = require('../../electron/app-update-requests.js');
const { UPDATE_URL, isTrustedUpdateSender, updateViewBounds } = require('../../electron/app-update-view.js');

test('the host defaults to the official service but preserves an explicit empty GitHub-only override', () => {
  const main = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  const declaration = main.match(/const UPDATE_API_BASE_URL = [\s\S]*?;\n/)?.[0];
  assert.ok(declaration);
  const resolve = (env) => runInNewContext(declaration + '\nUPDATE_API_BASE_URL', { process: { env } });
  assert.equal(resolve({}), 'https://dshdesktopstation.com');
  assert.equal(resolve({ DSH_UPDATE_API_BASE_URL: '' }), '');
  assert.equal(resolve({ DSH_UPDATE_API_BASE_URL: '  https://updates.example.test  ' }), 'https://updates.example.test');
  assert.match(main, /collectAnonymousStats: process\.env\.DSH_UPDATE_STATS_DISABLED !== '1'/);
  assert.match(main, /allowGitHubFallback: true/);
});

test('update commands only install the exact advertised version after an explicit request', () => {
  let installs = 0;
  let checks = 0;
  let state = { enabled: true, status: 'available', latest: { version: '0.2.1', update_available: true } };
  const controller = {
    getState: () => state,
    check: async () => { checks++; state = { ...state, status: 'checking' }; },
    downloadAndInstall: async () => { installs++; state = { ...state, status: 'downloading' }; },
  };
  assert.equal(handleAppUpdateRequest(controller, 'state'), state);
  assert.equal(installs, 0);
  for (const [method, payload] of [['run', {}], ['state', { version: '0.2.1' }], ['check', null], ['state', []], ['install', { version: '9' }], ['install', { version: '0.2.1', url: 'https://invalid.example' }]]) {
    assert.throws(() => handleAppUpdateRequest(controller, method, payload));
  }
  assert.equal(installs, 0);
  assert.equal(handleAppUpdateRequest(controller, 'install', { version: '0.2.1' }).status, 'downloading');
  assert.equal(installs, 1);
  assert.throws(() => handleAppUpdateRequest(controller, 'install', { version: '0.2.1' }));
  assert.equal(handleAppUpdateRequest(controller, 'check').status, 'checking');
  assert.equal(checks, 1);
});


test('the button projects availability, bounded progress, failures, and Profile blocks', () => {
  assert.deepEqual(updatePresentation({ status: 'available', latest: { version: '0.2.1' } }).action, 'install');
  assert.equal(updatePresentation({ status: 'downloading', progress: { percent: 500 } }).label, '下载中 100%');
  assert.equal(updatePresentation({ status: 'downloading', progress: { percent: -2 } }).label, '下载中 0%');
  for (const status of ['checking', 'downloading', 'downloaded', 'installing']) assert.equal(updatePresentation({ status }).action, undefined);
  for (const status of ['blocked', 'error', 'up-to-date', 'idle']) assert.equal(updatePresentation({ status }).action, 'check');
});

test('Markdown notes render into the safe HTML subset', () => {
  const html = renderReleaseNotes('# Improvements\n\n- **Keep** `Map<string>` and [docs](https://example.com)', { createElement: () => ({}) });
  assert.match(html, /<h1>Improvements<\/h1>/);
  assert.match(html, /<li><strong>Keep<\/strong> <code>Map&lt;string&gt;<\/code> and <a href="https:\/\/example\.com">docs<\/a><\/li>/);
  assert.doesNotMatch(html, /<script|javascript:|onerror=/i);
});

test('remote release HTML without a DOM parser is escaped and never runs', () => {
  const remote = '<h1>v0.2.0</h1><h2>本次更新</h2><ul><li>默认加入 <strong>Agent Teams</strong>。</li><li><code>Map&lt;string&gt;</code> 与 <a href="https://example.com">docs</a>。</li></ul>'
    + '<p><img src="https://invalid.example/tracker" onerror="window.x=1"><a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a></p>'
    + '<script>window.pwned=1</script><style>body{display:none}</style><iframe src="https://invalid.example"></iframe>';
  const html = renderReleaseNotes(remote, { createElement: () => ({}) });
  // No live HTML parser: remote tags are escaped into inert text and cannot form executable markup.
  assert.doesNotMatch(html, /<script>|<\/script>|<iframe[ >]|<img[ >]|href="javascript:/i);
  assert.doesNotMatch(html, /onerror="/i);
  assert.match(html, /&lt;h1&gt;/);
  assert.match(html, /&lt;img /);
});

test('malformed release notes cannot restart a scan inside the same delimiter run', () => {
  // These patterns must stop before the next possible start, avoiding quadratic retries on remote notes.
  const source = readFileSync(new URL('../../electron/app-update-ui.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes(String.raw`escapeHtmlText`));
  assert.ok(source.includes(String.raw`/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g`));
  assert.ok(source.includes(String.raw`/(?<![\t ])[\t ]+\n/g`));
  const document = { createElement: () => ({}) };
  for (const marker of ['[', '<p', '[x](', ' ']) {
    const input = marker.repeat(65_536);
    assert.doesNotThrow(() => renderReleaseNotes(input, document));
    assert.ok(renderReleaseNotes(input, document).length <= 65_536 * 6);
  }
  const plain = renderReleaseNotes('line  \n\n [docs](https://example.com)\n', document);
  assert.match(plain, /^<p>/);
  assert.match(plain, /docs/);
});

test('update IPC rejects remote pages, other views, child frames, and destroyed senders', () => {
  const contents = { mainFrame: { url: UPDATE_URL }, isDestroyed: () => false };
  assert.equal(isTrustedUpdateSender({ sender: contents, senderFrame: contents.mainFrame }, contents), true);
  assert.equal(isTrustedUpdateSender({ sender: {}, senderFrame: contents.mainFrame }, contents), false);
  assert.equal(isTrustedUpdateSender({ sender: contents, senderFrame: { url: UPDATE_URL } }, contents), false);
  contents.mainFrame.url = 'https://example.com';
  assert.equal(isTrustedUpdateSender({ sender: contents, senderFrame: contents.mainFrame }, contents), false);
  contents.mainFrame.url = UPDATE_URL;
  contents.isDestroyed = () => true;
  assert.equal(isTrustedUpdateSender({ sender: contents, senderFrame: contents.mainFrame }, contents), false);
});

test('the native hit area collapses to the title strip without moving the hover target', () => {
  assert.deepEqual(updateViewBounds({ width: 900, height: 600 }), { x: 516, y: 0, width: 384, height: 36 });
  assert.deepEqual(updateViewBounds({ width: 900, height: 600 }, { expanded: true, contentHeight: 530 }), { x: 516, y: 0, width: 384, height: 530 });
  assert.deepEqual(updateViewBounds({ width: 300, height: 200 }, { expanded: true, contentHeight: 9999 }), { x: 0, y: 0, width: 300, height: 200 });
});

test('packaging includes the isolated control but does not give official Web a preload', () => {
  const json = JSON.parse(readFileSync(new URL('../../electron/package.json', import.meta.url), 'utf8'));
  for (const file of ['app-update-view.js', 'app-update-preload.js', 'app-update-ui.mjs', 'app-update.html', 'app-update-requests.js']) assert.ok(json.build.files.includes(file), file);
  const main = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /preload\s*:|promptForAvailableUpdate|发现新版本/);
  assert.match(main, /new AppUpdateView/);
  const html = readFileSync(new URL('../../electron/app-update.html', import.meta.url), 'utf8');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
});
