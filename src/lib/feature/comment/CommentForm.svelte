<script lang="ts">
  import { browser } from '$app/environment'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { coves } from '$lib/api/client.svelte'
  import { parseAtUri } from '$lib/api/coves/types'
  import type { PostEmbed, StrongRef } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { loginUrl } from '$lib/app/util/login-url'
  import {
    restoreCommentDraft,
    saveComposerDraft,
  } from '$lib/feature/image-upload/draft-restore'
  import { log } from '$lib/app/util/log'
  import { t } from '$lib/app/state/i18n'
  import { Attachments } from '$lib/feature/image-upload/attachments.svelte'
  import AttachmentStrip from '$lib/feature/image-upload/AttachmentStrip.svelte'
  import { embedImages } from '$lib/feature/post/helpers'
  import MarkdownEditor from '$lib/feature/markdown/MarkdownEditor.svelte'
  import { insertPlacementToken } from '$lib/feature/image-upload/placement-tokens'
  import PostGallery from '$lib/feature/post/media/PostGallery.svelte'
  import { parseMarkup } from '$lib/feature/richtext/compose'
  import { imageLayout } from '$lib/feature/richtext/image-layout'
  import RichText from '$lib/feature/richtext/RichText.svelte'
  import {
    createOptimisticCommentView,
    type NormalizedCommentView,
  } from './comments.svelte'
  import { buildCommentCreate } from './comment-submit'
  import { placeholders } from '$lib/app/util/placeholders'
  import { Button, toast } from '$lib/ui/kit'
  import { Icon, X } from '$lib/ui/kit/icon'
  import { onDestroy, untrack } from 'svelte'
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
    /** The edited comment's embed: its images preview and can be placed. */
    savedEmbed?: PostEmbed
    /** Called when a submit starts (true) and when it settles (false). */
    onloadingchange?: (loading: boolean) => void
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
    savedEmbed = undefined,
    oncancel,
    oncomment,
    onconfirm,
    onloadingchange,
    ...rest
  }: Props = $props()

  // A draft saved before a sign-in redirect refills a new comment's text.
  untrack(() => {
    if (!browser || editing) return
    const restored = restoreCommentDraft(
      page.url.pathname,
      parentRef?.uri ?? postRef.uri,
    )
    if (restored !== undefined) value = restored
  })

  /** Keeps the typed text (never the images) and goes to sign in again. */
  function signIn() {
    saveComposerDraft(page.url.pathname, {
      kind: 'comment',
      parentUri: parentRef?.uri ?? postRef.uri,
      body: value,
    })
    // A reply returns to its parent's anchor, so the thread mounts that row.
    goto(
      loginUrl(
        parentRef
          ? new URL(`#comment-${parseAtUri(parentRef.uri).rkey}`, page.url)
          : page.url,
      ),
    )
  }

  let loading = $state(false)
  /** The images attached to the comment, uploaded on submit. */
  let attachments = $state(new Attachments({ target: 'comment' }))
  /** The last strip whose previews a created comment shows. */
  let handedOff: Attachments | undefined
  /** Aborted when the form closes, so a running submit creates no comment. */
  const submission = new AbortController()

  let editor = $state<ReturnType<typeof MarkdownEditor>>()
  const savedImages = $derived(embedImages(savedEmbed))
  const previewEmbed = $derived(
    editing ? savedEmbed : attachments.previewEmbed(),
  )

  function insertPlacement(number: number, alt: string) {
    editor?.insert((text, caret) =>
      insertPlacementToken(text, caret, alt, number),
    )
  }

  onDestroy(() => {
    submission.abort()
    // A teardown reads state from before the update that closed the form, so
    // after a reply that is still the strip handed to the created comment.
    if (attachments !== handedOff) attachments.releasePreviews()
  })

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
    const notifyCreated = oncomment
    const notifyLoading = onloadingchange
    const author = {
      did: profile.current.did,
      handle: profile.current.handle,
      avatar: profile.current.avatar,
    }

    // Locked before the wait, so no image picked meanwhile misses the upload.
    loading = true
    notifyLoading?.(true)
    // An image still being checked joins the strip before the guard.
    await attachments.whenAdded()
    if (value.trim() === '' && attachments.items.length === 0) {
      loading = false
      notifyLoading?.(false)
      return
    }

    const sending = attachments
    try {
      // Images that already have a blob ref, from an earlier failed submit,
      // are not uploaded again; any failed upload stops the comment.
      await sending.uploadMissing(coves(), submission.signal)
      // Comments only ever carry images, never a link (PRD §3.4).
      const attached = sending.embedFor()
      const embed =
        attached?.$type === 'social.coves.embed.images' ? attached : undefined
      // The textarea holds markup; the record carries canonical plaintext plus
      // facets, compiled here.
      const input = await buildCommentCreate({
        source: value,
        postRef,
        parentRef,
        resolver: coves(),
        embed,
      })
      submission.signal.throwIfAborted()
      const response = await coves().createComment(input)
      // The created comment now shows these previews: a fresh strip replaces
      // them, so neither a reset nor closing the form revokes them.
      handedOff = sending
      attachments = new Attachments({ target: 'comment' })
      notifyCreated?.(
        createOptimisticCommentView(
          response,
          input.content,
          input.reply.root,
          input.reply.parent,
          author,
          input.facets,
          embed && {
            embed,
            previews: sending.items.map((item) => ({
              previewUrl: item.previewUrl,
              alt: item.alt.trim() || undefined,
              aspectRatio: item.aspectRatio,
            })),
          },
        ),
      )

      value = ''
    } catch (err) {
      log.error('[CommentForm] createComment failed', err)
      // A failed upload shows its error on its own tile.
      const onTile = sending.items.some((item) => item.error === err)
      const quiet =
        submission.signal.aborted ||
        onTile ||
        (isExpiredSessionError(err) && profile.sessionExpired)
      if (!quiet) {
        toast({
          content: errorMessage(err),
          type: 'error',
        })
      }
    }

    loading = false
    notifyLoading?.(false)
  }

  /**
   * Images dropped or pasted into the comment join the attachment strip,
   * except while a submit runs or a comment is being edited.
   */
  function addTransferredFiles(event: Event, files: FileList | undefined) {
    if (editing || !files || files.length === 0) return
    event.preventDefault()
    if (!loading) void attachments.add(Array.from(files))
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    submit()
  }}
  ondragover={(event) => {
    if (!editing && event.dataTransfer?.types.includes('Files'))
      event.preventDefault()
  }}
  ondrop={(event) => addTransferredFiles(event, event.dataTransfer?.files)}
  onpaste={(event) => addTransferredFiles(event, event.clipboardData?.files)}
  class="flex flex-col gap-2 relative"
>
  <MarkdownEditor
    bind:this={editor}
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
      {@const embed = previewEmbed}
      {@const parsed = parseMarkup(source, {
        imageCount: embedImages(embed).length,
      })}
      {@const layout = imageLayout(embed, parsed.content, parsed.facets)}
      <RichText content={parsed.content} facets={parsed.facets} {embed} />
      {#if layout.gallery.length > 0}
        <PostGallery
          images={layout.gallery}
          placedImages={[...layout.placed.values()]}
          fitHeight
        />
      {/if}
    {/snippet}
    <div class="flex-1"></div>
    {#if actions}
      <Button
        size="custom"
        title={$t('common.cancel')}
        onclick={() => oncancel?.(true)}
        disabled={loading}
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
  {#if !editing}
    <AttachmentStrip
      {attachments}
      bind:text={value}
      oninsert={insertPlacement}
      busy={loading}
      onretry={submit}
      onsignin={signIn}
    />
  {:else}
    <AttachmentStrip images={savedImages} oninsert={insertPlacement} />
  {/if}
</form>
