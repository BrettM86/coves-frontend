<script lang="ts">
  /**
   * Image tokens render as their alt text and nothing else: remote images and
   * embeds are not live yet, so no URL and no media element may reach the
   * output. `text` (the alt) is rendered as Svelte text, which escapes it.
   *
   * The `children` snippet MdTree passes is deliberately left undeclared and
   * unrendered. MdTree feeds the image token back to itself as its own child,
   * and that child snippet renders the token's nested alt subtree — marked
   * lexes the alt into em/text/html tokens — so rendering `children` would
   * re-apply the emphasis on top of this component's plain text and route a
   * raw `<b>` alt fragment through MdHtml.
   *
   * That is why `![**bold**](u)` intentionally shows the literal asterisks:
   * the alt is printed as the author typed it. Do not "fix" it by rendering
   * children.
   *
   * An alt that is empty or only whitespace has nothing to degrade to, which
   * would make the image vanish and turn the badge pattern
   * `[![](icon)](target)` into an anchor with no visible label. Such an alt
   * renders a localized placeholder instead.
   */
  import { t } from '$lib/app/state/i18n'

  interface Props {
    text?: string
  }

  let { text = '' }: Props = $props()

  let label = $derived(text.trim() === '' ? $t('common.image') : text)
</script>

{label}
