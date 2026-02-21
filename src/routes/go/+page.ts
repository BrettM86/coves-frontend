import { localizeLink } from '$lib/app/markdown/renderers/plugins'
import { redirect } from '@sveltejs/kit'

export async function load({ url }) {
  const link = url.searchParams.get('localize')

  if (link) {
    const localized = localizeLink(link)
    if (localized) redirect(302, localized)
    else redirect(302, link)
  }
}
