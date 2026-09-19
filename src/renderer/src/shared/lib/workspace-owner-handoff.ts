import { createRendererLogger } from './logger'

const logger = createRendererLogger('workspace-owner-handoff')
const pendingOwners = new Set<string>()
const listeners = new Set<() => void>()
const deferredByOwner = new Map<string, Map<string, (ownerKey: string) => void>>()
const SIDE_PANEL_PREFIX = 'side-panel:'
export const WORKSPACE_OWNER_HANDOFF_MESSAGE =
  'Workspace tabs are moving into the Session. Please try again shortly.'

function runtimeOwnerKey(ownerKey: string) {
  return ownerKey.startsWith(SIDE_PANEL_PREFIX)
    ? ownerKey.slice(SIDE_PANEL_PREFIX.length)
    : ownerKey
}

function runHandoffCallback(callback: () => void, errors: unknown[]) {
  try {
    callback()
  } catch (error) {
    errors.push(error)
  }
}

function notifyHandoffListeners(errors: unknown[]) {
  for (const listener of [...listeners]) runHandoffCallback(listener, errors)
  // A subscriber or post-commit reconciliation error cannot undo the handoff
  // or override a migration failure while its finally block releases owners.
  if (errors.length > 0) logger.error('Workspace handoff callbacks failed.', { errors })
}

export function isWorkspaceOwnerHandoffPending(ownerKey: string) {
  return pendingOwners.has(runtimeOwnerKey(ownerKey))
}

export function subscribeWorkspaceOwnerHandoff(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function assertWorkspaceOwnerAvailable(ownerKey: string) {
  if (isWorkspaceOwnerHandoffPending(ownerKey)) {
    throw new Error(WORKSPACE_OWNER_HANDOFF_MESSAGE)
  }
}

/** Main-opened terminal reconciliation must run after, not disappear during, a handoff. */
export function deferWorkspaceOwnerReconciliation(
  ownerKey: string,
  key: string,
  reconcile: (ownerKey: string) => void,
) {
  if (!isWorkspaceOwnerHandoffPending(ownerKey)) return false
  const owner = runtimeOwnerKey(ownerKey)
  const deferred = deferredByOwner.get(owner) ?? new Map<string, (ownerKey: string) => void>()
  deferred.set(`${ownerKey}:${key}`, (resolvedOwner) =>
    reconcile(
      ownerKey.startsWith(SIDE_PANEL_PREFIX)
        ? `${SIDE_PANEL_PREFIX}${resolvedOwner}`
        : resolvedOwner,
    ),
  )
  deferredByOwner.set(owner, deferred)
  return true
}

/** Holds both owners through the native and renderer halves of one handoff. */
export function beginWorkspaceOwnerHandoff(fromOwnerKey: string, toOwnerKey: string) {
  const owners = [...new Set([runtimeOwnerKey(fromOwnerKey), runtimeOwnerKey(toOwnerKey)])]
  for (const owner of owners) assertWorkspaceOwnerAvailable(owner)
  for (const owner of owners) pendingOwners.add(owner)
  notifyHandoffListeners([])
  let released = false
  return (committed = false) => {
    if (released) return
    released = true
    for (const owner of owners) pendingOwners.delete(owner)
    const reconciliations = owners.map((owner) => {
      const deferred = deferredByOwner.get(owner)
      deferredByOwner.delete(owner)
      const resolvedOwner =
        committed && owner === runtimeOwnerKey(fromOwnerKey) ? runtimeOwnerKey(toOwnerKey) : owner
      return { resolvedOwner, callbacks: [...(deferred?.values() ?? [])] }
    })
    const errors: unknown[] = []
    for (const { resolvedOwner, callbacks } of reconciliations) {
      for (const reconcile of callbacks) runHandoffCallback(() => reconcile(resolvedOwner), errors)
    }
    notifyHandoffListeners(errors)
  }
}
