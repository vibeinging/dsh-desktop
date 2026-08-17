import { describe, expect, it } from 'vitest'
import { nextProductSearchMode } from './ProductSearchMode'

describe('product search mode', () => {
  it('cycles through the three explicit turn policies', () => {
    expect(nextProductSearchMode('auto')).toBe('required')
    expect(nextProductSearchMode('required')).toBe('off')
    expect(nextProductSearchMode('off')).toBe('auto')
  })
})
