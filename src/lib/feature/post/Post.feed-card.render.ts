import { render } from 'svelte/server'
import { JSDOM } from 'jsdom'
import type { PostView } from '$lib/api/coves/types'
import Post from './Post.svelte'

/** Server-render a Post and return its <article>. */
export function renderPost(
  post: PostView,
  props: { view: 'cozy' | 'compact'; expandBody?: boolean },
): HTMLElement {
  const html = render(Post, { props: { post, ...props } }).body
  const article = new JSDOM(html).window.document.querySelector('article')
  if (!article) throw new Error('Post rendered no article')
  return article
}

export const accessibleName = (element: Element): string =>
  element.getAttribute('aria-label') ?? element.getAttribute('title') ?? ''

/** Accessible names of the action bar's controls, in DOM order. */
export function actionNames(article: Element): string[] {
  const bar = article.querySelector('footer')
  if (!bar) return []
  return [...bar.querySelectorAll('a, button')]
    .filter((control) => !control.closest('[hidden], [aria-hidden="true"]'))
    .map(accessibleName)
    .filter((name) => name !== '')
}

/** Innermost elements under `root` whose whole text is exactly `text`. */
export function leafWithText(root: Element, text: string): Element[] {
  return [...root.querySelectorAll('*')].filter(
    (element) =>
      element.textContent?.trim() === text &&
      ![...element.children].some(
        (child) => child.textContent?.trim() === text,
      ),
  )
}
