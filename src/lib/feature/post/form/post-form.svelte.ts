import { coves } from '$lib/api/client.svelte'
import type {
  CommunityRef,
  CommunityView,
  CommunityViewDetailed,
  CreatePostOutput,
} from '$lib/api/coves/types'

export type CommunityFormValue =
  | CommunityRef
  | CommunityView
  | CommunityViewDetailed

/** Result returned from PostFormState.submit(), containing both the API output and community context. */
export interface PostSubmitResult extends CreatePostOutput {
  community: CommunityFormValue
}

export type PostFormInit = {
  community?: CommunityFormValue
  title?: string
  body?: string
  url?: string
  nsfw?: boolean
  alt_text?: string
  thumbnail?: string
}

export class PostFormState {
  community?: CommunityFormValue

  title: string
  body?: string
  url?: string
  nsfw: boolean
  altText?: string
  thumbnail?: string

  constructor(post?: PostFormInit) {
    this.community = $state(post?.community)
    this.title = $state(post?.title ?? '')
    this.body = $state(post?.body)
    this.url = $state(post?.url)
    this.nsfw = $state(post?.nsfw ?? false)
    this.altText = $state(post?.alt_text)
    this.thumbnail = $state()
  }

  validate(): string | null {
    if (!this.community) return 'Community is required'
    if (this.url && !URL.canParse(this.url)) return 'Invalid URL'

    return null
  }

  async submit(): Promise<PostSubmitResult> {
    const error = this.validate()
    if (error) throw new Error(error)

    // After validate() passes, community is guaranteed to be defined
    const community = this.community!

    const result = await coves().createPost({
      community: community.did,
      title: this.title || undefined,
      content: this.body || undefined,
      // social.coves.embed.external requires the $type discriminator and an
      // `external` wrapper. A bare { uri } matches neither the backend's
      // validate/unfurl gate nor the frontend's $type switch, so it's silently
      // dropped end-to-end (no link card, no title-opens-url).
      embed: this.url
        ? { $type: 'social.coves.embed.external', external: { uri: this.url } }
        : undefined,
    })

    // TODO(coves-api): The UI collects nsfw, altText, and thumbnail but
    // CreatePostInput does not accept these fields yet. Wire them up once
    // the Coves API supports them (this.nsfw, this.altText, this.thumbnail).

    return { ...result, community }
  }
}
