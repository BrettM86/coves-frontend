import { coves } from '$lib/api/client.svelte'
import { isWebUrl } from '$lib/app/util/url'
import type {
  CommunityRef,
  CommunityView,
  CommunityViewDetailed,
  CreatePostOutput,
  PostView,
} from '$lib/api/coves/types'
import { buildFreshPostView } from '$lib/feature/post/fresh-post'

export type CommunityFormValue =
  CommunityRef | CommunityView | CommunityViewDetailed

/** Result returned from PostFormState.submit(), containing both the API output and community context. */
export interface PostSubmitResult extends CreatePostOutput {
  community: CommunityFormValue
  /**
   * Optimistic view of the created post, assembled client-side from the form
   * data. Lets the post page render immediately instead of waiting for the
   * AppView indexer to catch up with the record write.
   */
  post?: PostView
}

export type PostFormInit = {
  community?: CommunityFormValue
  title?: string
  body?: string
  url?: string
  nsfw?: boolean
}

/** Self-label attached to a post the author marked NSFW. */
const NSFW_SELF_LABELS = {
  $type: 'com.atproto.label.defs#selfLabels',
  values: [{ val: 'nsfw' }],
}

export class PostFormState {
  community?: CommunityFormValue

  title: string
  body?: string
  url?: string
  nsfw: boolean

  constructor(post?: PostFormInit) {
    this.community = $state(post?.community)
    this.title = $state(post?.title ?? '')
    this.body = $state(post?.body)
    this.url = $state(post?.url)
    this.nsfw = $state(post?.nsfw ?? false)
  }

  validate(): string | null {
    if (!this.community) return 'Community is required'
    if (this.url && !isWebUrl(this.url))
      return 'URL must start with http:// or https://'

    return null
  }

  async submit(): Promise<PostSubmitResult> {
    const error = this.validate()
    if (error) throw new Error(error)

    // After validate() passes, community is guaranteed to be defined
    const community = this.community!

    // Read once, before the request: the toggle is a live form field, so the
    // optimistic view below has to use the label the record was sent with.
    const labels = this.nsfw ? NSFW_SELF_LABELS : undefined

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
      // Omit the key when unlabelled so the input object matches the wire
      // shape (JSON drops undefined values) and tests can assert on it as is.
      ...(labels ? { labels } : {}),
    })

    return {
      ...result,
      community,
      post: buildFreshPostView({
        output: result,
        community,
        title: this.title || undefined,
        content: this.body || undefined,
        url: this.url || undefined,
        labels,
      }),
    }
  }
}
