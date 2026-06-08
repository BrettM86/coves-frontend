<script lang="ts">
  import { goto } from '$app/navigation'
  import type {
    CommunityView,
    CommunityViewDetailed,
  } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import { getSessionStorage, setSessionStorage } from '$lib/app/session'
  import { communitySlug } from '$lib/app/util.svelte'
  import PostForm from '$lib/feature/post/form/PostForm.svelte'
  import {
    PostFormState,
    type PostSubmitResult,
  } from '$lib/feature/post/form/post-form.svelte'
  import { postLink } from '$lib/feature/post/helpers'
  import { onDestroy } from 'svelte'

  let community = getSessionStorage('lastSeenCommunity') as
    | CommunityView
    | CommunityViewDetailed
    | undefined

  onDestroy(() => {
    setSessionStorage('lastSeenCommunity', undefined)
  })

  function navigateToPost(result: PostSubmitResult): void {
    try {
      // includeUri=true carries the canonical DID-based AT-URI as ?uri= so the
      // post page can load immediately — the brand-new record is not yet in any
      // feed cache, and this avoids a backend handle→DID round-trip.
      goto(postLink(result, true))
    } catch (err) {
      const slug = result.community.handle
        ? communitySlug(result.community.handle)
        : result.community.name
      console.warn(
        '[create/post] Failed to parse post URI, falling back to community page:',
        err,
      )
      goto(`/c/${encodeURIComponent(slug)}`)
    }
  }
</script>

<svelte:head>
  <title>{$t('form.post.create')}</title>
</svelte:head>

<PostForm
  init={community ? new PostFormState({ community }) : undefined}
  onsubmit={navigateToPost}
>
  {#snippet title()}{/snippet}
</PostForm>
