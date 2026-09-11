import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Button from './Button.svelte'

describe('Button native disabled state', () => {
  it.each([
    { disabled: true, loading: false },
    { disabled: false, loading: true },
    { disabled: true, loading: true },
  ])('disables the native submit button for %j', (props) => {
    const { body } = render(Button, { props: { ...props, submit: true } })
    expect(body).toMatch(/<button\b[^>]*\sdisabled(?:[\s=>])/)
    expect(body).toContain('type="submit"')
  })

  it('leaves an idle button enabled', () => {
    const { body } = render(Button, {
      props: { disabled: false, loading: false },
    })
    expect(body).not.toMatch(/<button\b[^>]*\sdisabled(?:[\s=>])/)
  })

  it('does not emit a native disabled attribute on links', () => {
    const { body } = render(Button, {
      props: { href: '/example', disabled: true },
    })
    expect(body).toContain('<a ')
    expect(body).not.toMatch(/<a\b[^>]*\sdisabled(?:[\s=>])/)
  })
})
