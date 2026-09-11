<script lang="ts">
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { t } from '$lib/app/state/i18n'
  import MarkdownEditor from '$lib/feature/markdown/MarkdownEditor.svelte'
  import { parseMarkup } from '$lib/feature/richtext/compose'
  import RichText from '$lib/feature/richtext/RichText.svelte'
  import { communityAddress } from '$lib/app/util/community'
  import { placeholders } from '$lib/app/util/placeholders'
  import FreeTextInput from '$lib/ui/form/FreeTextInput.svelte'
  import ObjectAutocomplete from '$lib/ui/form/ObjectAutocomplete.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import ErrorContainer, { pushError } from '$lib/ui/info/ErrorContainer.svelte'
  import { Header } from '$lib/ui/layout'
  import { Button, Label, Switch, TextInput } from '$lib/ui/kit'
  import { untrack, type Snippet } from 'svelte'
  import { PostFormState, type PostSubmitResult } from './post-form.svelte'

  interface Props {
    init?: PostFormState
    title?: Snippet
    onsubmit?: (result: PostSubmitResult) => void
  }

  let { init, title, onsubmit }: Props = $props()

  // `init` is by contract the initial form state only — the form owns its
  // contents from here on, and re-seeding would discard the user's edits.
  let form = $state<PostFormState>(untrack(() => init) ?? new PostFormState())

  let loading = $state<boolean>(false)

  // autofillPost was removed as it depends on the Lemmy getSiteMetadata API.
  // TODO(coves-migration): re-enable when a Coves equivalent is available.
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    if (loading) return
    loading = true

    form
      .submit()
      .catch((err: unknown) => {
        // Only failed creation can be retried; navigation must not create another post.
        loading = false
        throw err
      })
      .then((result) => {
        onsubmit?.(result)
      })
      .catch((err: unknown) => {
        if (isExpiredSessionError(err) && profile.sessionExpired) return
        pushError({
          message: errorMessage(
            err instanceof Error ? err.message : String(err),
          ),
          scope: 'post-form',
        })
      })
  }}
  class="flex flex-col gap-4 h-full"
>
  {#if title}
    {@render title()}
  {:else}
    <Header class="font-bold text-xl">
      {$t('form.post.create')}
    </Header>
  {/if}
  <ErrorContainer scope="post-form" />
  {#if !form.community}
    <ObjectAutocomplete
      label={$t('form.post.community')}
      onselect={(c) => {
        form.community = c
      }}
      required
    />
  {:else}
    <div class="flex flex-col gap-1">
      <Label>{$t('form.post.community')}</Label>
      <Button
        class="w-full"
        onclick={() => (form.community = undefined)}
        alignment="left"
        size="sm"
        rounding="xl"
      >
        {#snippet prefix()}
          <Avatar
            url={form.community?.avatar}
            alt={form.community?.name}
            width={24}
          />
        {/snippet}
        <div class="flex flex-col gap-0">
          <span class="text-sm">{form.community.name}</span>
          <span class="text-[10px] leading-3">
            {communityAddress(form.community)}
          </span>
        </div>
      </Button>
    </div>
  {/if}

  <FreeTextInput
    required
    bind:value={form.title}
    placeholder={placeholders.get('post')}
    label={$t('form.post.title')}
    class="font-display font-medium text-2xl"
  />
  <MarkdownEditor
    label={$t('form.post.body')}
    bind:value={form.body}
    placeholder={placeholders.get('body')}
    previewButton
  >
    <!-- The preview compiles the markup, so it shows what every client will
         render rather than what a markdown parser makes of it. -->
    {#snippet preview(source)}
      {@const parsed = parseMarkup(source)}
      <RichText content={parsed.content} facets={parsed.facets} />
    {/snippet}
  </MarkdownEditor>

  <TextInput
    label={$t('form.post.url')}
    bind:value={form.url}
    placeholder={placeholders.get('url')}
  />

  <Switch bind:checked={form.nsfw}>{$t('form.post.nsfw')}</Switch>

  <Button submit color="primary" {loading} size="lg" class="mt-auto">
    {$t('form.submit')}
  </Button>
</form>
