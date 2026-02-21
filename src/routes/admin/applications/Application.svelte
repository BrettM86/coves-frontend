<script lang="ts">
  // @ts-nocheck TODO(coves-migration): Needs Coves registration application API
  import { browser } from '$app/environment'
  import { client } from '$lib/api/client.svelte'
  import type {
    ApproveRegistrationApplication,
    RegistrationApplicationView,
  } from '$lib/api/types'
  import { profile } from '$lib/app/auth.svelte'
  import { errorMessage } from '$lib/app/error'
  import { t } from '$lib/app/i18n'

  import UserLink from '$lib/feature/user/UserLink.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Button, ButtonGroup, Label, Material, toast } from 'mono-svelte'
  import RelativeDate from 'mono-svelte/util/RelativeDate.svelte'
  import {
    Check,
    Icon,
    ShieldCheck,
    ShieldExclamation,
    XMark,
  } from 'svelte-hero-icons/dist'

  interface Props {
    application: RegistrationApplicationView
  }

  let { application = $bindable() }: Props = $props()

  let approving = $state(false)
  let denying = $state(false)

  async function review(approve: boolean) {
    if (!profile.current?.jwt) return

    const registrationApplicationAnswer: ApproveRegistrationApplication = {
      approve: approve,
      id: application.registration_application.id,
    }

    if (approve) {
      approving = true
    } else {
      // TODO(coves-migration): Replace confirm() with ApplicationDenyModal to restore deny reason functionality.
      // The original code used ApplicationDenyModal which collected a deny_reason string.
      // When the Coves registration API is available, re-implement with a proper modal.
      if (!browser) return
      if (!confirm($t('routes.admin.applications.deny') + '?')) return
      denying = true
    }

    try {
      await client().approveRegistrationApplication(
        registrationApplicationAnswer,
      )
      toast({
        content: approve
          ? $t('toast.approvedApplication')
          : $t('toast.deniedApplication'),
        type: 'success',
      })
      application.creator_local_user.accepted_application = approve
      // TODO: Set admin from Coves user data

      // TODO: Re-enable notification tracking when Coves API provides it
    } catch (err) {
      toast({
        content: errorMessage(err as string),
        type: 'error',
      })
    }

    approving = false
    denying = false
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-col gap-2">
    <span class="text-slate-600 dark:text-zinc-400 text-xs">
      <RelativeDate
        date={publishedToDate(application.registration_application.published)}
      />
    </span>

    <span class="text-sm">
      <UserLink user={application.creator} avatar avatarSize={20} />
    </span>
  </div>
  <div>
    <Material
      color="uniform"
      rounding="xl"
      padding="none"
      class="dark:bg-zinc-925 p-3 py-2"
    >
      <p>{application.registration_application.answer}</p>
    </Material>
  </div>
  <div class="flex flex-row gap-1">
    <div class="flex flex-col md:flex-row gap-2 md:items-center">
      {#if application.admin}
        {@const accepted = application.creator_local_user.accepted_application}
        {#if typeof application.registration_application.deny_reason !== 'undefined' && application.registration_application.deny_reason !== ''}
          <div>
            <div class="flex items-center gap-1 text-sm">
              <Icon
                src={accepted ? ShieldCheck : ShieldExclamation}
                mini
                size="20"
                class={accepted ? 'text-green-400' : 'text-red-400'}
              />
              <UserLink avatar user={application.admin} />
              <Label>
                {accepted
                  ? $t('routes.admin.applications.approved')
                  : $t('routes.admin.applications.denied')}
              </Label>
              <Label>:</Label>
            </div>
            <p>{application.registration_application.deny_reason}</p>
          </div>
          <div class="md:ml-auto"></div>
        {:else}
          <div class="flex items-center gap-1 text-sm">
            <Icon
              src={accepted ? ShieldCheck : ShieldExclamation}
              mini
              size="20"
              class={accepted ? 'text-green-400' : 'text-red-400'}
            />
            <UserLink avatar user={application.admin} />
            <Label>
              {accepted
                ? $t('routes.admin.applications.approved')
                : $t('routes.admin.applications.denied')}
            </Label>
          </div>
          <div class="md:ml-auto"></div>
        {/if}
      {/if}
    </div>
    <div class="flex-1"></div>
    <ButtonGroup orientation="horizontal" class="flex">
      <Button
        size="square-md"
        class="hover:bg-slate-200 {application.creator_local_user
          .accepted_application === false && application.admin
          ? 'text-red-500!'
          : ''}"
        aria-label={$t('routes.admin.applications.deny')}
        onclick={() => review(false)}
        loading={denying}
        disabled={approving || denying}
        icon={XMark}
      ></Button>
      <Button
        size="square-md"
        class="hover:bg-slate-200 {application.creator_local_user
          .accepted_application
          ? 'text-green-500!'
          : ''}"
        title={$t('routes.admin.applications.approve')}
        onclick={() => review(true)}
        loading={approving}
        disabled={approving || denying}
        icon={Check}
      ></Button>
    </ButtonGroup>
  </div>
</div>
