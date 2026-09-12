import { describe, expectTypeOf, it } from 'vitest'
import type { UpdateProfileInput } from './types'

describe('UpdateProfileInput', () => {
  it('requires image bytes and MIME type together', () => {
    expectTypeOf<{ avatarBlob: string }>().not.toExtend<UpdateProfileInput>()
    expectTypeOf<{
      avatarMimeType: 'image/png'
    }>().not.toExtend<UpdateProfileInput>()
    expectTypeOf<{
      avatarBlob: string
      avatarMimeType: 'image/png'
    }>().toExtend<UpdateProfileInput>()

    expectTypeOf<{ bannerBlob: string }>().not.toExtend<UpdateProfileInput>()
    expectTypeOf<{
      bannerMimeType: 'image/webp'
    }>().not.toExtend<UpdateProfileInput>()
    expectTypeOf<{
      bannerBlob: string
      bannerMimeType: 'image/webp'
    }>().toExtend<UpdateProfileInput>()
  })

  it('rejects unsupported image MIME types', () => {
    expectTypeOf<{
      avatarBlob: string
      avatarMimeType: 'image/gif'
    }>().not.toExtend<UpdateProfileInput>()
  })
})
