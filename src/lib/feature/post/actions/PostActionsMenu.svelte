<script lang="ts">
  import type { PostView } from '$lib/api/coves/types'
  import { coves } from '$lib/api/client.svelte'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { settings } from '$lib/app/settings.svelte'
  import { report } from '$lib/feature/moderation/moderation.svelte'
  import { encodeCrosspostDraft } from '$lib/feature/post/helpers'
  import { MenuButton, toast } from 'mono-svelte'
  import { ArrowTopRightOnSquare, Flag, Trash } from 'svelte-hero-icons/dist'

  interface Props {
    post: PostView
  }

  let { post = $bindable() }: Props = $props()

  // UTF-8-safe: plain btoa() throws on characters above U+00FF (curly
  // quotes, emoji, CJK, ...) which would crash the whole actions menu.
  const crosspostParam = $derived(
    encodeCrosspostDraft({
      body: `${
        settings.crosspostOriginalLink ? `cross-posted from: ${post.uri}` : ``
      }\n${
        post.record?.content
          ? '>' + post.record.content.split('\n').join('\n> ')
          : ''
      }`,
      name: post.record?.title,
    }),
  )

  let deleting = $state(false)

  async function handleDelete(): Promise<void> {
    if (deleting) return
    deleting = true
    try {
      await coves().deletePost({ uri: post.uri })
      toast({ content: $t('post.actions.more.delete'), type: 'success' })
      // Navigate away after deletion
      window.history.back()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      toast({ content: errorMsg, type: 'error' })
    } finally {
      deleting = false
    }
  }
</script>

{#if profile.current?.jwt}
  <MenuButton
    href="/create/post?crosspost={crosspostParam}"
    icon={ArrowTopRightOnSquare}
  >
    {$t('post.actions.more.crosspost')}
  </MenuButton>
  {#if profile.current?.did && profile.current.did === post.author.did}
    <MenuButton onclick={handleDelete} color="danger-subtle" icon={Trash}>
      {$t('post.actions.more.delete')}
    </MenuButton>
  {/if}
  <MenuButton onclick={() => report(post)} color="danger-subtle" icon={Flag}>
    {$t('moderation.report')}
  </MenuButton>
{/if}
