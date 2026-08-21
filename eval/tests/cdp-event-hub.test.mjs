import assert from 'node:assert/strict';
import test from 'node:test';

import { createCdpEventHub } from '../lib/cdp.mjs';

test('CDP event hub forwards diagnostics and supports unsubscribe', () => {
  const hub = createCdpEventHub();
  const received = [];
  const unsubscribe = hub.on('Runtime.exceptionThrown', (payload) => received.push(payload));
  hub.emit('Runtime.exceptionThrown', { text: 'first' });
  unsubscribe();
  hub.emit('Runtime.exceptionThrown', { text: 'second' });
  assert.deepEqual(received, [{ text: 'first' }]);
});
