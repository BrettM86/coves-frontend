<script lang="ts">
  import { imageUrl } from '$lib/api/coves/image-proxy'
  import type { PostEmbed } from '$lib/api/coves/types'
  import { settings } from '$lib/app/state/settings.svelte'
  import { showImage } from '$lib/ui/generic/ExpandableImage.svelte'
  import type { Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    buildRichTextWithPlacements,
    type FacetLevel,
    type LinkSpan,
    type PlacedBlock,
    type PlacedImageBlock,
    type PlacedInline,
    type TextSegment,
  } from './facets'
  import { imageLayout } from './image-layout'
  import RichTextCodeBlock from './RichTextCodeBlock.svelte'
  import RichTextImage from './RichTextImage.svelte'
  import RichTextSpoiler from './RichTextSpoiler.svelte'

  interface Props {
    /** Canonical plaintext (facets are advisory byte-range annotations). */
    content: string
    /** Raw facets array from the record; malformed entries degrade safely. */
    facets?: unknown[]
    /** The post's or comment's embed; its images back `#image` placements. */
    embed?: PostEmbed
    /** False leaves placed images out (feed cards); their covered text
     * stays hidden either way. */
    inlineImages?: boolean
    /** Called when a placed image finishes loading and the body grows. */
    onimageload?: () => void
    noStyle?: boolean
    style?: string
    class?: ClassValue
  }

  let {
    content,
    facets = [],
    embed = undefined,
    inlineImages = true,
    onimageload = undefined,
    noStyle = false,
    style = '',
    class: clazz = '',
  }: Props = $props()

  let layout = $derived(imageLayout(embed, content, facets))
  let blocks = $derived(
    buildRichTextWithPlacements(content, facets, layout.placed),
  )

  /** Spoiler groups the reader revealed; pieces of one spoiler cut apart by
   * block boundaries or placed images reveal together. */
  const revealedSpoilers = new SvelteSet<number>()

  /** Lightbox sequence: placed images in body order, then the gallery. */
  function openImage(facet: number): void {
    const sequence = [...layout.placed.values(), ...layout.gallery]
    showImage(
      sequence.map((image) => ({
        url: imageUrl(image, 'fullsize') ?? '',
        alt: image.alt,
      })),
      [...layout.placed.keys()].indexOf(facet),
    )
  }

  // Mirrors MdHeading's (non-inline) scale so faceted and markdown
  // content match.
  const headingClasses: Record<FacetLevel, string> = {
    1: 'text-4xl font-semibold tracking-tight',
    2: 'text-3xl font-semibold tracking-tight',
    3: 'text-2xl font-semibold tracking-tight',
    4: 'text-xl font-medium tracking-tight',
    5: 'text-lg font-medium tracking-tight',
    6: 'text-base font-medium tracking-tight',
  }

  // These helpers keep the text-bearing elements below short enough to stay
  // on one line: paragraphs render with pre-wrap, so any whitespace the
  // formatter would introduce inside <code>/<span>/<a> becomes a visible
  // stray space in the output.
  const markClass = (segment: TextSegment): (string | false)[] => [
    !!segment.bold && 'font-bold',
    !!segment.italic && 'italic',
    !!segment.strikethrough && 'line-through',
  ]

  const linkAttrs = (node: LinkSpan) => ({
    href: node.href,
    class: 'hover:underline text-blue-600 dark:text-blue-400',
    rel: node.external ? 'noopener noreferrer nofollow' : undefined,
    target: node.external && settings.openLinksInNewTab ? '_blank' : undefined,
  })
</script>

{#snippet textSegment(segment: TextSegment)}
  {#if segment.code}
    <code class={markClass(segment)}>{segment.text}</code>
  {:else if segment.bold || segment.italic || segment.strikethrough}
    <span class={markClass(segment)}>{segment.text}</span>
  {:else}{segment.text}{/if}
{/snippet}

{#snippet linkKids(node: LinkSpan)}
  {#each node.children as child, i (i)}{@render textSegment(child)}{/each}
{/snippet}

{#snippet linkOrText(node: TextSegment | LinkSpan)}
  {#if node.type === 'link'}
    <a {...linkAttrs(node)}>{@render linkKids(node)}</a>
  {:else}{@render textSegment(node)}{/if}
{/snippet}

{#snippet spoiler(
  group: number,
  reason: string | undefined,
  block: boolean,
  children: Snippet,
)}
  <RichTextSpoiler
    {reason}
    {block}
    {children}
    bind:revealed={
      () => revealedSpoilers.has(group), () => revealedSpoilers.add(group)
    }
  />
{/snippet}

{#snippet inlineList(nodes: readonly PlacedInline[])}
  {#each nodes as node, i (i)}
    {#if node.type === 'spoiler'}
      {#snippet spoilerKids()}
        {#each node.children as child, j (j)}{@render linkOrText(child)}{/each}
      {/snippet}
      {@render spoiler(node.group, node.reason, false, spoilerKids)}
    {:else}{@render linkOrText(node)}{/if}
  {/each}
{/snippet}

{#snippet imageNode(block: PlacedImageBlock)}
  {#snippet picture()}
    <RichTextImage
      image={block.image}
      onopen={() => openImage(block.facet)}
      onload={onimageload}
    />
  {/snippet}
  {#if block.spoiler}
    {@render spoiler(block.spoiler.group, block.spoiler.reason, true, picture)}
  {:else}{@render picture()}{/if}
{/snippet}

{#snippet blockNode(block: PlacedBlock)}
  {#if block.type === 'paragraph'}
    <p class="whitespace-pre-wrap">{@render inlineList(block.children)}</p>
  {:else if block.type === 'heading'}
    <svelte:element
      this={`h${block.level}`}
      class={headingClasses[block.level]}
    >
      {@render inlineList(block.children)}
    </svelte:element>
  {:else if block.type === 'codeBlock'}
    <RichTextCodeBlock code={block.code} language={block.language} />
  {:else if block.type === 'blockquote'}
    <blockquote
      class="flex flex-col gap-2 border-l-2 dark:border-zinc-700 border-slate-300 p-1 px-3"
      style:margin-left={block.level > 1
        ? `${(block.level - 1) * 0.75}rem`
        : undefined}
    >
      {#each block.children as child, i (i)}{@render blockNode(child)}{/each}
    </blockquote>
  {:else if block.type === 'image'}
    {#if inlineImages}{@render imageNode(block)}{/if}
  {/if}
{/snippet}

<article
  dir="auto"
  class={[!noStyle && 'break-words space-y-3 leading-normal', clazz]}
  {style}
>
  {#each blocks as block, i (i)}{@render blockNode(block)}{/each}
</article>
