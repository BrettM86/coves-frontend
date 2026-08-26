<script lang="ts" module>
  import { marked, type TokenizerAndRendererExtension } from 'marked'
  import { setContext } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import MdTree from './MdTree.svelte'
  import MdCode from './renderers/MdCode.svelte'
  import MdHeading from './renderers/MdHeading.svelte'
  import MdHr from './renderers/MdHr.svelte'
  import MdHtml from './renderers/MdHtml.svelte'
  import MdImage from './renderers/MdImage.svelte'
  import MdLink from './renderers/MdLink.svelte'
  import MdList from './renderers/MdList.svelte'
  import MdListItem from './renderers/MdListItem.svelte'
  import MdParagraph from './renderers/MdParagraph.svelte'
  import MdPassthrough from './renderers/MdPassthrough.svelte'
  import MdQuote from './renderers/MdQuote.svelte'
  import MdSpoiler from './renderers/MdSpoiler.svelte'
  import MdSubscript from './renderers/MdSubscript.svelte'
  import MdSuperscript from './renderers/MdSuperscript.svelte'
  import MdText from './renderers/MdText.svelte'
  import {
    linkify,
    subSupscriptExtension,
    type SubSupParams,
    type SubSupToken,
  } from './renderers/plugins'
  import containerExtension, {
    type ContainerOptions,
    type ContainerParams,
    type ContainerToken,
  } from './renderers/spoiler/spoiler'
  import MdCodespan from './renderers/subtext/MdCodespan.svelte'
  import MdDel from './renderers/subtext/MdDel.svelte'
  import MdEm from './renderers/subtext/MdEm.svelte'
  import MdStrong from './renderers/subtext/MdStrong.svelte'
  import MdTable from './renderers/table/MdTable.svelte'
  import MdTableBody from './renderers/table/MdTableBody.svelte'
  import MdTableCell from './renderers/table/MdTableCell.svelte'
  import MdTableHead from './renderers/table/MdTableHead.svelte'
  import MdTableRow from './renderers/table/MdTableRow.svelte'

  function preprocess(src: string) {
    return src
      .replaceAll(/\[([^\]]*)\]\(\s*javascript:[^)]*\)/gim, '*link removed*')
      .replaceAll(/^\s*\[[^\]]+\]:\s*javascript:.*$/gim, '*link removed*')
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
  })

  interface SpoilerToken extends ContainerToken {
    title: ContainerOptions
  }

  interface SubSupTextToken extends SubSupToken {
    text: string
  }

  const spoilerExtension = containerExtension(
    (params: ContainerParams): SpoilerToken | undefined => {
      if (params.type == 'spoiler') {
        return {
          type: 'spoiler',
          raw: params.raw,
          title: params.options,
          tokens: [],
        }
      }
      return undefined
    },
  )

  const subSupExtension = subSupscriptExtension(
    (params: SubSupParams): SubSupTextToken | undefined => {
      if (params.type == 'subscript') {
        return {
          type: 'subscript',
          raw: params.raw,
          text: params.content,
        }
      }
      if (params.type == 'superscript') {
        return {
          type: 'superscript',
          raw: params.raw,
          text: params.content,
        }
      }
      return undefined
    },
  )

  // Both extensions assign to marked's own type with no assertion: they
  // decline with `undefined` (not `null`) and type their nested-token array as
  // marked's `Token[]`, which is what the lexer actually puts there.
  const extensions: TokenizerAndRendererExtension[] = [
    spoilerExtension,
    subSupExtension,
  ]

  marked.use(linkify, { extensions })

  export const renderers = {
    heading: MdHeading,
    image: MdImage,
    link: MdLink,
    blockquote: MdQuote,
    hr: MdHr,
    html: MdHtml,
    code: MdCode,
    list: MdList,
    spoiler: MdSpoiler,
    table: MdTable,
    tablebody: MdTableBody,
    tablecell: MdTableCell,
    tablehead: MdTableHead,
    tablerow: MdTableRow,
    paragraph: MdParagraph,
    listitem: MdListItem,
    subscript: MdSubscript,
    superscript: MdSuperscript,
    space: MdParagraph,
    list_item: MdListItem,
    text: MdText,
    escape: MdText,
    em: MdEm,
    strong: MdStrong,
    del: MdDel,
    codespan: MdCodespan,
  }

  export const inlineRenderers = {
    paragraph: MdParagraph,
    subscript: MdSubscript,
    superscript: MdSuperscript,
    text: MdText,
    link: MdLink,
    em: MdEm,
    strong: MdStrong,
    del: MdDel,
    codespan: MdCodespan,
  }

  // For text rendered inside an existing <a> (e.g. post titles): links become
  // plain text, since nested anchors are invalid HTML and split in browsers.
  export const linklessInlineRenderers = {
    ...inlineRenderers,
    link: MdPassthrough,
  }

  export type Renderer = keyof typeof renderers
</script>

<script lang="ts">
  interface RendererOptions {
    autoloadImages: boolean
  }

  /**
   * The value published on the 'options' context, read by MdParagraph,
   * MdHeading and MdImage. Declaring it explicitly means a field added to
   * RendererOptions is a compile error here rather than a silently missing
   * option downstream.
   */
  interface MarkdownContext extends RendererOptions {
    inline: boolean
    noStyle: boolean
  }

  interface Props {
    source?: string
    inline?: boolean
    noLinks?: boolean
    noStyle?: boolean
    style?: string
    class?: ClassValue
    rendererOptions?: RendererOptions
  }

  let {
    source = '',
    inline = false,
    noLinks = false,
    noStyle = false,
    style = '',
    class: clazz = '',
    rendererOptions = {
      autoloadImages: true,
    },
  }: Props = $props()

  // Context is set once at init, so spreading the prop values here would pin
  // them to whatever they were when this instance mounted — a `noStyle` or
  // `inline` toggle on a mounted Markdown would never reach the renderers.
  // Getters keep the consumers (all of which read plain properties, none of
  // which spread or serialize the object) on the live values. Caveat: MdImage
  // copies `autoloadImages` into local $state once at init, so already-mounted
  // images still don't follow a toggle — the live context benefits MdParagraph
  // and MdHeading today.
  const options: MarkdownContext = {
    get autoloadImages() {
      return rendererOptions.autoloadImages
    },
    get inline() {
      return inline
    },
    get noStyle() {
      return noStyle
    },
  }

  setContext('options', options)

  let tokens = $derived(marked.lexer(preprocess(source)))
</script>

<svelte:element
  this={inline ? 'div' : 'article'}
  dir="auto"
  class={[!noStyle && 'break-words space-y-4 leading-normal', clazz]}
  {style}
>
  <MdTree
    {tokens}
    renderers={inline
      ? noLinks
        ? linklessInlineRenderers
        : inlineRenderers
      : renderers}
  />
</svelte:element>
