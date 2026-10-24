<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Button } from '$lib/ui/kit'
  import { Icon, Info } from '$lib/ui/kit/icon'

  interface Props {
    /** Whether the controlled content is shown. */
    expanded: boolean
    /** The id of the element holding the concealed content. */
    controls: string
    /** Asks to show the content; called only while collapsed. */
    onshow: () => void
  }

  let { expanded, controls, onshow }: Props = $props()
</script>

<!-- The post NSFW banner's copy and style. There is no Hide: once shown, the
     row stays shown while the list is mounted, so the expanded banner is
     aria-disabled. The kit's `disabled` is not used because it sets
     tabindex=-1 and would drop focus right after the press. -->
<Button
  color="none"
  size="custom"
  shadow="none"
  alignment="left"
  class={[
    'w-full min-h-16 px-4 py-4 gap-3 bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 transition-colors',
    !expanded && 'hover:bg-slate-200 dark:hover:bg-zinc-800',
  ]}
  aria-label={expanded ? undefined : $t('post.sensitive.show')}
  aria-expanded={expanded}
  aria-disabled={expanded || undefined}
  aria-controls={controls}
  onclick={() => {
    if (!expanded) onshow()
  }}
>
  <Icon src={Info} size="20" class="shrink-0" />
  <span>{$t('post.sensitive.label')}</span>
  {#if !expanded}
    <span class="ms-auto shrink-0 text-slate-900 dark:text-zinc-100">
      {$t('post.sensitive.showAction')}
    </span>
  {/if}
</Button>
