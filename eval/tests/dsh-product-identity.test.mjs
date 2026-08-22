import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('release copy and package metadata use the DSH Desktop community identity', () => {
  assert.match(read('README.md'), /^<h1 align="center">DSH Desktop<\/h1>$/m)
  assert.equal(JSON.parse(read('package.json')).productName, 'DSH Desktop')
  const electronManifest = JSON.parse(read('electron/package.json'))
  assert.equal(electronManifest.build.productName, 'DSH Desktop')
  assert.equal(JSON.parse(read('electron/package.json')).build.appId, 'com.vibeinging.dsh-desktop')
  assert.equal(electronManifest.author, 'vibeinging')
  assert.match(read('server/src/config/app_name.js'), /DSH Desktop/)
  assert.match(read('server/.agents/plugins/marketplace.json'), /DSH 内置能力/)
})

test('product data and protocol names keep stable DSH and dsh-work namespaces', () => {
  assert.match(read('README.md'), /\.dsh/)
  assert.match(read('electron/main.js'), /USER_DATA_DIR_NAME = 'dsh-electron'/)
  assert.doesNotMatch(read('electron/main.js'), /\bipcMain\b|preload\s*:|window\.electronAPI/)
  assert.equal(JSON.parse(read('electron/package.json')).build.files.includes('preload.js'), false)
  assert.equal(existsSync(new URL('../../packages/dsh-work-shell/package.json', import.meta.url)), false)
  assert.equal(existsSync(new URL('../../packages/dsh-workbench-pages/package.json', import.meta.url)), false)
  assert.match(read('packages/dsh-work-references/package.json'), /@vibeinging\/dsh-work-references/)
})
