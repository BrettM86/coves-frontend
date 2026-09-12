<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Header } from '$lib/ui/layout'
  import ProfileEditor from '../../ProfileEditor.svelte'
  import type { PageData } from './$types'

  interface Props {
    inline?: boolean
    data: PageData
    children?: import('svelte').Snippet
  }

  let { inline = false, data, children }: Props = $props()

</script>

<div class="flex h-full flex-col gap-4">
  {#if !inline}
    <Header pageHeader>{$t('routes.profile.edit')}</Header>
  {/if}
  {@render children?.()}

  {#if data.profile}
    <ProfileEditor profile={data.profile} />
  {:else}
    <p class="text-sm text-slate-600 dark:text-zinc-400">
      {$t('toast.sessionExpired')}
    </p>
  {/if}
</div>
