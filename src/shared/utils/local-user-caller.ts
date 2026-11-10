/** The local desktop user: the GUI, or the `openwaggle` CLI authenticated as the local user. */
export function isLocalUserCallerId(callerId: string) {
  return (
    callerId === 'local-user' || callerId === 'gui:local-user' || callerId.startsWith('local-user:')
  )
}
