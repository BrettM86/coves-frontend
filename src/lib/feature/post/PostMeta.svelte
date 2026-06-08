<script lang="ts" module>
  import type { AuthorView, CommunityRef } from '$lib/api/coves/types'
  import { t } from '$lib/app/i18n'
  import Markdown from '$lib/app/markdown/Markdown.svelte'
  import { type View, settings } from '$lib/app/settings.svelte'
  import Avatar from '$lib/ui/generic/Avatar.svelte'
  import { publishedToDate } from '$lib/ui/util/date'
  import { Badge, Material, modal, Popover } from 'mono-svelte'
  import RelativeDate, {
    formatRelativeDate,
  } from 'mono-svelte/util/RelativeDate.svelte'
  import {
    type IconSource,
    Bookmark,
    Icon,
    Megaphone,
    PaperAirplane,
    Pencil,
    Tag,
  } from 'svelte-hero-icons/dist'
  import { SvelteMap } from 'svelte/reactivity'
  import CommunityLink from '../community/CommunityLink.svelte'
  import UserLink from '../user/UserLink.svelte'
  import { postLink } from './helpers'

  type BadgeType = 'saved' | 'featured'
  export interface MetaTag {
    content: string
    color?: string
    icon?: IconSource | null
    textColor?: string
    type: 'flair' | 'custom'
  }

  // Re-export as Tag for backward compat
  export type { MetaTag as Tag }

  export const textToTag: Map<string, MetaTag> = new Map<string, MetaTag>([
    ['OC', { content: 'OC', color: '#03A8F240', type: 'custom' }],
    ['NSFL', { content: 'NSFL', color: '#ff000040', type: 'custom' }],
    ['CW', { content: 'CW', color: '#ff000040', type: 'custom' }],
  ])

  export const parseTags = (
    title?: string,
  ): { tags: MetaTag[]; title?: string } => {
    if (!title) return { tags: [] }

    let extracted: MetaTag[] = []

    const newTitle = title
      .toString()
      .replace(/^(\[.[^\]]+\])|(\[.[^\]]+\])$/g, (match) => {
        const contents = match.split(',').map((part: string) => part.trim())

        contents
          .map((i) => i.replaceAll(/(\[|\])/g, ''))
          .forEach((content: string) => {
            extracted.push(
              textToTag.get(content) ?? {
                content: content,
                type: 'custom',
              },
            )
          })
        return ''
      })

    return {
      tags: extracted,
      title: newTitle,
    }
  }
</script>

<script lang="ts">
  interface Props {
    community?: CommunityRef
    showCommunity?: boolean
    user?: AuthorView
    published?: Date
    title?: string
    uri?: string
    edited?: string
    view?: View
    badges?: Record<BadgeType, boolean>
    tags?: MetaTag[]
    style?: string
    titleClass?: string
    extraBadges?: import('svelte').Snippet
    postUrl?: string
  }

  let {
    community = $bindable(undefined),
    showCommunity = true,
    user,
    published,
    title,
    uri,
    edited,
    view = 'cozy',
    badges = {
      saved: false,
      featured: false,
    },
    tags = [],
    postUrl,
    style = '',
    titleClass = '',
    extraBadges,
  }: Props = $props()

  const badgeToData: Map<
    BadgeType,
    {
      icon: IconSource
      color: 'red-subtle' | 'yellow-subtle' | 'green-subtle'
      label: string
    }
  > = new SvelteMap([
    [
      'saved',
      {
        icon: Bookmark,
        color: 'yellow-subtle',
        label: $t('post.badges.saved'),
      },
    ],
    [
      'featured',
      {
        icon: Megaphone,
        color: 'green-subtle',
        label: $t('post.badges.featured'),
      },
    ],
  ])
</script>

<!--
  @component
  This component will build two different things: a post's meta block and the title.
-->
<header
  class={[
    'grid w-full meta',
    community ? 'grid-rows-2' : 'grid-rows-1 minimal',
    'text-xs min-w-0 max-w-full text-slate-600 dark:text-zinc-400',
  ]}
  class:compact={view == 'compact'}
  {style}
