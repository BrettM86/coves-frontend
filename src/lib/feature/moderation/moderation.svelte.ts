import type {
  AuthorView,
  CommentView,
  CommunityRef,
  PostView,
} from '$lib/api/coves/types'
import { toast } from 'mono-svelte'
import type { SubmissionView } from '../legacy/contentview'

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
  removing: {
    open: boolean
    item: SubmissionView | undefined
    purge: boolean
  }
  banning: {
    open: boolean
    banned: boolean
    user: AuthorView | undefined
    community: CommunityRef | undefined
  }
  votes: {
    open: boolean
    item: PostView | CommentView | undefined
  }
}

export const modals: Modals = $state({
  reporting: {
    open: false,
    item: undefined,
  },
  removing: {
    open: false,
    item: undefined,
    purge: false,
  },
  banning: {
    open: false,
    banned: false,
    user: undefined,
    community: undefined,
  },
  votes: {
    open: false,
    item: undefined,
  },
})

export function report(item: PostView | CommentView) {
  modals.reporting = { open: true, item }
}

export function remove(item: SubmissionView, purge: boolean = false) {
  modals.removing = { open: true, item, purge }
}

export function ban(
  banned: boolean,
  item: AuthorView,
  community?: CommunityRef,
) {
  modals.banning = { open: true, user: item, banned, community }
}

/**
 * @deprecated No Coves API for distinguishing comments
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
export function feature(
  _featured: boolean,
  _item: CommentView,
  _jwt: string,
): void {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  toast({
    content: 'Comment distinguishing is not yet available',
    type: 'warning',
  })
}

export async function viewVotes(item: PostView | CommentView) {
  modals.votes = { open: true, item }
}

export const removalTemplate = (
  input: string,
  content: {
    postTitle?: string
    communityLink?: string
    username?: string
    reason?: string
  },
) => {
  if (content.postTitle) input = input.replaceAll('{{post}}', content.postTitle)
  if (content.communityLink)
    input = input.replaceAll('{{community}}', content.communityLink)
  if (content.username)
    input = input.replaceAll('{{username}}', content.username)
  if (content.reason) input = input.replaceAll('{{reason}}', content.reason)
  return input
}
