import { goto } from '$app/navigation'
import { page } from '$app/state'

const POST_PATH = /^\/c\/[^/]+\/post\/[^/]+\/[^/]+$/

export function handlePostFeedClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return
  }

  const link = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!link) return

  const target = link.getAttribute('target')
  if (target && target.toLowerCase() !== '_self') return
  if (
    link.hasAttribute('download') ||
    link
      .getAttribute('rel')
      ?.split(/\s+/)
      .some((token) => token.toLowerCase() === 'external') ||
    link.closest('[data-sveltekit-reload]')
  ) {
    return
  }

  const href = link.getAttribute('href')
  if (!href) return

  const destination = new URL(href, page.url)
  if (
    destination.origin !== page.url.origin ||
    !POST_PATH.test(destination.pathname)
  ) {
    return
  }

  const postUri = link.closest<HTMLElement>('[data-post-uri]')?.dataset.postUri
  if (!postUri) return

  event.preventDefault()
  void goto(href, {
    state: {
      postFeedOrigin: {
        url: `${page.url.pathname}${page.url.search}${page.url.hash}`,
        scrollY: window.scrollY,
        anchor: {
          postUri,
          href,
          viewportTop: link.getBoundingClientRect().top,
        },
      },
    },
  })
}
