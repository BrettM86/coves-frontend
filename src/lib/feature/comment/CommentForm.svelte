<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type { CreateCommentOutput, StrongRef } from '$lib/api/coves/types'
  import { profile } from '$lib/app/auth.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import MarkdownEditor from '$lib/app/markdown/MarkdownEditor.svelte'
  import { placeholders } from '$lib/app/util.svelte'
  import { Button, toast } from 'mono-svelte'
  import { Icon, XMark } from 'svelte-hero-icons/dist'
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
    oncomment?: (output: CreateCommentOutput, content: string) => void
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
  let preview = false

  async function submit() {
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

    loading = true

    try {
      const response = await coves().createComment({
        reply: {
          root: postRef,
          parent: parentRef ?? postRef,
        },
        content: value,
      })
      oncomment?.(response, value)

      value = ''
    } catch (err) {
      console.error(err)
      toast({
        content: errorMessage(err),
        type: 'error',
      })
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
  {#if preview}
    <div
      class="bg-slate-100 dark:bg-zinc-900 px-3 py-2.5 h-64 border
      border-slate-300 dark:border-zinc-700 rounded-md overflow-auto text-sm resize-y"
    >
      <Markdown source={value} />
    </div>
  {:else}
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
          <Icon
            src={XMark}
            size="16"
            micro
            class="text-slate-600 dark:text-zinc-400"
          />
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
  {/if}
</form>