>
  {#if showCommunity && community}
    <Popover>
      {#snippet target(attachment)}
        <button
          {@attach attachment}
          class={[
            'row-span-2 shrink-0 mr-2 self-center group/btn',
            'bg-slate-200 dark:bg-zinc-800 rounded-lg cursor-pointer',
          ]}
        >
          <Avatar
            url={community?.avatar}
            width={view == 'compact' ? 24 : 32}
            alt={community?.name}
            circle={false}
            class="group-hover/btn:scale-90 group-active/btn:scale-[.85] transition-transform"
          />
        </button>
      {/snippet}
      {#snippet popover(open)}
        {#if open && community}
          <Material
            color="uniform"
            rounding="2xl"
            elevation="high"
            class="max-w-sm p-4"
            data-autoclose="false"
          >
            <div class="flex items-center gap-3">
              <Avatar
                url={community.avatar}
                width={48}
                alt={community.name}
                circle={false}
              />
              <div class="flex flex-col">
                <span class="font-medium text-base">{community.name}</span>
                {#if community.handle}
                  <span class="text-xs text-slate-500 dark:text-zinc-400">
                    @{community.handle}
                  </span>
                {/if}
              </div>
            </div>
          </Material>
        {/if}
      {/snippet}
    </Popover>
  {/if}
  {#if showCommunity && community}
    <CommunityLink
      {community}
      style="grid-area: community;"
      class="shrink no-list-margin"
    />
  {/if}
  <div
    class="flex flex-row gap-1.5 items-center
     no-list-margin {view == 'compact' && showCommunity ? 'min-sm:mx-2' : ''}"
    style="grid-area: stats;"
  >
    {#if user}
      <address class="contents not-italic">
        {#if view == 'compact' && showCommunity}
          <Icon
            src={PaperAirplane}
            size="12"
            micro
            class="rotate-180 text-slate-400 dark:text-zinc-600 max-sm:hidden"
          />
        {/if}
        <UserLink avatarSize={20} {user} avatar={!showCommunity} class="shrink"
        ></UserLink>
      </address>
    {/if}
    {#if published}
      <RelativeDate date={published} class="shrink-0" />
    {/if}
    {#if edited}
      <button
        title={$t('post.meta.lastEdited', {
          default: formatRelativeDate(publishedToDate(edited), {
            style: 'long',
          }),
        })}
        onclick={() =>
          modal({
            title: $t('common.info'),
            body: $t('post.meta.lastEdited', {
              default: formatRelativeDate(publishedToDate(edited), {
                style: 'long',
              }),
            }),
          })}
      >
        <Icon src={Pencil} micro size="14" />
      </button>
    {/if}
  </div>
  <div
    class="flex flex-row min-sm:justify-end items-center self-center flex-wrap gap-2 *:shrink-0 badges min-sm:ml-2"
    style="grid-area: badges;"
  >
    {#if tags}
      {#each tags as tag}
        {@const href =
          tag.type == 'flair' ? null : `/search?q=[${tag.content}]&type=Posts`}
        <svelte:element
          this={href ? 'a' : 'div'}
          {href}
          class="hover:brightness-110"
          style="{tag.color ? `--tag-color: ${tag.color};` : ''} {tag.textColor
            ? `--tag-text-color: ${tag.textColor}`
            : ''}"
        >
          <Badge class={tag.color ? 'badge-tag-color' : ''}>
            {#snippet icon()}
              {#if tag.icon}
                <Icon src={tag.icon} micro size="14" />
              {:else if tag === undefined}
                <Icon src={Tag} micro size="14" />
              {/if}
            {/snippet}
            {tag.content}
          </Badge>
        </svelte:element>
      {/each}
    {/if}
    {#each Object.keys(badges)
      // filter by ones that are true
      .filter((i) => badges[i as BadgeType] == true)
      // get from predetermined map
      .map((i) => badgeToData.get(i as BadgeType))
      // remove null
      .filter((i) => i != undefined) as badge}
      <Badge label={badge.label} color={badge.color} allowIconOnly>
        {#snippet icon()}
          <Icon src={badge.icon} micro size="14" />{/snippet}{badge.label}
      </Badge>
    {/each}
    {@render extraBadges?.()}
  </div>
</header>
{#if title && uri}
  {@const useAttachedUrl = settings.posts.titleOpensUrl && postUrl}
  <h3
    class={[
      'font-medium max-sm:mt-0! font-display',
      titleClass,
      view == 'compact' ? 'text-base' : 'text-lg',
    ]}
    style="grid-area: title;"
  >
    <a
      href={useAttachedUrl
        ? postUrl
        : community
          ? postLink({ uri, community })
          : undefined}
      target={useAttachedUrl ? '_blank' : undefined}
      rel={useAttachedUrl ? 'noopener noreferrer' : undefined}
      class="inline-block hover:underline hover:text-primary-900 dark:hover:text-primary-100 transition-colors"
    >
      <Markdown
        inline
        source={title}
        class={view != 'compact' ? '' : 'leading-[1.3]'}
      />
    </a>
  </h3>
{:else}
  <div style="grid-area: title; margin: 0;"></div>
{/if}

<style>
  @reference '../../../app.css';

  .meta {
    display: grid;
    grid-template-areas:
      'avatar community badges'
      'avatar stats badges';
    gap: 0;
    grid-template-rows: auto auto auto;
    grid-template-columns: 40px minmax(0, auto);
  }

  .meta.minimal {
    grid-template-columns: 0fr;
  }

  @media screen and (max-width: 40rem) {
    .meta.compact {
      grid-template-areas:
        'avatar community'
        'avatar stats'
        'badges badges';
      gap: 0;
      grid-template-columns: 32px minmax(0, auto);
    }
    .meta.minimal {
      grid-template-columns: 0fr;
    }
  }

  @media screen and (min-width: 40rem) {
    .meta.compact {
      display: flex;
      flex-direction: row;
      align-items: center;
    }
    .meta.minimal {
      grid-template-columns: 0fr;
    }
  }

  :global(.badge-tag-color) {
    background-color: var(--tag-color, #fff) !important;
    color: var(--tag-text-color, #000) !important;

    @variant dark {
      background-color: color-mix(
        in oklab,
        #222,
        var(--tag-color, #fff)
      ) !important;
      color: color-mix(
        in oklab,
        #fff 80%,
        var(--tag-text-color, #fff)
      ) !important;
    }
  }
</style>
