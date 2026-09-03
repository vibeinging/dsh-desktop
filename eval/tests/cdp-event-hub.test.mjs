import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCdpEventHub,
  createEvalElectronArgs,
  createEvalApiBridgeScript,
  resolveRendererLaunchMode,
} from '../lib/cdp.mjs';

test('CDP event hub forwards diagnostics and supports unsubscribe', () => {
  const hub = createCdpEventHub();
  const received = [];
  const unsubscribe = hub.on('Runtime.exceptionThrown', (payload) => received.push(payload));
  hub.emit('Runtime.exceptionThrown', { text: 'first' });
  unsubscribe();
  hub.emit('Runtime.exceptionThrown', { text: 'second' });
  assert.deepEqual(received, [{ text: 'first' }]);
});

test('source eval launches the official Web surface without the retired Renderer', () => {
  assert.equal(resolveRendererLaunchMode({ isolate: true }), 'official-web');
  assert.equal(resolveRendererLaunchMode({ isolate: false }), 'official-web');
  assert.equal(resolveRendererLaunchMode({ packagedApp: true }), 'packaged-app');
});

test('the isolated official Web bridge limits product requests to the loopback API', () => {
  const source = createEvalApiBridgeScript({ apiBaseUrl: 'http://127.0.0.1:52991' });
  assert.match(source, /http:\/\/127\.0\.0\.1:52991/);
  assert.match(source, /url\.startsWith\('\/api\/'\)/);
  assert.match(source, /apiRequest/);
  assert.match(source, /streamStart/);
  assert.doesNotMatch(source, /ipcRenderer|contextBridge|preload/);
});

test('eval Electron disables browser cross-origin checks only in its isolated child', () => {
  assert.deepEqual(createEvalElectronArgs({ port: 9333, packaged: true }), [
    '--remote-debugging-port=9333',
    '--disable-web-security',
  ]);
  const sourceArgs = createEvalElectronArgs({ port: 9334, isolated: true });
  assert.deepEqual(sourceArgs.slice(0, 3), [
    '.',
    '--remote-debugging-port=9334',
    '--disable-web-security',
  ]);
});
