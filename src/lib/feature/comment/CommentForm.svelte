<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { StrongRef } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { log } from '$lib/app/util/log'
  import { t } from '$lib/app/state/i18n'
  import MarkdownEditor from '$lib/feature/markdown/MarkdownEditor.svelte'
  import { parseMarkup } from '$lib/feature/richtext/compose'
  import RichText from '$lib/feature/richtext/RichText.svelte'
  import {
    createOptimisticCommentView,
    type NormalizedCommentView,
  } from './comments.svelte'
  import { buildCommentCreate } from './comment-submit'
  import { placeholders } from '$lib/app/util/placeholders'
  import { Button, toast } from '$lib/ui/kit'
  import { Icon, X } from '$lib/ui/kit/icon'
  import type { ClassValue, HTMLTextareaAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLTextareaAttributes, 'oncancel'> {
    postRef: StrongRef
    parentRef?: StrongRef | undefined
    locked?: boolean
    banned?: boolean
    rows?: number
    placeholder?: string | undefined
    value?: string
    actions?: boolean
    tools?: boolean
    preview?: boolean
    class?: ClassValue
    required?: boolean
    id?: string
    label?: string
    editing?: boolean
    /** The confirmed write, including the author and refs captured at submit. */
    oncomment?: (comment: NormalizedCommentView) => void
    onconfirm?: (value: string) => void
    oncancel?: (cancel: boolean) => void
  }

  let {
    postRef,
    parentRef = undefined,
    locked = false,
    banned = false,
    rows = 7,
    placeholder = undefined,
    value = $bindable(''),
    actions = true,
    preview: previewAction = true,
    editing = false,
    oncancel,
    oncomment,
    onconfirm,
    ...rest
  }: Props = $props()

  let loading = $state(false)

  async function submit() {
    if (loading) return
    // In editing mode, submission (e.g. Ctrl+Enter) is delegated to the
    // parent via onconfirm, which performs its own auth/content validation.
    if (editing) {
      onconfirm?.(value)
      return
    }
    if (!profile.current?.jwt) {
      toast({ content: $t('toast.loginVoteGate'), type: 'warning' })
      return
    }
    if (value.trim() === '') return

    const notifyCreated = oncomment
    const author = {
      did: profile.current.did,
      handle: profile.current.handle,
      avatar: profile.current.avatar,
    }

    loading = true

    try {
      // The textarea holds markup; the record carries canonical plaintext plus
      // facets, compiled here.
      const input = await buildCommentCreate({
        source: value,
        postRef,
        parentRef,
        resolver: coves(),
      })
      const response = await coves().createComment(input)
      notifyCreated?.(
        createOptimisticCommentView(
          response,
          input.content,
          input.reply.root,
          input.reply.parent,
          author,
          input.facets,
        ),
      )

      value = ''
    } catch (err) {
      log.error('[CommentForm] createComment failed', err)
      if (!(isExpiredSessionError(err) && profile.sessionExpired)) {
        toast({
          content: errorMessage(err),
          type: 'error',
        })
      }
    }

    loading = false
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    submit()
  }}
  class="flex flex-col gap-2 relative"
>
  <MarkdownEditor
    {...rest}
    {rows}
    placeholder={locked
      ? $t('comment.locked')
      : banned
        ? $t('comment.banned')
        : (placeholder ?? placeholders.get('comment'))}
    bind:value
    disabled={locked || loading || banned}
    previewButton={previewAction}
  >
    {#snippet preview(source)}
      {@const parsed = parseMarkup(source)}
      <RichText content={parsed.content} facets={parsed.facets} />
    {/snippet}
    <div class="flex-1"></div>
    {#if actions}
      <Button
        size="custom"
        title={$t('common.cancel')}
        onclick={() => oncancel?.(true)}
        color="tertiary"
        class="w-8 h-8"
        rounding="xl"
      >
        <Icon src={X} size="16" class="text-slate-600 dark:text-zinc-400" />
      </Button>
      <Button
        submit
        color="primary"
        rounding="xl"
        {loading}
        disabled={locked || loading || banned}
      >
        {$t('form.submit')}
      </Button>
    {/if}
  </MarkdownEditor>
</form>
