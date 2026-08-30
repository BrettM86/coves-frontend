import { browser } from '$app/environment'
import { env } from '$env/dynamic/public'
import { aliases, loadTranslations } from '$lib/app/state/i18n'
import { settings } from '$lib/app/state/settings.svelte'

// SSR is on unless explicitly disabled: PUBLIC_SSR_ENABLED=false is the ops
// kill switch (runtime-read, so flipping it back is a restart, not a rebuild).
export const ssr = env.PUBLIC_SSR_ENABLED?.toLowerCase() !== 'false'

export const load = async ({ data }) => {
  if (browser) {
    // `data.lang` is what the server actually rendered in. It has to outrank
    // `navigator.language`, or the first paint flips language under the reader
    // when the two disagree; an explicit user setting still wins over both.
    const initLocale =
      settings.language ?? data?.lang ?? navigator?.language ?? 'en'

    await loadTranslations(aliases.get(initLocale) ?? initLocale)
  }

  return
}
