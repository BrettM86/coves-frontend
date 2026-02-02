<script lang="ts">
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { Header } from '$lib/ui/layout'
</script>

<Header pageHeader>
  {$t('nav.communities')}
</Header>
<div class="w-full h-full flex flex-col mt-4">
  {#if !profile.current.jwt}
    <div class="mx-auto my-auto text-center">
      <p class="text-slate-500 dark:text-zinc-400">
        {$t('account.login')} to view moderated communities
      </p>
    </div>
  {:else}
    <!-- TODO: Re-enable moderated communities list when Coves API provides user moderates data -->
    <div class="mx-auto my-auto text-center">
      <p class="text-slate-500 dark:text-zinc-400">
        Moderated communities list coming soon
      </p>
    </div>
  {/if}
</div>
