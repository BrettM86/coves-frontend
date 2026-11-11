<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { coves } from '$lib/api/client.svelte'
  import type {
    BlueskyProfileImportField,
    BlueskyProfileImportFieldName,
    ImportBlueskyProfileOutput,
    ProfileViewDetailed,
  } from '$lib/api/coves/types'
  import { profile as authProfile } from '$lib/app/state/auth.svelte'
  import { t } from '$lib/app/state/i18n'
  import { errorMessage } from '$lib/app/util/error'
  import { isExpiredSessionError } from '$lib/app/util/session-expired-error'
  import BlueskyImportDialog from '$lib/feature/bluesky-import/BlueskyImportDialog.svelte'
  import { warnImportFailure } from '$lib/feature/bluesky-import/failure-log'
  import { settingsOutcome } from '$lib/feature/bluesky-import/settings-outcome'
  import { feeds } from '$lib/feature/feeds/feed.svelte'
  import { Button, Label, TextArea, TextInput, toast } from '$lib/ui/kit'
  import { Upload } from '$lib/ui/kit/icon'
  import { onDestroy, untrack } from 'svelte'
  import AvatarCropper from './AvatarCropper.svelte'
  import {
    initialProfileValues,
    ProfileFormError,
    profileUpdateInput,
    type ProfileFormValues,
  } from './(local_user)/settings/profile-form'

  interface Props {
    profile: ProfileViewDetailed
    /** Show the "Import from Bluesky" button (the settings page). */
    blueskyImport?: boolean
    oncancel?: () => void
    onsaved?: () => void
  }

  let {
    profile: userProfile,
    blueskyImport = false,
    oncancel,
    onsaved,
  }: Props = $props()

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

  let importChecking = $state(false)
  let importOpen = $state(false)
  let importFields = $state<BlueskyProfileImportField[]>()
  // The profile shown when the import began, and whether the reloaded one
  // is still to arrive; an import reseeds the form, other refreshes do not.
  let profileBeforeImport: ProfileViewDetailed | undefined
  let reseedOnNextProfile = false
  /** The fields the import wrote; only these are reseeded. */
  let importedFields: BlueskyProfileImportFieldName[] = []
  // Saving between an import and the reseed would overwrite the import with
  // the stale form, so Save stays unavailable until the form reseeds.
  let importAwaitingReseed = $state(false)

  $effect(() => {
    const current = userProfile
    untrack(() => {
      if (reseedOnNextProfile && current !== profileBeforeImport) reseed()
    })
  })

  /**
   * Shows the imported fields from the reloaded profile. Unsaved edits to
   * the other fields, including a chosen avatar file, are kept.
   */
  function reseed(): void {
    reseedOnNextProfile = false
    importAwaitingReseed = false
    const reloaded = initialProfileValues(userProfile)
    if (importedFields.includes('displayName'))
      formData.displayName = reloaded.displayName
    if (importedFields.includes('description')) formData.bio = reloaded.bio
    if (importedFields.includes('avatar')) {
      formData.avatarFile = undefined
      pendingAvatarFile = undefined
      if (avatarInput) avatarInput.value = ''
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl)
      avatarPreviewUrl = undefined
    }
    importedFields = []
  }

  async function openBlueskyImport(): Promise<void> {
    if (importChecking) return
    importChecking = true
    const outcome = await settingsOutcome(() =>
      coves().getBlueskyProfileImport(),
    )
    importChecking = false
    if (outcome.kind === 'message') {
      toast({ content: $t(`form.profile.blueskyImport.${outcome.reason}`) })
    } else if (outcome.kind === 'error') {
      warnImportFailure('Bluesky import check failed', outcome.error)
      if (isExpiredSessionError(outcome.error) && authProfile.sessionExpired)
        return
      toast({ content: errorMessage(outcome.error), type: 'error' })
    } else {
      profileBeforeImport = userProfile
      importFields = outcome.fields
      importOpen = true
    }
  }

  function onBlueskyRefreshFailed(): void {
    toast({
      content: $t('form.profile.blueskyImport.refreshFailed'),
      type: 'error',
    })
  }

  /**
   * The dialog stays open for a moment after the import, so the reloaded
   * profile can arrive before it closes; reseed as soon as it does.
   */
  function onBlueskyImportSucceeded(result: ImportBlueskyProfileOutput): void {
    importedFields = result.imported
    importAwaitingReseed = true
    reseedOnNextProfile = true
  }

  function onBlueskyImported(): void {
    if (!importAwaitingReseed) return
    // invalidateAll normally delivers the reloaded profile before this runs.
    if (userProfile !== profileBeforeImport) reseed()
    else reseedOnNextProfile = true
  }

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
    if (loading || importAwaitingReseed) return
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
      disabled={loading || importAwaitingReseed}
    >
      {$t('common.save')}
    </Button>
  </div>
</form>

{#if blueskyImport}
  <div class="flex">
    <Button
      size="lg"
      loading={importChecking}
      disabled={importChecking || loading}
      onclick={openBlueskyImport}
    >
      {$t('form.profile.importFromBluesky')}
    </Button>
  </div>
  {#if importFields}
    {#key importFields}
      <BlueskyImportDialog
        bind:open={importOpen}
        mode="settings"
        fields={importFields}
        onimportsucceeded={onBlueskyImportSucceeded}
        onrefreshfailed={onBlueskyRefreshFailed}
        onimported={onBlueskyImported}
      />
    {/key}
  {/if}
{/if}

{#if pendingAvatarFile}
  <AvatarCropper
    file={pendingAvatarFile}
    oncancel={cancelAvatarCrop}
    oncropped={useCroppedAvatar}
  />
{/if}
