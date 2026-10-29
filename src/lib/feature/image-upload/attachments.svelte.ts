import type {
  BlobRef,
  CreatePostInput,
  ImagesEmbedRecord,
  ImagesEmbedRecordImage,
  UploadImageOutput,
} from '$lib/api/coves/types'
import type { ImageContentType } from './image-file'
import { createLocalImageUrl, revokeLocalImageUrl } from './local-image-urls'
import { prepareImageFile, reencodeImage, type Reencode } from './reencode'

export interface Attachment {
  id: string
  file: Blob
  contentType: ImageContentType
  previewUrl: string
  alt: string
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  error?: unknown
  blob?: BlobRef
  aspectRatio?: { width: number; height: number }
}

export interface ImageUploadClient {
  uploadImage(
    file: Blob,
    contentType: string,
    options?: { signal?: AbortSignal },
  ): Promise<UploadImageOutput>
}

type DecodeDimensions = (
  file: Blob,
) => Promise<{ width: number; height: number }>

const MAXIMUM_ATTACHMENTS = 8
const MAXIMUM_CONCURRENT_UPLOADS = 2
const TOO_MANY_MESSAGE = 'A post can have at most 8 images.'

let nextId = 0

/**
 * The images attached to a post, in strip order: their pick-time checks,
 * preview URLs, alt text and upload state.
 */
export class Attachments {
  items = $state<Attachment[]>([])
  /** The latest pick-time refusal, such as a ninth image or a bad format. */
  message = $state<string | undefined>()
  /** The number of picked images being re-encoded to fit the limits. */
  processing = $state(0)
  readonly #decodeDimensions?: DecodeDimensions
  readonly #reencode: Reencode
  /** Settles once every add started so far has finished. */
  #added: Promise<void> = Promise.resolve()
  /** Set by {@link releasePreviews}: a later check adds nothing. */
  #released = false

  constructor(options?: {
    decodeDimensions?: DecodeDimensions
    reencode?: Reencode
  }) {
    this.#decodeDimensions = options?.decodeDimensions
    this.#reencode = options?.reencode ?? reencodeImage
  }

  /**
   * Checks and appends `files` in pick order, refusing any past the eighth.
   * Each add waits for the ones before it, so overlapping adds keep their
   * order and the cap is checked against the settled strip.
   */
  add(files: Blob[]): Promise<void> {
    const adding = this.#added.then(() => this.#addInOrder(files))
    this.#added = adding.catch(() => {})
    return adding
  }

  /** Settles once every add started so far has finished. */
  whenAdded(): Promise<void> {
    return this.#added
  }

