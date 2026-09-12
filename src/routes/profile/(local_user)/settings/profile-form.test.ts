import { describe, expect, it, vi } from 'vitest'
import type { DID, Handle } from '$lib/types/atproto'
import { initialProfileValues, profileUpdateInput } from './profile-form'

describe('profile settings form values', () => {
  it('seeds and submits the editable text fields from a Coves profile', async () => {
    const values = initialProfileValues({
      did: 'did:plc:alice' as DID,
      handle: 'alice.coves.social' as Handle,
      createdAt: '2026-09-01T00:00:00Z',
      displayName: 'Alice Example',
      description: 'Existing bio',
      avatar: 'https://cdn.coves.test/alice.jpg',
    })

    expect(values).toEqual({
      displayName: 'Alice Example',
      bio: 'Existing bio',
      avatarFile: undefined,
    })

    values.displayName = 'Alice Updated'
    values.bio = 'Updated bio'

    await expect(profileUpdateInput(values)).resolves.toEqual({
      displayName: 'Alice Updated',
      bio: 'Updated bio',
    })
  })

  it('encodes a selected avatar for the updateProfile wire format', async () => {
    const avatarBytes = new TextEncoder().encode('avatar')
    const avatarFile = {
      type: 'image/png',
      arrayBuffer: async () => avatarBytes.buffer,
    } as File

    await expect(
      profileUpdateInput({
        displayName: 'Alice',
        bio: 'Hello',
        avatarFile,
      }),
    ).resolves.toEqual({
      displayName: 'Alice',
      bio: 'Hello',
      avatarBlob: 'YXZhdGFy',
      avatarMimeType: 'image/png',
    })
  })

  it('rejects an oversized avatar before reading it', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const avatarFile = {
      type: 'image/png',
      size: 1_000_001,
      arrayBuffer,
    } as unknown as File

    await expect(
      profileUpdateInput({
        displayName: 'Alice',
        bio: 'Hello',
        avatarFile,
      }),
    ).rejects.toMatchObject({ code: 'avatar-too-large' })
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it.each(['', 'image/gif', 'text/html'])(
    'rejects unsupported avatar type %j before reading it',
    async (type) => {
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
      const avatarFile = {
        type,
        size: 100,
        arrayBuffer,
      } as unknown as File

      await expect(
        profileUpdateInput({
          displayName: 'Alice',
          bio: 'Hello',
          avatarFile,
        }),
      ).rejects.toMatchObject({ code: 'avatar-invalid-type' })
      expect(arrayBuffer).not.toHaveBeenCalled()
    },
  )
})
