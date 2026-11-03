<script lang="ts">
  import { Menu, MenuButton, Option, Select } from '$lib/ui/kit'

  interface Props {
    value?: string
    size?: string
  }

  let { value = $bindable('system'), size = $bindable('small') }: Props =
    $props()
</script>

<Menu>
  {#snippet target(attachment)}
    <button {@attach attachment}>Open profile menu</button>
  {/snippet}
  <MenuButton>Settings</MenuButton>
  <Select bind:value>
    {#snippet target(attachment)}
      <MenuButton {@attach attachment} nest>Color scheme</MenuButton>
      <Option value="system" class="hidden">System</Option>
      <Option value="dark" class="hidden">Dark</Option>
    {/snippet}
  </Select>
  <Select bind:value={size}>
    {#snippet target(attachment)}
      <MenuButton {@attach attachment} nest>Text size</MenuButton>
      <Option value="small" class="hidden">Small</Option>
      <Option value="large" class="hidden">Large</Option>
    {/snippet}
  </Select>
</Menu>
<button>Outside</button>
