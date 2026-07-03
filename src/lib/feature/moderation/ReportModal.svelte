<script lang="ts">
  import { coves } from '$lib/api/client.svelte'
  import type {
    CommentView,
    PostView,
    ReportReason,
  } from '$lib/api/coves/types'
  import { MAX_REPORT_EXPLANATION_LENGTH } from '$lib/api/coves/types'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Button, Modal, TextArea, toast } from 'mono-svelte'
  import {
    buildReportInput,
    REPORT_REASONS,
    reportErrorMessage,
  } from './reportSubmission'

  interface Props {
    open: boolean
    item?: PostView | CommentView | undefined
  }

  let { open = $bindable(), item = $bindable() }: Props = $props()

  // CommentView has a `post` ref to its parent post; PostView does not.
  const isComment = (i: PostView | CommentView): i is CommentView => 'post' in i

  let loading = $state(false)
  let reason = $state<ReportReason | undefined>(undefined)
  let explanation = $state('')

  const targetLabel = $derived(
    item ? (isComment(item) ? 'comment' : 'post') : 'content',
  )
  const explanationLength = $derived([...explanation.trim()].length)

  // Reset the form whenever the modal is opened for a (new) item.
  $effect(() => {
    if (open && item) {
      reason = undefined
      explanation = ''
    }
  })

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!item || !profile.current?.jwt || !reason || loading) return
    loading = true

    try {
      const input = buildReportInput(item.uri, reason, explanation)
      await coves().submitReport(input)
      open = false
      toast({
        content: $t('moderation.reportModal.success'),
        type: 'success',
      })
    } catch (err) {
      toast({ content: reportErrorMessage(err), type: 'error' })
    } finally {
      loading = false
    }
  }
</script>

<Modal bind:open title={$t('moderation.reportModal.title')}>
  {#if item}
    <form class="flex flex-col gap-4" onsubmit={submit}>
      <p class="text-sm text-slate-600 dark:text-zinc-400">
        Report this {targetLabel} to the instance administrators. Reports are confidential.
      </p>
      <fieldset class="flex flex-col gap-2">
        <legend
          class="mb-1 text-sm font-medium text-slate-900 dark:text-zinc-100"
        >
          {$t('moderation.reason')}
        </legend>
        {#each REPORT_REASONS as option (option.value)}
          <label
            class={[
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              reason === option.value
                ? 'border-primary-900 bg-slate-100 dark:border-primary-100 dark:bg-zinc-900'
                : 'border-slate-200 hover:bg-slate-100 dark:border-zinc-800 dark:hover:bg-zinc-900',
            ]}
          >
            <input
              type="radio"
              name="report-reason"
              class="mt-1 accent-primary-900 dark:accent-primary-100"
              value={option.value}
              bind:group={reason}
              required
            />
            <span class="flex flex-col">
              <span
                class="text-sm font-medium text-slate-900 dark:text-zinc-100"
              >
                {option.label}
              </span>
              <span class="text-xs text-slate-600 dark:text-zinc-400">
                {option.description}
              </span>
            </span>
          </label>
        {/each}
      </fieldset>
      <div class="flex flex-col gap-1">
        <TextArea
          label="Explanation (optional)"
          placeholder="Add any details that will help admins review this report"
          rows={3}
          maxlength={MAX_REPORT_EXPLANATION_LENGTH}
          bind:value={explanation}
        />
        <span class="self-end text-xs text-slate-600 dark:text-zinc-400">
          {explanationLength}/{MAX_REPORT_EXPLANATION_LENGTH}
        </span>
      </div>
      <Button
        submit
        {loading}
        disabled={loading || !reason}
        color="primary"
        size="lg"
      >
        {$t('form.submit')}
      </Button>
    </form>
  {/if}
</Modal>
