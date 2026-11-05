import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import RichTextImage from './RichTextImage.svelte'

vi.mock('$env/dynamic/public', () => ({ env: {} }))

describe('RichTextImage frame', () => {
  it('fits the image instead of filling the body width', () => {
    const { body } = render(RichTextImage, {
      props: {
        image: {
          thumb: 'https://img.coves.test/img/content_preview/plain/did:plc:a/b',
          fullsize: 'https://img.coves.test/img/content_full/plain/did:plc:a/b',
          aspectRatio: { width: 1400, height: 1400 },
        },
        onopen: () => {},
      },
    })

    expect(body).toContain('calc(60vh * 1400 / 1400)')
    expect(body).not.toContain('w-full max-w-full')
  })
})
