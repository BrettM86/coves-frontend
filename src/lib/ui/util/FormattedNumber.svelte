<script lang="ts">
  import { locale } from '$lib/app/state/i18n'
  import { numberFormat } from '$lib/ui/kit/util/intl'

  interface Props {
    number: number
    locale?: string
    options?: Intl.NumberFormatOptions
    class?: string
  }

  let {
    number,
    locale: localeToUse = $locale,
    options = {
      notation: 'compact',
    },
    class: clazz = '',
  }: Props = $props()
</script>

<span class={clazz ?? ''}>
  {numberFormat(localeToUse, options).format(number)}
</span>
