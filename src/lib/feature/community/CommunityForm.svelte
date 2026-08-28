<script lang="ts">
  import { goto } from '$app/navigation'
  import { coves } from '$lib/api/client.svelte'
  import type { CommunityVisibility } from '$lib/api/coves/types'
  import { profile } from '$lib/app/state/auth.svelte'
  import { errorMessage } from '$lib/app/util/error'
  import { t } from '$lib/app/state/i18n'
  import { communityLink } from '$lib/app/util/links'
  import MarkdownEditor from '$lib/feature/markdown/MarkdownEditor.svelte'
  import { Header } from '$lib/ui/layout'
  import { Button, Option, Select, TextInput, toast } from '$lib/ui/kit'
  import { GlobeAlt, LockClosed, MapPin } from '@xylightdev/svelte-hero-icons'

  interface Props {
    formtitle?: import('svelte').Snippet
  }

  let { formtitle }: Props = $props()

  let formData = $state({
    name: '',
    description: '',
    visibility: 'public' as CommunityVisibility,
    submitting: false,
  })

  // Backend rule: DNS-label name — alphanumeric and hyphens, must start and
  // end alphanumeric, max 63 chars. The handle becomes c-<name>.<host>.
  const NAME_PATTERN = '[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?'

  async function submit() {
    if (!profile.current?.jwt) return
    if (formData.name == '' || formData.description == '') return

    formData.submitting = true

    try {
      const res = await coves().createCommunity({
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
      })

      toast({
        content: $t('toast.updatedCommunity'),
        type: 'success',
      })

      // The create response carries no `origin`, so this lands on the legacy
      // handle URL; the community page redirects to the canonical one.
      goto(communityLink({ ...res, name: formData.name }))
    } catch (err) {
      toast({
        content: errorMessage(err),
        type: 'error',
      })
    } finally {
      formData.submitting = false
    }
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault()
    submit()
  }}
  class="flex flex-col gap-4 h-full w-full"
>
  {#if formtitle}{@render formtitle()}{:else}
    <Header>{$t('form.post.community')}</Header>
  {/if}
  <TextInput
    required
    label={$t('form.name')}
    bind:value={formData.name}
    pattern={NAME_PATTERN}
    minlength={1}
    maxlength={63}
    oninput={() => {
      formData.name = formData.name.toLowerCase().replaceAll(/[\s_]+/g, '-')
    }}
  />
  <MarkdownEditor
    previewButton
    required
    label={$t('form.description')}
    bind:value={formData.description}
  />

  <Select label="Visibility" class="w-max" bind:value={formData.visibility}>
    <Option icon={GlobeAlt} value="public">Public</Option>
    <Option icon={MapPin} value="unlisted">Unlisted</Option>
    <Option icon={LockClosed} value="private">Private</Option>
  </Select>

  <Button
    submit
    color="primary"
    size="lg"
    class="mt-auto"
    loading={formData.submitting}
    disabled={formData.submitting}
  >
    {$t('form.submit')}
  </Button>
</form>
