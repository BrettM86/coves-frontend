export const navigating = $state<{ to: { url: URL } | null }>({ to: null })
export const page = $state<{
  data: { session: { authenticated: boolean } | undefined }
}>({ data: { session: { authenticated: true } } })
