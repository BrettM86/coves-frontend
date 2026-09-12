<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { coves } from '$lib/api/client.svelte'
  import type { ProfileViewDetailed } from '$lib/api/coves/types'
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import { feeds } from '$lib/feature/feeds/feed.svelte'
  import { Button, Label, TextArea, TextInput, toast } from '$lib/ui/kit'
  import { Upload } from '$lib/ui/kit/icon'
  import { onDestroy } from 'svelte'
  import AvatarCropper from './AvatarCropper.svelte'
  import {
    initialProfileValues,
    ProfileFormError,
    profileUpdateInput,
    type ProfileFormValues,
  } from './(local_user)/settings/profile-form'

  interface Props {
    profile: ProfileViewDetailed
    oncancel?: () => void
    onsaved?: () => void
  }

  let { profile: userProfile, oncancel, onsaved }: Props = $props()

  // Seed once so a refresh cannot erase an edit that is already in progress.
  // svelte-ignore state_referenced_locally
  let formData: ProfileFormValues = $state(initialProfileValues(userProfile))
  let loading = $state(false)
  let avatarInput: HTMLInputElement | undefined = $state()
  let pendingAvatarFile: File | undefined = $state()
  let avatarBeforeCrop: File | undefined
  let avatarPreviewUrl: string | undefined = $state()
  let displayedAvatar = $derived(avatarPreviewUrl ?? userProfile.avatar)
  let destroyed = false

  onDestroy(() => {
    destroyed = true
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
  })

  function cancelAvatarCrop(): void {
    formData.avatarFile = avatarBeforeCrop
    pendingAvatarFile = undefined
  }

  function useCroppedAvatar(file: File): void {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
    avatarPreviewUrl = URL.createObjectURL(file)
    formData.avatarFile = file
    pendingAvatarFile = undefined
  }

  async function save(): Promise<void> {
    if (loading) return
    loading = true
    const submittedValues = { ...formData }
    const submittedAvatarPreviewUrl = avatarPreviewUrl

    try {
      await coves().updateProfile(await profileUpdateInput(submittedValues))
      feeds.clear()
      await invalidateAll()
      if (formData.avatarFile === submittedValues.avatarFile) {
        formData.avatarFile = undefined
        if (avatarInput) avatarInput.value = ''
      }
      if (avatarPreviewUrl === submittedAvatarPreviewUrl) {
        if (submittedAvatarPreviewUrl)
          URL.revokeObjectURL(submittedAvatarPreviewUrl)
        avatarPreviewUrl = undefined
      }
      toast({ content: $t('toast.profileUpdated'), type: 'success' })
      if (!destroyed) onsaved?.()
    } catch (err) {
      if (isExpiredSessionError(err) && authProfile.sessionExpired) return
      const content =
        err instanceof ProfileFormError
          ? $t(
              err.code === 'avatar-too-large'
                ? 'form.profile.avatarTooLarge'
                : 'form.profile.avatarInvalidType',
            )
          : errorMessage(err)
      toast({ content, type: 'error' })
    } finally {
      loading = false
    }
  }
</script>

<form
  class="flex min-h-0 flex-col gap-4"
  onsubmit={(event) => {
    event.preventDefault()
    save()
  }}
>
  <TextInput
    id="profile-display-name"
    label={$t('form.profile.displayName')}
    bind:value={formData.displayName}
    placeholder={$t('form.profile.optional')}
    class="text-base sm:text-sm"
    disabled={loading}
  />
  <TextArea
    id="profile-bio"
    label={$t('form.profile.bio')}
    bind:value={formData.bio}
    rows={5}
    class="text-base sm:text-sm"
    disabled={loading}
  />

  <div class="flex flex-col gap-2">
    <Label for="profile-avatar" text={$t('form.profile.avatar')} />
    <div class="flex items-center gap-4">
      {#if displayedAvatar}
        <img
          src={displayedAvatar}
          alt={$t('form.profile.avatar')}
          class="size-20 shrink-0 rounded-full object-cover"
        />
      {/if}
      <input
        id="profile-avatar"
        bind:this={avatarInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={loading}
        onchange={(event) => {
          const selected = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!selected) return
          avatarBeforeCrop = formData.avatarFile
          formData.avatarFile = selected
          pendingAvatarFile = selected
        }}
        class="sr-only text-base sm:text-sm"
      />
      <div class="flex min-w-0 flex-col items-start gap-2">
        <Button
          size="lg"
          icon={Upload}
          aria-describedby="profile-avatar-selection"
          disabled={loading}
          onclick={() => avatarInput?.click()}
        >
          {$t('form.post.selectFile')}
        </Button>
        <p
          id="profile-avatar-selection"
          aria-live="polite"
          class={[
            'max-w-full break-all text-sm text-slate-600 dark:text-zinc-400',
            !formData.avatarFile && 'sr-only',
          ]}
        >
          {formData.avatarFile?.name ?? ''}
        </p>
      </div>
    </div>
  </div>

  <div class="mt-2 flex gap-2">
    {#if oncancel}
      <Button size="lg" class="flex-1" disabled={loading} onclick={oncancel}>
        {$t('common.cancel')}
      </Button>
    {/if}
    <Button
      submit
      size="lg"
      color="primary"
      class="flex-1"
      {loading}
      disabled={loading}
    >
      {$t('common.save')}
    </Button>
  </div>
</form>

{#if pendingAvatarFile}
  <AvatarCropper
    file={pendingAvatarFile}
    oncancel={cancelAvatarCrop}
    oncropped={useCroppedAvatar}
  />
{/if}
