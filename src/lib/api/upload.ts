import { client } from '$lib/api/client.svelte'

export async function uploadImage(
  image: File | null | undefined,
  instance: string,
  jwt: string,
): Promise<string | undefined> {
  if (!image) return

  const res = await client({ auth: jwt, instanceURL: instance }).uploadImage({
    image: image,
  })

  if (res.url) return res.url
  else throw new Error(`Failed to upload image. ${res.msg}`)
}
