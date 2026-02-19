import { aliases, loadTranslations, locales } from '$lib/app/i18n'
import { get } from 'svelte/store'
import { toClientSession, type ClientSession } from '$lib/server/session'

export const load = async ({ request, locals }) => {
  const languages = request.headers.get('Accept-Language')?.split(',')
  const availableLangs = get(locales)

  let preferredLanguage = 'en'

  if (languages) {
    for (const lang of languages.reverse()) {
      const splitLang = lang.split(';')[0]
      if (availableLangs.includes(splitLang) || aliases.get(splitLang)) {
        preferredLanguage = aliases.get(splitLang) || splitLang
      }
    }
  }

  await loadTranslations(preferredLanguage)

  // Build client-safe session (without sensitive tokens)
  const session: ClientSession | null = locals.auth.authenticated
    ? toClientSession(locals.auth.account)
    : null

  return {
    lang: preferredLanguage,
    session,
    sessionExpired: locals.sessionExpired ?? false,
  }
}
