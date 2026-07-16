import { error } from '@sveltejs/kit'

// TODO(coves-migration): This page is unmigrated Lemmy code — it called the
// legacy /api/v3/post/list and /api/v3/comment/list endpoints, which the
// Coves backend 404s, crashing the page with a leaked backend error. The
// Coves API has no vote-history endpoint yet; remove this gate and migrate
// the page once one exists.
export function load(): never {
  error(404, 'Vote history is not available yet')
}
