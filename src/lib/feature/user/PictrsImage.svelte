<script lang="ts">
  import type { AuthorView } from '$lib/api/coves/types'
  import { profile } from '$lib/app/auth.svelte'
  import { t } from '$lib/app/i18n'
  import { instanceToURL } from '$lib/app/util.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import { action, Button, modal, toast } from 'mono-svelte'
  import RelativeDate from 'mono-svelte/util/RelativeDate.svelte'
  import { ArrowDownTray, Trash } from 'svelte-hero-icons/dist'
  import UserLink from './UserLink.svelte'

  /**
   * Local image data from the pictrs image hosting service.
   * Defined locally since Coves does not use pictrs; this supports
   * legacy admin/profile media pages until a Coves media API exists.
   */
  interface PictrsLocalImage {
    pictrs_alias: string
    pictrs_delete_token: string
    published: string
  }

  // TODO(coves-migration): Replace with Coves media deletion API when available
  async function deleteImage(_image: PictrsLocalImage) {
    if (!profile.current?.jwt) return

    toast({
      content: 'Image deletion is not yet supported in Coves',
      type: 'warning',
    })
  }

  interface Props {
    image: PictrsLocalImage
    user?: AuthorView
    ondelete?: (res: boolean) => void
  }

  let { image, user, ondelete }: Props = $props()
</script>

<div class="flex flex-col gap-1">
  {#snippet img()}
    <button
      onclick={() =>
        showImage(
          `${instanceToURL(profile.current.instance)}/pictrs/image/${image.pictrs_alias}`,
        )}
      class="cursor-pointer"
    >
      <img
        src="{instanceToURL(
          profile.current.instance,
        )}/pictrs/image/{image.pictrs_alias}"
        width="500"
        height="500"
        class="aspect-square w-full h-full object-cover rounded-xl"
        alt="pictrs"
      />
    </button>
  {/snippet}

  {@render img()}

  {#if user}
    <UserLink {user} />
  {/if}
  <div class="flex items-center gap-2">
    <RelativeDate
      class="text-sm text-slate-700 dark:text-zinc-300"
      date={publishedToDate(image.published)}
    />
    <Button
      title={$t('routes.profile.media.download')}
      href="{instanceToURL(
        profile.current.instance,
      )}/pictrs/image/{image.pictrs_alias}"
      size="square-md"
      class="ml-auto"
      icon={ArrowDownTray}
    />
    <Button
      title={$t('post.actions.more.delete')}
      onclick={() => {
        modal({
          title: $t('routes.theme.preset.delete.confirm'),
          body: '',
          snippet: img,
          actions: [
            action({
              close: true,
              content: $t('common.cancel'),
            }),
            action({
              type: 'danger',
              action: () => deleteImage(image),
              close: true,
              content: $t('post.actions.more.delete'),
            }),
          ],
        })
      }}
      size="square-md"
      icon={Trash}
    />
  </div>
</div>
