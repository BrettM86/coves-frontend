import { profile } from './auth.svelte'
import { DEFAULT_INSTANCE_URL, LINKED_INSTANCE_URL } from './instance/env'

// Re-exported so consumers keep a single import site for instance concerns.
// The constants themselves live in the leaf module `./instance/env` so that
// `auth.svelte` can import them without forming a cycle with this module.
export { DEFAULT_INSTANCE_URL, LINKED_INSTANCE_URL }

class InstanceData {
  #instance = $derived(profile.current.instance)

  get data() {
    return this.#instance ?? DEFAULT_INSTANCE_URL
  }
}

export const instance = new InstanceData()
