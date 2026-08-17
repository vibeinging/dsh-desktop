export type DshWorkProductSearchMode = 'auto' | 'required' | 'off'

/** Advance the product web policy through its three explicit turn modes. */
export function nextProductSearchMode(mode: DshWorkProductSearchMode): DshWorkProductSearchMode {
  if (mode === 'auto') return 'required'
  if (mode === 'required') return 'off'
  return 'auto'
}
