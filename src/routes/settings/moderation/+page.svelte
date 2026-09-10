<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { profile } from '$lib/app/state/auth.svelte'
  import MarkdownEditor from '$lib/feature/markdown/MarkdownEditor.svelte'
  import { settings } from '$lib/app/state/settings.svelte'

  import { CommonList } from '$lib/ui/layout'
  import { Button, Expandable, TextInput } from '$lib/ui/kit'
  import { Icon, Ban, Plus, Trash2 } from '$lib/ui/kit/icon'
  import { removalTemplate } from '$lib/feature/moderation/moderation.svelte'
  import Setting from '../Setting.svelte'
</script>

<CommonList>
  {#if profile.isAuthenticated}
    <Setting icon={Ban}>
      {#snippet title()}
        <span>{$t('settings.moderation.blocks.title')}</span>
      {/snippet}
      {#snippet description()}
        <span>{$t('settings.moderation.blocks.description')}</span>
      {/snippet}
      <Button href="/profile/blocks" size="lg">
        {$t('settings.moderation.blocks.manage')}
      </Button>
    </Setting>
  {/if}
  <Setting icon={Trash2} adaptive={false}>
    {#snippet title()}
      <span>{$t('settings.moderation.replyPresets.title')}</span>
    {/snippet}
    {#snippet description()}
      <span>
        <p>{$t('settings.moderation.replyPresets.description')}</p>
        <ul class="leading-6">
          <li>{$t('settings.moderation.replyPresets.syntax')}</li>
          <li>
            <code>{'{{reason}}'}</code>
          </li>
          <li>
            <code>{'{{post}}'}</code>
          </li>
          <li>
            <code>{'{{community}}'}</code>
          </li>
          <li>
            <code>{'{{username}}'}</code>
          </li>
        </ul>
      </span>
    {/snippet}
  </Setting>
  {#each settings.moderation.presets as preset, index (preset)}
    <li>
      <Expandable>
        {#snippet title()}
          {preset.title}
        {/snippet}
        <div class="flex flex-col gap-3">
          <TextInput
            label="Title"
            bind:value={preset.title}
            placeholder="Reason 1"
          />
          <MarkdownEditor
            bind:value={preset.content}
            label="Content"
            previewButton
            beforePreview={(input) =>
              removalTemplate(input ?? '', {
                postTitle: 'Example Post',
                communityLink: 'example-community',
                username: 'example-user',
                reason: 'example reason',
              })}
          />

          <Button
            color="danger"
            rounding="pill"
            onclick={() => {
              settings.moderation.presets.splice(index, 1)
              settings.moderation.presets = settings.moderation.presets
            }}
            class="w-max"
          >
            <Icon src={Trash2} size="16" />
            {$t('common.remove')}
          </Button>
        </div>
      </Expandable>
    </li>
  {/each}
  <li>
    <Button
      color="none"
      class="w-full p-2"
      onclick={() => {
        settings.moderation.presets = [
          ...settings.moderation.presets,
          {
            title: `Preset ${settings.moderation.presets.length + 1}`,
            content:
              'Your submission in *{{post}}* was removed for *{{reason}}*.',
          },
        ]
      }}
      icon={Plus}
    >
      Add Preset
    </Button>
  </li>
</CommonList>