  async #addInOrder(files: Blob[]): Promise<void> {
    this.message = undefined
    for (const file of files) {
      if (this.items.length >= MAXIMUM_ATTACHMENTS) {
        this.message = TOO_MANY_MESSAGE
        return
      }
      const attachment = await this.#attachmentFor(file)
      if (attachment) this.items.push(attachment)
    }
  }

  remove(id: string): void {
    const index = this.#indexOf(id)
    if (index < 0) return
    const [removed] = this.items.splice(index, 1)
    if (removed) revokeLocalImageUrl(removed.previewUrl)
  }

  /** Swaps an image for `file` in place; the new one has no upload yet. */
  async replace(id: string, file: Blob): Promise<void> {
    this.message = undefined
    const attachment = await this.#attachmentFor(file, id)
    const index = this.#indexOf(id)
    const previous = this.items[index]
    if (!attachment) return
    if (!previous) {
      revokeLocalImageUrl(attachment.previewUrl)
      return
    }
    this.items[index] = attachment
    revokeLocalImageUrl(previous.previewUrl)
  }

  moveEarlier(id: string): void {
    this.#swap(this.#indexOf(id), -1)
  }

  moveLater(id: string): void {
    this.#swap(this.#indexOf(id), 1)
  }

  setAlt(id: string, alt: string): void {
    const attachment = this.items[this.#indexOf(id)]
    if (attachment) attachment.alt = alt
  }

  /**
   * Revokes every preview URL and empties the strip, for a composer that
   * closes without handing its images to a posted view.
   */
  releasePreviews(): void {
    this.#released = true
    for (const item of this.items) revokeLocalImageUrl(item.previewUrl)
    this.items = []
  }

  /**
   * Uploads every image that has no blob ref, two at a time in strip order.
   * A failure does not stop the others; once all have settled, it rejects with
   * the first failure's error, which stays on its image.
   */
  async uploadMissing(
    client: ImageUploadClient,
    signal?: AbortSignal,
  ): Promise<void> {
    const queue = this.items.filter(
      (item) => item.status === 'pending' || item.status === 'failed',
    )
    const failures: unknown[] = []
    const worker = async () => {
      while (!signal?.aborted) {
        const attachment = queue.shift()
        if (!attachment) return
        attachment.status = 'uploading'
        attachment.error = undefined
        try {
          const output = await client.uploadImage(
            attachment.file,
            attachment.contentType,
            { signal },
          )
          attachment.blob = output.blob
          attachment.aspectRatio = output.aspectRatio
          attachment.status = 'uploaded'
        } catch (error) {
          if (signal?.aborted) {
            // Cancelled, not failed: the next submit uploads it again.
            attachment.status = 'pending'
            continue
          }
          attachment.status = 'failed'
          attachment.error = error
          failures.push(error)
        }
      }
    }
    await Promise.all(
      Array.from({ length: MAXIMUM_CONCURRENT_UPLOADS }, worker),
    )
    if (failures.length > 0) throw failures[0]
    signal?.throwIfAborted()
  }

  /**
   * The post embed for these images and an optional link (PRD §3.4). Call it
   * after {@link uploadMissing} has resolved: every image needs its blob ref.
   */
  embedFor(url?: string): CreatePostInput['embed'] {
    const external = url
      ? ({
          $type: 'social.coves.embed.external',
          external: { uri: url },
        } as const)
      : undefined
    if (this.items.length === 0) return external
    const images: ImagesEmbedRecord = {
      $type: 'social.coves.embed.images',
      images: this.items.map(embedImage),
    }
    if (!external) return images
    return {
      $type: 'social.coves.embed.imagesWithAttachment',
      images,
      attachment: external,
    }
  }

  async #attachmentFor(
    file: Blob,
    id = `attachment-${++nextId}`,
  ): Promise<Attachment | undefined> {
    const check = await prepareImageFile(file, {
      decodeDimensions: this.#decodeDimensions,
      reencode: async (source, contentType) => {
        this.processing++
        try {
          return await this.#reencode(source, contentType)
        } finally {
          this.processing--
        }
      },
    })
    // The composer closed during the check: there is no strip to join.
    if (this.#released) return undefined
    if (!check.ok) {
      this.message = check.message
      return undefined
    }
    return {
      id,
      file: check.file,
      contentType: check.contentType,
      previewUrl: createLocalImageUrl(check.file),
      alt: '',
      status: 'pending',
    }
  }

  #indexOf(id: string): number {
    return this.items.findIndex((item) => item.id === id)
  }

  #swap(index: number, by: -1 | 1): void {
    const other = index + by
    const moving = this.items[index]
    const displaced = this.items[other]
    if (index < 0 || !moving || !displaced) return
    this.items[other] = moving
    this.items[index] = displaced
  }
}

function embedImage(attachment: Attachment): ImagesEmbedRecordImage {
  if (!attachment.blob) {
    throw new Error('An attached image has not been uploaded yet')
  }
  const alt = attachment.alt.trim()
  return {
    image: attachment.blob,
    ...(alt ? { alt } : {}),
    ...(attachment.aspectRatio ? { aspectRatio: attachment.aspectRatio } : {}),
  }
}
