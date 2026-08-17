import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL(
  '../../../packages/dsh-client-product-search-mode/src/client/index.ts',
  import.meta.url
)), 'utf8')

describe('dsh product search-mode Client plugin', () => {
  it('declares the narrow service and standard input-left Slot contribution', () => {
    expect(source).toContain("export const inject = ['slots', 'locale', 'dshWorkProductSearchMode']")
    expect(source).toContain("ctx.slots.inject('conversation.input.left'")
    expect(source).toContain("id: 'dsh-work-search-mode'")
    expect(source).toContain("'data-dsh-product-search-mode': true")
    expect(source).toContain('ctx.dshWorkProductSearchMode.cycle(sessionId)')
  })
})
