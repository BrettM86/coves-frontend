<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
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
  import { stashFreshPost } from '$lib/feature/post/fresh-post'
  import { decodeCrosspostDraft, postLink } from '$lib/feature/post/helpers'
  import { toast } from 'mono-svelte'
  import { onDestroy } from 'svelte'

  let community = getSessionStorage('lastSeenCommunity') as
    | CommunityView
    | CommunityViewDetailed
    | undefined

  // Read the ?crosspost= draft once at component init — it should only seed
  // the form on initial load, never overwrite the user's edits reactively.
  const crosspostParam = page.url.searchParams.get('crosspost')
  const crosspostDraft =
    crosspostParam !== null ? decodeCrosspostDraft(crosspostParam) : undefined

  if (crosspostParam !== null && crosspostDraft === undefined) {
    // Malformed/tampered param: warn and fall back to the normal empty form.
    toast({ content: $t('form.post.crosspostLoadError'), type: 'error' })
  }

  const init =
    community || crosspostDraft
      ? new PostFormState({
          community,
          title: crosspostDraft?.name,
          body: crosspostDraft?.body,
        })
      : undefined

  onDestroy(() => {
    setSessionStorage('lastSeenCommunity', undefined)
  })

  function navigateToPost(result: PostSubmitResult): void {
    try {
      // Hand the optimistic view to the post page so it renders instantly —
      // the AppView indexer may not have seen the record yet.
      if (result.post) stashFreshPost(result.post)
      // includeUri=true carries the canonical DID-based AT-URI as ?uri= so the
      // post page can load immediately — the brand-new record is not yet in any
      // feed cache, and this avoids a backend handle→DID round-trip.
      goto(postLink(result, true))
    } catch (err) {
      // DID fallback keeps the URL routable: the [handle=handle] matcher
      // accepts handles and DIDs, but not bare community names.
      const slug = result.community.handle
        ? communitySlug(result.community.handle)
        : result.community.did
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

<PostForm {init} onsubmit={navigateToPost}>
  {#snippet title()}{/snippet}
</PostForm>
