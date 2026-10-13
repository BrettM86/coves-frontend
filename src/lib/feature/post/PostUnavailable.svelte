<script lang="ts" module>
  import type { PostUnavailableKind } from './owner'

  /** The i18n key of the page title for each unavailable kind. */
  export function unavailableTitleKey(kind: PostUnavailableKind): string {
    return kind === 'moderated' || kind === 'removed'
      ? 'post.unavailable.removedTitle'
      : 'post.unavailable.unavailableTitle'
  }
</script>

<script lang="ts">
  import type { CommunityRef } from '$lib/api/coves/types'
  import { t } from '$lib/app/state/i18n'
  import { communityDisplayName } from '$lib/feature/community/helpers'
  import Placeholder from '$lib/ui/info/Placeholder.svelte'
  import { Material } from '$lib/ui/kit'
  import { Ban } from '$lib/ui/kit/icon'

  interface Props {
    kind: PostUnavailableKind
    /** The post's community, when the backend names it (moderated posts). */
    community?: CommunityRef
  }

  let { kind, community }: Props = $props()
</script>

<!-- A tombstone: never the author, whose identity the withheld post hides. -->
<Material padding="lg" rounding="2xl" class="py-12">
  <Placeholder
    icon={Ban}
    title={$t(unavailableTitleKey(kind))}
    description={$t(`post.unavailable.${kind}`)}
  >
    {#if community}
      <p class="text-sm text-center">
        {$t('post.unavailable.community', {
          default: communityDisplayName(community),
        })}
      </p>
    {/if}
  </Placeholder>
</Material>
