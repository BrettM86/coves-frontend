import { error } from '@sveltejs/kit'

// TODO(coves-migration): The blocked-communities page is unmigrated Lemmy code
// — its `data.community_blocks` list is never populated by any load (it came
// from Lemmy's `my_user` payload) and unblocking called the legacy /api/v3
// endpoint. The Coves API has
// blockCommunity/unblockCommunity writes but no blocked-communities list query
// yet. Remove this gate and migrate the page once that query exists.
export function load(): never {
  error(404, 'Blocked communities are not available yet')
}
