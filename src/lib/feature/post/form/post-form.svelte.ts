import { coves } from '$lib/api/client.svelte'
import { isWebUrl } from '$lib/app/util/url'
import type {
  CommunityRef,
  CommunityView,
  CommunityViewDetailed,
  CreatePostOutput,
  PostView,
} from '$lib/api/coves/types'
import { Attachments } from '$lib/feature/image-upload/attachments.svelte'
import { checkAltText } from '$lib/feature/image-upload/image-file'
import { buildFreshPostView } from '$lib/feature/post/fresh-post'
import { composeRichText } from '$lib/feature/richtext/mentions'

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
  /** The images attached to the post, uploaded on submit. */
  attachments: Attachments

  constructor(post?: PostFormInit) {
    this.community = $state(post?.community)
    this.title = $state(post?.title ?? '')
    this.body = $state(post?.body)
    this.url = $state(post?.url)
    this.nsfw = $state(post?.nsfw ?? false)
    this.attachments = new Attachments()
  }

  validate(): string | null {
    if (!this.community) return 'Community is required'
    if (this.url && !isWebUrl(this.url))
      return 'URL must start with http:// or https://'
    const overLimit = this.attachments.items.findIndex(
      (item) => !checkAltText(item.alt).ok,
    )
    if (overLimit >= 0)
      return `The alt text of image ${overLimit + 1} is too long. Use at most 1000 characters.`

    return null
  }

  /**
   * Creates the post. Aborting `signal` stops the image uploads and keeps the
   * post from being created, unless the create request has already been sent.
   */
  async submit(signal?: AbortSignal): Promise<PostSubmitResult> {
    // An image still being checked joins the strip before it is validated
    // and uploaded.
    await this.attachments.whenAdded()
    const error = this.validate()
    if (error) throw new Error(error)

    // After validate() passes, community is guaranteed to be defined
    const community = this.community!

    // Read once, before the request: the toggle is a live form field, so the
    // optimistic view below has to use the label the record was sent with.
    const labels = this.nsfw ? NSFW_SELF_LABELS : undefined

    // The body is lightweight markup; the record carries canonical plaintext
    // plus facets. Compiling here is what makes every client render the same
    // thing, and it is the step that resolves an @handle to a DID.
    const { content, facets } = await composeRichText(
      this.body ?? '',
      coves(),
      {
        imageCount: this.attachments.items.length,
      },
    )

    // Images that already have a blob ref, from an earlier failed submit, are
    // not uploaded again; any failed upload stops the post being created.
    await this.attachments.uploadMissing(coves(), signal)
    signal?.throwIfAborted()
    const url = this.url || undefined

    const result = await coves().createPost({
      community: community.did,
      title: this.title || undefined,
      content: content || undefined,
      embed: this.attachments.embedFor(url),
      // Omit these keys when there is nothing to send, so the input object
      // matches the wire shape (JSON drops undefined values) and tests can
      // assert on it as is.
      ...(facets ? { facets } : {}),
      ...(labels ? { labels } : {}),
    })

    return {
      ...result,
      community,
      post: buildFreshPostView({
        output: result,
        community,
        title: this.title || undefined,
        content: content || undefined,
        facets,
        url,
        labels,
        images: this.attachments.items.map((item) => ({
          previewUrl: item.previewUrl,
          alt: item.alt.trim() || undefined,
          aspectRatio: item.aspectRatio,
        })),
      }),
    }
  }
}
