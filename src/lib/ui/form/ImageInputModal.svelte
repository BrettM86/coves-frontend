<script lang="ts">
  import { t } from '$lib/app/state/i18n'
  import { Button, Modal, TextInput } from '$lib/ui/kit'

  let {
    open = $bindable(),
    imageUrl: passedImageUrl = $bindable(),
  }: { open: boolean; imageUrl?: string } = $props()

  let imageUrl = $derived(passedImageUrl)
</script>

<Modal bind:open title={$t('form.post.uploadImage')}>
  <div class="flex justify-end gap-1 flex-wrap">
    <Button
      onclick={() => {
        passedImageUrl = undefined
        open = false
      }}
      size="xs"
      rounding="xl"
    >
      {$t('common.remove')}
    </Button>
  </div>

  <form
    onsubmit={(e) => {
      e.preventDefault()
      if (!imageUrl) throw new Error('missing imageurl')

      if (URL.canParse != undefined) {
        if (!URL.canParse(imageUrl)) throw new Error('invalid URL')
      }

      passedImageUrl = imageUrl
      open = false
    }}
    class="contents"
  >
    <TextInput
      label={$t('content.url')}
      bind:value={imageUrl}
      pattern="http(s)?:\/\/(.*).(png|jpg|gif|avif|webp|jpeg|jxl|svg|bmp)"
    />
    <Button submit color="primary" size="lg">
      {$t('form.submit')}
    </Button>
  </form>
</Modal>
