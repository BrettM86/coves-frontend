import { error } from '@sveltejs/kit'

// TODO(coves-migration): The profile settings page is unmigrated Lemmy code —
// its entire form is gated on the legacy `my_user.local_user_view` shape
// (always undefined now), so it rendered as a blank page, and saving still
// called the legacy saveUserSettings endpoint. The Coves API does have
// social.coves.actor.updateProfile; remove this gate once the page is
// migrated to it.
export function load(): never {
  error(404, 'Profile settings are not available yet')
}
