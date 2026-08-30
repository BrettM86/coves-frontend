import { aliases, loadTranslations, locales } from '$lib/app/state/i18n'
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

  // The language travels on the request, not on a module-level store: one Node
  // process serves every visitor, so universal code reads it back through the
  // request-event accessor rather than from shared state.
  locals.lang = preferredLanguage

  // Preload only. This warms the dictionary cache so the render — which is
  // synchronous — can resolve keys without awaiting; it must not repoint the
  // shared locale, and on the server `loadTranslations` deliberately does not.
  await loadTranslations(preferredLanguage)

  // Build client-safe session (without sensitive tokens)
  const session: ClientSession | null = locals.auth.authenticated
    ? toClientSession(locals.auth.account)
    : null

  return {
    lang: preferredLanguage,
    session,
    sessionExpired: locals.sessionExpired ?? false,
    authError: locals.authError ?? null,
  }
}
