import type {
  AtUri,
  AuthorView,
  CommentView,
  PostView,
} from '$lib/api/coves/types'
import { coves } from '$lib/api/client.svelte'
import { toast } from 'mono-svelte'
import { isCommentView } from './item.svelte'

export type SubmissionView = PostView | CommentView

export interface ContentView {
  type: 'post' | 'comment'
  title?: string
  body: string
  creator?: AuthorView
  uri: AtUri
}

const isSubmissionView = (
  item: SubmissionView | ContentView,
): item is SubmissionView => !('type' in item)

export const contentView = (item: SubmissionView): ContentView => {
  if (isCommentView(item))
    return {
      type: 'comment',
      body: item.record.content,
      creator: item.author,
      uri: item.uri,
    }
  else
    return {
      type: 'post',
      body: item.record?.content ?? item.record?.title ?? '',
      title: item.record?.title,
      creator: item.author,
      uri: item.uri,
    }
}

/**
 * @deprecated No Coves API for saving items yet.
 * Returns false to indicate the save did not occur, not the item's saved state.
 */
export async function save(
  _item: ContentView | SubmissionView,
  _save: boolean,
): Promise<boolean> {
  toast({
    content: 'Saving items is not yet available',
    type: 'warning',
  })
  return false
}

export async function deleteItem(
  item: ContentView | SubmissionView,
  deleted: boolean = true,
): Promise<boolean> {
  if (!deleted) {
    console.warn('[contentview] Un-delete is not supported in the Coves API')
    toast({
      content: 'Restoring deleted items is not yet supported',
      type: 'warning',
    })
    return false
  }

  try {
    const resolved = isSubmissionView(item) ? contentView(item) : item

    if (resolved.type === 'post') {
      await coves().deletePost({ uri: resolved.uri })
      return true
    } else if (resolved.type === 'comment') {
      await coves().deleteComment({ uri: resolved.uri })
      return true
    }
    console.warn(
      '[contentview] deleteItem: unrecognized content type',
      resolved.type,
    )
    toast({ content: 'Cannot delete this type of content', type: 'warning' })
    return false
  } catch (err) {
    console.error('[contentview] deleteItem failed:', err)
    toast({
      content: 'Failed to delete item',
      type: 'error',
    })
    return false
  }
}

/**
 * @deprecated No Coves API for marking posts as read.
 * Returns false to indicate the operation did not occur, not the item's read state.
 */
export async function markAsRead(
  _item: ContentView | SubmissionView,
  _read: boolean,
): Promise<boolean> {
  toast({
    content: 'Marking as read is not yet available',
    type: 'warning',
  })
  return false
}
