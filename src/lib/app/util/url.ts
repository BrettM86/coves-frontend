export const DOMAIN_REGEX =
  /^(http(s)?:\/\/)?((?!-)[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}(:[0-9]{0,5})?$/g
export const DOMAIN_REGEX_FORMS =
  '(http(s)?://)?((?!-)[A-Za-z0-9]{1,63}.)+[A-Za-z]{2,63}(:[0-9]{0,5})?'

export const instanceToURL = (input: string): string =>
  input.startsWith('http://') || input.startsWith('https://')
    ? input
    : `https://${input}`

export function canParseUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export const isImage = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(jpeg|jpg|gif|png|svg|bmp|webp|avif)/i.test(url)
}

export const isVideo = (url: string | undefined): boolean => {
  if (!url) return false
  return /\.(mp4|mov|webm|mkv|avi)/i.test(url)
}
