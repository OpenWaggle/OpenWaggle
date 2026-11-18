const expectedOwnerCountsByEmittingOwner = new Map<string, Map<string, number>>()

/**
 * During draft-to-Session handoff main starts emitting the destination owner
 * before React can commit the rekeyed pane. This temporary route lets the old
 * pane consume and ACK those events instead of creating an output deadlock.
 */
export function beginTerminalEventOwnerHandoff(previousOwnerKey: string, nextOwnerKey: string) {
  const expectedOwners =
    expectedOwnerCountsByEmittingOwner.get(nextOwnerKey) ?? new Map<string, number>()
  expectedOwners.set(previousOwnerKey, (expectedOwners.get(previousOwnerKey) ?? 0) + 1)
  expectedOwnerCountsByEmittingOwner.set(nextOwnerKey, expectedOwners)
  let released = false
  return () => {
    if (released) return
    released = true
    const nextCount = (expectedOwners.get(previousOwnerKey) ?? 1) - 1
    if (nextCount === 0) expectedOwners.delete(previousOwnerKey)
    else expectedOwners.set(previousOwnerKey, nextCount)
    if (expectedOwners.size === 0) expectedOwnerCountsByEmittingOwner.delete(nextOwnerKey)
  }
}

export function terminalEventMatchesOwner(expectedOwnerKey: string, emittingOwnerKey: string) {
  return (
    expectedOwnerKey === emittingOwnerKey ||
    (expectedOwnerCountsByEmittingOwner.get(emittingOwnerKey)?.get(expectedOwnerKey) ?? 0) > 0
  )
}
