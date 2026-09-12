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

/** Navigation owns a lease; previews and agent runs retain it after navigation. */
export function acquireBrowserPreviewOwner(ownerKey: string) {
  if (ownerKey.length === 0) return { ready: Promise.resolve(), release: () => {} }
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
      void enqueue(releaseIdleOwners).catch((error: unknown) => {
        useUIStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Browser preview owner cleanup failed.',
            'error',
          )
      })
    },
  }
}
