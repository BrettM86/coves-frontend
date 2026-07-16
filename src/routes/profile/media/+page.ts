import type { ListMediaResponse } from '$lib/api/types'
import type { ReactiveState } from '$lib/app/util.svelte'
import { error } from '@sveltejs/kit'

// TODO(coves-migration): This page is unmigrated Lemmy code — it called the
// legacy pictrs listMedia endpoint, which the Coves backend 404s, crashing
// the page with a leaked backend error. The Coves API has no media-listing
// endpoint yet; remove this gate and migrate the page once one exists. The
// declared return type keeps the (currently unreachable) page type-checking.
export function load(): {
  images: ReactiveState<ListMediaResponse['images']>
} {
  error(404, 'Media uploads are not available yet')
}
