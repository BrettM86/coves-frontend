<script lang="ts">
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'
  import MarkdownEditor from '$lib/app/markdown/MarkdownEditor.svelte'
  import { placeholders } from '$lib/app/util.svelte'
  import FreeTextInput from '$lib/ui/form/FreeTextInput.svelte'
  import ImageInputModal from '$lib/ui/form/ImageInputModal.svelte'
  import ObjectAutocomplete from '$lib/ui/form/ObjectAutocomplete.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import ErrorContainer, { pushError } from '$lib/ui/info/ErrorContainer.svelte'
  import { Header } from '$lib/ui/layout'
  import {
    Button,
    ButtonGroup,
    Label,
    modal,
    Switch,
    TextArea,
    TextInput,
  } from 'mono-svelte'
  import type { Snippet } from 'svelte'
  import {
    ChatBubbleBottomCenterText,
    Photo,
    QrCode,
  } from 'svelte-hero-icons/dist'
  import { PostFormState, type PostSubmitResult } from './post-form.svelte'

  interface Props {
    init?: PostFormState
    title?: Snippet
    onsubmit?: (result: PostSubmitResult) => void
  }

  let { init, title, onsubmit }: Props = $props()

  let form = $state<PostFormState>(init ?? new PostFormState())

  let loading = $state<boolean>(false)
  let uploadImage = $state(false)
  let customThumbnail = $state(false)

  // autofillPost was removed as it depends on the Lemmy getSiteMetadata API.
  // TODO(coves-migration): re-enable when a Coves equivalent is available.
</script>

{#if uploadImage}
  <ImageInputModal
    bind:open={uploadImage}
    bind:imageUrl={() => '', (v) => (form.url = v)}
  />
{/if}

{#if customThumbnail}
  <ImageInputModal
    bind:open={customThumbnail}
    bind:imageUrl={() => form.thumbnail, (v) => (form.thumbnail = v)}
  />
{/if}

{#snippet altText()}
  <TextArea bind:value={form.altText} />
{/snippet}

<form
  onsubmit={(e) => {
    e.preventDefault()
    loading = true

    form
      .submit()
      .then((result) => {
        onsubmit?.(result)
      })
      .catch((err: unknown) =>
        pushError({
          message: errorMessage(
            err instanceof Error ? err.message : String(err),
          ),
          scope: 'post-form',
        }),
      )
      .finally(() => (loading = false))
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
            {form.community.handle ?? form.community.did}
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
  />

  <TextInput
    label={$t('form.post.url')}
    bind:value={form.url}
    placeholder={placeholders.get('url')}
  />

  <div class="flex flex-row overflow-auto gap-2 -mx-3 px-3 relative">
    <div
      class="bg-gradient-to-r from-slate-25 to-slate-25/0 dark:from-zinc-925 dark:to-zinc-925/0 absolute left-0 w-3 h-full z-10"
    ></div>
    <div
      class="bg-gradient-to-l from-slate-25 to-slate-25/0 dark:from-zinc-925 dark:to-zinc-925/0 absolute right-0 w-3 h-full z-10"
    ></div>
    <ButtonGroup
      orientation="horizontal"
      class="flex flex-row *:flex-shrink-0 w-full"
    >
      <Button
        onclick={() => {
          uploadImage = !uploadImage
        }}
        icon={Photo}
      >
        {$t('form.post.uploadImage')}
      </Button>
      {#if form.url && URL.canParse(form.url)}
        <Button
          class="animate-pop-in"
          color={(form.altText ?? '') != '' ? 'primary' : 'secondary'}
          onclick={() =>
            modal({ title: $t('form.post.altText'), snippet: altText })}
          icon={ChatBubbleBottomCenterText}
        >
          {$t('form.post.altText')}
        </Button>
      {/if}
      {#if form.url}
        <Button
          class="animate-pop-in"
          onclick={() => {
            customThumbnail = !customThumbnail
          }}
          color={form.thumbnail ? 'primary' : 'secondary'}
          icon={QrCode}
        >
          {$t('form.post.customThumbnail')}
        </Button>
      {/if}
    </ButtonGroup>
  </div>

  <Switch bind:checked={form.nsfw}>{$t('form.post.nsfw')}</Switch>

  <Button submit color="primary" {loading} size="lg" class="mt-auto">
    {$t('form.submit')}
  </Button>
</form>
