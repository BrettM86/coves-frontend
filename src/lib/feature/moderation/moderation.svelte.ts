import type { CommentView, PostView } from '$lib/api/coves/types'

/**
 * Moderation modal state. Invariant: when `open` is true, the associated
 * item/user is always defined (enforced by the helper functions below).
 *
 * A discriminated union ({ open: false } | { open: true; item: T }) would
 * be more type-safe but complicates $state() reactivity in Svelte 5 and
 * would require refactoring all modal consumers. The current approach is
 * safe given that only the helper functions below mutate this state.
 */
interface Modals {
  reporting: {
    open: boolean
    item: PostView | CommentView | undefined
  }
}

export const modals: Modals = $state({
  reporting: {
    open: false,
    item: undefined,
  },
})

export function report(item: PostView | CommentView) {
  modals.reporting = { open: true, item }
}
