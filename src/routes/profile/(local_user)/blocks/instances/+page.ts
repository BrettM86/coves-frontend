import { error } from '@sveltejs/kit'

// TODO(coves-migration): Instance blocking is a Lemmy federation concept with
// no Coves API equivalent. The page rendered an always-empty list and its
// unblock action called the legacy /api/v3 endpoint. Remove this gate if
// Coves ever grows an instance-block API; otherwise delete the route.
export function load(): never {
  error(404, 'Instance blocks are not available yet')
}
