import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..', '..');
const readAppFile = (...parts) => fs.readFileSync(path.join(appRoot, ...parts), 'utf8');

test('the Electron Host locks native page zoom for the official Web surface', () => {
  const main = readAppFile('electron', 'main.js');

  assert.doesNotMatch(main, /role:\s*['"](resetZoom|zoomIn|zoomOut)['"]/);
  assert.match(main, /function lockPageZoom/);
  assert.match(main, /setZoomLevel\(0\)/);
  assert.match(main, /setZoomFactor\(1\)/);
  assert.match(main, /setVisualZoomLevelLimits\(1,\s*1\)/);
});
