import type { IconSource } from 'svelte-hero-icons/dist'

export interface SelectOption {
  value: string
  label: string
  icon?: IconSource
  disabled?: boolean
  isLabel?: boolean
}

/**
 * Shared between `Select` (which owns the reactive list) and every `Option`
 * rendered inside it (each registers itself here).
 */
export interface SelectContext {
  options: SelectOption[]
}

export const SELECT_CONTEXT = Symbol('select')
