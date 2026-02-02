<script lang="ts">
  // @ts-nocheck
  interface Props {
    text: string
  }

  let { text }: Props = $props()
</script>

<p>
  {text}
</p>
