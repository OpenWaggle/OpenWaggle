import { useBackgroundRunStore } from '@/features/chat/state'
import {
  ensureBrowserPreviewOwnerRegistered,
  hasPendingBrowserPreviewOwnerWork,
  unregisterBrowserPreviewOwner,
} from './browser-preview-owner-runtime'
import { useUIStore } from './ui-store'
import { useWorkspacePanelStore } from './workspace-panel-store'

const mountedOwners = new Map<string, number>()
const managedOwners = new Set<string>()
let lifecycle: Promise<void> = Promise.resolve()

function retainsOwner(ownerKey: string) {
  if (mountedOwners.has(ownerKey) || hasPendingBrowserPreviewOwnerWork(ownerKey)) return true
  if (useWorkspacePanelStore.getState().groups[ownerKey]?.browserTabs.length) return true
  for (const sessionId of useBackgroundRunStore.getState().activeRunIds) {
    if (sessionId === ownerKey) return true
  }
  return false
}

async function releaseIdleOwners() {
  for (const ownerKey of managedOwners) {
    if (retainsOwner(ownerKey)) continue
    await unregisterBrowserPreviewOwner(ownerKey)
    managedOwners.delete(ownerKey)
  }
}

function enqueue(operation: () => Promise<void>) {
  const next = lifecycle.catch(() => undefined).then(operation)
  lifecycle = next.catch(() => undefined)
  return next
}

function reportReleaseFailure(error: unknown) {
  useUIStore
    .getState()
    .showToast(
      error instanceof Error ? error.message : 'Browser preview owner cleanup failed.',
      'error',
    )
}

function hasReleasableOwner() {
  for (const ownerKey of managedOwners) {
    if (!retainsOwner(ownerKey)) return true
  }
  return false
}

let retentionWatchInstalled = false

/**
 * A Session left while its Run was active, or while it kept browser tabs, stays registered. Release
 * it as soon as that retention ends, not at the next navigation: while it is registered the Host
 * counts the Session as open in the app, so Hive cleanup keeps a finished Worker (issue #352).
 */
function watchRetentionEnd() {
  if (retentionWatchInstalled) return
  retentionWatchInstalled = true
  const releaseIfIdle = () => {
    if (hasReleasableOwner()) void enqueue(releaseIdleOwners).catch(reportReleaseFailure)
  }
  useBackgroundRunStore.subscribe((state, previous) => {
    if (state.activeRunIds !== previous.activeRunIds) releaseIfIdle()
  })
  useWorkspacePanelStore.subscribe((state, previous) => {
    if (state.groups !== previous.groups) releaseIfIdle()
  })
}

/** Navigation owns a lease; previews and agent runs retain it after navigation. */
export function acquireBrowserPreviewOwner(ownerKey: string) {
  if (ownerKey.length === 0) return { ready: Promise.resolve(), release: () => {} }
  watchRetentionEnd()
  mountedOwners.set(ownerKey, (mountedOwners.get(ownerKey) ?? 0) + 1)
  let released = false
  const ready = enqueue(async () => {
    // Release before registering, so a new Session does not hit the native cap
    // while its predecessor's unregister IPC is still in flight.
    await releaseIdleOwners()
    if (released) return
    managedOwners.add(ownerKey)
    await ensureBrowserPreviewOwnerRegistered(ownerKey)
  })
  return {
    ready,
    release: () => {
      if (released) return
      released = true
      const count = (mountedOwners.get(ownerKey) ?? 1) - 1
      if (count === 0) mountedOwners.delete(ownerKey)
      else mountedOwners.set(ownerKey, count)
      void enqueue(releaseIdleOwners).catch(reportReleaseFailure)
    },
  }
}
