<script lang="ts">
  import type { Tokens } from 'marked'
  import type { Component } from 'svelte'
  import type { Renderer } from './Markdown.svelte'
  import Self from './MdTree.svelte'

  // Keys are checked against the Renderer union — a typo'd renderer name or a
  // name missing from Markdown.svelte's maps is now a type error. Partial<>
  // because inlineRenderers and linklessInlineRenderers are subsets of the
  // full map.
  //
  // The props position stays `any`, and cannot be narrowed as things stand:
  // the map has to be a supertype of all 26 concrete components (whose Props
  // are contravariant, and mutually incompatible — MdList requires
  // `ordered`/`start`, MdCodespan requires `children`, MdTableCell requires
  // `header`), while the call site below spreads an arbitrary bag of token
  // fields. `Component<{}>` fails the first requirement, `Component<never>`
  // fails the second, and no type satisfies both. Narrowing it means changing
  // how renderers receive their props, not just relabelling this line.
  type RendererMap = Partial<Record<Renderer, Component<any>>>

  interface Props {
    type?: Renderer
    raw?: string
    renderers: RendererMap
    tokens?: Tokens.Generic[]
    text?: string
    align?: string
    header?: boolean
  }

  let {
    type,
    tokens = [],
    renderers,
    raw,
    text,
    header,
    ...rest
  }: Props = $props()

  if (header) {
    type = 'tablecell'
  }

  // Token types that are deliberately invisible, so falling back to their
  // source text would be a regression rather than a rescue. `def` is a
  // reference link definition ("[tag]: https://…"), which carries the whole
  // declaration in `raw` and is never meant to be shown.
  //
  // Declared as string[] because `type` is only a Renderer by assertion — the
  // {:else} branch below casts token.type, so at runtime it can be any token
  // name marked emits, including ones absent from the renderer map.
  const INVISIBLE_TOKEN_TYPES: readonly string[] = ['def']
</script>

{#if type}
  {@const Renderer = renderers[type]}
  {#if Renderer}
    <Renderer {...rest} {raw} {text}>
      {#each tokens as token}
        {#if type != 'list' && type != 'table'}
          {#if token.tokens && token.tokens.length > 0}
            <Self
              tokens={token.tokens as Tokens.Generic[]}
              {renderers}
              {...rest}
            />
          {:else if token.text}
            {token.text}
          {:else if text}
            {text}
          {/if}
        {:else if type == 'list' && token.items}
          {#each token.items as item}
            <Self type="list_item" {renderers} tokens={[item]} {...rest} />
          {/each}
        {:else if type == 'table'}
          {@const THead = renderers['tablehead']}
          {@const TBody = renderers['tablebody']}
          {@const TRow = renderers['tablerow']}
          {#if token.header}
            <THead>
              <TRow>
                {#each token.header as heading, index}
                  <Self
                    {...rest}
                    type="tablecell"
                    {renderers}
                    tokens={heading.tokens}
                    align={token.align[index]}
                  />
                {/each}
              </TRow>
            </THead>
            <!-- <Self {renderers} tokens={token.header} {...rest} /> -->
          {/if}
          {#if token.rows}
            <TBody>
              {#each token.rows as row}
                <TRow>
                  {#each row as cell, index}
                    <Self
                      {...rest}
                      type="tablecell"
                      {renderers}
                      tokens={cell.tokens}
                      align={token.align[index]}
                    />
                  {/each}
                </TRow>
              {/each}
            </TBody>
          {/if}
        {/if}
      {/each}
    </Renderer>
  {:else if !INVISIBLE_TOKEN_TYPES.includes(type)}
    <!--
      No renderer for this token type. The inline maps omit heading, list and
      blockquote, and PostMeta renders post titles with <Markdown inline
      noLinks> — without this branch a title like "# 1 pick" dropped the token
      and its whole subtree, rendering as an empty string in the feed.
      Fall back to the author's source text so content degrades visibly.
    -->
    {raw ?? text}
  {/if}
{:else}
  {#each tokens as token}
    <Self
      {...rest}
      {...token}
      tokens={[token]}
      type={token.type as Renderer}
      {renderers}
      raw={token.raw}
      text={token.text}
    />
  {/each}
{/if}
