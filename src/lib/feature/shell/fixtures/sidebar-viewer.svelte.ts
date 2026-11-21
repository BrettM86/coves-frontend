// A reactive stand-in for `profile` in sidebar tests: flipping `current`
// re-runs the sidebar's load/reset effect the way a real sign-in or sign-out
// does.
export const sidebarViewer = $state<{
  current:
    | { type: 'authenticated'; did: string }
    | { type: 'anonymous'; did?: undefined }
  sessionExpired: boolean
}>({
  current: { type: 'authenticated', did: 'did:plc:viewer' },
  sessionExpired: false,
})
