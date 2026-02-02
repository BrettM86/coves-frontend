<script lang="ts">
  // @ts-nocheck
  interface Props {
    text: string
  }

  let { text }: Props = $props()
</script>

<sup>{text}</sup>
