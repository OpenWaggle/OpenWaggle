import { api } from '@/shared/lib/ipc'
import { runtimeKeyOf } from './terminal-owner'

interface LeaseState {
  count: number
  detachTimer: ReturnType<typeof globalThis.setTimeout> | null
  generation: number
  ownerKey: string
  redirect: LeaseState | null
  terminalId: string
}

type DetachSurface = (ownerKey: string, terminalId: string) => Promise<void>

function activeLease(lease: LeaseState): LeaseState {
  let active = lease
  while (active.redirect !== null) active = active.redirect
  return active
}

/**
 * Keeps the main-process event attachment alive across a same-commit viewport
 * move. React may mount the destination before or after unmounting the source;
 * the deferred, reference-counted detach is safe in both orders.
 */
export function createTerminalSurfaceLeaseManager(detachSurface: DetachSurface) {
  const leases = new Map<string, LeaseState>()

  const cancelDetach = (lease: LeaseState) => {
    const active = activeLease(lease)
    active.generation += 1
    if (active.detachTimer === null) return active
    globalThis.clearTimeout(active.detachTimer)
    active.detachTimer = null
    return active
  }

  const scheduleDetach = (lease: LeaseState) => {
    const active = activeLease(lease)
    if (active.count > 0 || active.detachTimer !== null) return
    const generation = active.generation + 1
    active.generation = generation
    active.detachTimer = globalThis.setTimeout(() => {
      active.detachTimer = null
      if (active.redirect !== null || active.generation !== generation || active.count > 0) return
      const key = runtimeKeyOf(active.ownerKey, active.terminalId)
      if (leases.get(key) === active) leases.delete(key)
      void detachSurface(active.ownerKey, active.terminalId).catch(() => undefined)
    }, 0)
  }

  const acquire = (ownerKey: string, terminalId: string) => {
    const key = runtimeKeyOf(ownerKey, terminalId)
    const lease = cancelDetach(
      leases.get(key) ?? {
        count: 0,
        detachTimer: null,
        generation: 0,
        ownerKey,
        redirect: null,
        terminalId,
      },
    )
    lease.count += 1
    leases.set(key, lease)

    let released = false
    return () => {
      if (released) return
      released = true
      const active = activeLease(lease)
      active.count = Math.max(0, active.count - 1)
      scheduleDetach(active)
    }
  }

  const migrateOwner = (fromOwnerKey: string, toOwnerKey: string) => {
    if (fromOwnerKey === toOwnerKey || fromOwnerKey.length === 0 || toOwnerKey.length === 0) return
    for (const [sourceKey, stored] of [...leases]) {
      const source = activeLease(stored)
      if (source.ownerKey !== fromOwnerKey) continue
      const targetKey = runtimeKeyOf(toOwnerKey, source.terminalId)
      const storedTarget = leases.get(targetKey)
      const target = storedTarget === undefined ? null : activeLease(storedTarget)
      cancelDetach(source)
      leases.delete(sourceKey)

      if (target !== null && target !== source) {
        cancelDetach(target)
        target.count += source.count
        source.count = 0
        source.redirect = target
        target.ownerKey = toOwnerKey
        leases.set(targetKey, target)
        scheduleDetach(target)
        continue
      }

      source.ownerKey = toOwnerKey
      leases.set(targetKey, source)
      scheduleDetach(source)
    }
  }

  return Object.assign(acquire, { migrateOwner })
}

const terminalSurfaceLeases = createTerminalSurfaceLeaseManager(api.detachTerminal)

export const acquireTerminalSurfaceLease = terminalSurfaceLeases
export const migrateTerminalSurfaceLeases = terminalSurfaceLeases.migrateOwner
