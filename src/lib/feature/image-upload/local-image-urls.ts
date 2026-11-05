import {
  addLocalImageUrl,
  deleteLocalImageUrl,
} from '$lib/api/coves/image-proxy'

/**
 * Makes an object URL for a picked image and registers it with the image URL
 * gate, so renderers accept it. Release it with {@link revokeLocalImageUrl}.
 */
export function createLocalImageUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  addLocalImageUrl(url)
  return url
}

/** Revokes an object URL made by {@link createLocalImageUrl}; the gate refuses it from then on. */
export function revokeLocalImageUrl(url: string): void {
  deleteLocalImageUrl(url)
  URL.revokeObjectURL(url)
}
