<script lang="ts">
  // Stands in for $lib/ui/generic/Avatar.svelte in ReplyCard tests: the real
  // Avatar never puts `alt` in the DOM, so the probe exposes the props the
  // tests check. Other Avatar props are accepted and ignored.
  let { url, alt }: { url: string | undefined; alt?: string } = $props()
</script>

<span
  data-avatar
  data-url={url ?? ''}
  data-has-url={url !== undefined}
  data-alt={alt}
></span>
