<script lang="ts">
  // @ts-nocheck TODO(coves-migration): Needs Coves admin media management API
  import { page } from '$app/state'
  import type { AuthorView } from '$lib/api/coves/types'
  import type { Person } from '$lib/api/types'
  import { t } from '$lib/app/i18n'
  import PictrsImage from '$lib/feature/user/PictrsImage.svelte'
  import Fixate from '$lib/ui/generic/Fixate.svelte'
  import { Header, Pageination } from '$lib/ui/layout'
  import type { DID, Handle } from '$lib/types/atproto'
  import { flip } from 'svelte/animate'
  import { expoInOut } from 'svelte/easing'

  let { data = $bindable() } = $props()

  /** Adapt a Lemmy Person to AuthorView shape for PictrsImage compatibility. */
  function personToAuthor(person: Person): AuthorView {
    return {
      did: person.actor_id as unknown as DID,
      handle: person.name as unknown as Handle,
      displayName: person.display_name,
      avatar: person.avatar,
    }
  }
</script>

<Header pageHeader>{$t('routes.profile.media.title')}</Header>
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {#each data.images.value as image (image.local_image.pictrs_delete_token)}
    <div animate:flip={{ duration: 500, easing: expoInOut }}>
      <PictrsImage
        image={image.local_image}
        user={personToAuthor(image.person)}
        ondelete={() => {
          data.images.value = data.images.value.toSpliced(
            data.images.value.findIndex(
              (i) =>
                i.local_image.pictrs_delete_token ==
                image.local_image.pictrs_delete_token,
            ),
            1,
          )
        }}
      />
    </div>
  {/each}
</div>
<Fixate placement="bottom">
  <Pageination
    page={Number(page.url.searchParams.get('page')) || 1}
    href={(page) => `?page=${page}`}
    hasMore={data.images.value.length == 20}
  />
</Fixate>
