<script lang="ts">
  // Mounts the real Avatar with a `did` and `url` the test can change after
  // mount, to check that either change clears the failed-image state.
  import Avatar from './Avatar.svelte'

  let {
    initialDid,
    initialUrl,
  }: { initialDid: string; initialUrl?: string } = $props()
  // svelte-ignore state_referenced_locally
  let did = $state(initialDid)
  // svelte-ignore state_referenced_locally
  let url = $state(initialUrl)

  export function setDid(next: string): void {
    did = next
  }

  export function setUrl(next: string | undefined): void {
    url = next
  }
</script>

<Avatar {did} {url} width={32} />
