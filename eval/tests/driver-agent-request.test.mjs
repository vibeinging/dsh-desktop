import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentRequestBody } from '../lib/driver.mjs';

test('eval Agent request mirrors the real desktop client capability contract', () => {
  const body = buildAgentRequestBody({
    message: 'hello',
    searchMode: 'required',
    collaborationMode: 'plan',
    input: [
      { type: 'text', text: 'hello' },
      { type: 'localImage', path: '/tmp/fixture.png' },
    ],
  });

  assert.equal(body.searchMode, 'required');
  assert.equal(body.collaborationMode, 'plan');
  assert.equal(body.input[1].type, 'localImage');
  assert.equal(body.clientCapabilities.surface, 'desktop');
  assert.equal(body.clientCapabilities.openLocalFile, true);
});

test('eval Agent request can explicitly override one advertised capability', () => {
  const body = buildAgentRequestBody({
    message: 'hello',
    clientCapabilities: { openLocalFile: false },
  });
  assert.equal(body.clientCapabilities.openLocalFile, false);
  assert.equal(body.clientCapabilities.renderMarkdown, true);
});
