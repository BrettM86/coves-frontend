import type {
  ProfileImageMimeType,
  ProfileViewDetailed,
  UpdateProfileInput,
} from '$lib/api/coves/types'

export interface ProfileFormValues {
  displayName: string
  bio: string
  avatarFile?: File
}

export type ProfileFormErrorCode = 'avatar-too-large' | 'avatar-invalid-type'

export class ProfileFormError extends Error {
  constructor(readonly code: ProfileFormErrorCode) {
    super(code)
    this.name = 'ProfileFormError'
  }
}

const maximumAvatarBytes = 1_000_000

function isAllowedAvatarMimeType(value: string): value is ProfileImageMimeType {
  return (
    value === 'image/png' || value === 'image/jpeg' || value === 'image/webp'
  )
}

function readFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('File reader returned an unexpected result'))
    }
    reader.readAsArrayBuffer(file)
  })
}

export function initialProfileValues(
  profile: ProfileViewDetailed,
): ProfileFormValues {
  return {
    displayName: profile.displayName ?? '',
    bio: profile.description ?? '',
    avatarFile: undefined,
  }
}

export async function profileUpdateInput(
  values: ProfileFormValues,
): Promise<UpdateProfileInput> {
  const textFields = {
    displayName: values.displayName,
    bio: values.bio,
  }

  if (values.avatarFile) {
    if (values.avatarFile.size > maximumAvatarBytes)
      throw new ProfileFormError('avatar-too-large')
    if (!isAllowedAvatarMimeType(values.avatarFile.type))
      throw new ProfileFormError('avatar-invalid-type')

    const bytes = new Uint8Array(await readFile(values.avatarFile))
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      )
    }
    return {
      ...textFields,
      avatarBlob: btoa(binary),
      avatarMimeType: values.avatarFile.type,
    }
  }

  return textFields
}
