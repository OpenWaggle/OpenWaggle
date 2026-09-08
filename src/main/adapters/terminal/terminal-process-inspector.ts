import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey } from '@shared/types/terminal'
import { createLogger } from '../../logger'
import {
  collectDescendants,
  makeUnreliableSnapshot,
  resolveForegroundName,
  sameActivitySnapshot,
} from './terminal-process-activity'
import { sampleTerminalActivity } from './terminal-process-inspector-sample'
import type {
  InspectorTarget,
  TerminalProcessActivitySnapshot,
} from './terminal-process-inspector-types'
import { makeTerminalProcessPollScheduler } from './terminal-process-poll-scheduler'

export { type ProcessRow, parsePosixRow } from './terminal-process-probes'
export type { InspectorTarget, TerminalProcessActivitySnapshot }
export { collectDescendants, resolveForegroundName }

const logger = createLogger('terminal-inspector')

function sameTargetProcess(left: InspectorTarget, right: InspectorTarget) {
  return (
    left.pid === right.pid &&
    left.tty === right.tty &&
    left.ttyIdentity === right.ttyIdentity &&
    left.processIdentity?.pid === right.processIdentity?.pid &&
    left.processIdentity?.startedAt === right.processIdentity?.startedAt
  )
}

function targetProcessKey(target: InspectorTarget) {
  return JSON.stringify([
    target.pid,
    target.tty,
    target.ttyIdentity,
    target.processIdentity?.pid,
    target.processIdentity?.startedAt,
  ])
}

function reconcileSnapshotsForTargets(
  previousTargets: ReadonlyMap<TerminalKey, InspectorTarget>,
  nextTargets: ReadonlyMap<TerminalKey, InspectorTarget>,
  previousSnapshots: ReadonlyMap<TerminalKey, TerminalProcessActivitySnapshot>,
) {
  const movedSnapshots = new Map<string, TerminalProcessActivitySnapshot>()
  for (const [key, target] of previousTargets) {
    if (nextTargets.has(key)) continue
    const snapshot = previousSnapshots.get(key)
    if (snapshot !== undefined) movedSnapshots.set(targetProcessKey(target), snapshot)
  }

  const reconciled = new Map<TerminalKey, TerminalProcessActivitySnapshot>()
  for (const [key, target] of nextTargets) {
    const previousTarget = previousTargets.get(key)
    const sameKeySnapshot = previousSnapshots.get(key)
    if (
      previousTarget !== undefined &&
      sameKeySnapshot !== undefined &&
      sameTargetProcess(previousTarget, target)
    ) {
      reconciled.set(key, sameKeySnapshot)
      continue
    }
    const movedSnapshot = movedSnapshots.get(targetProcessKey(target))
    if (movedSnapshot !== undefined) reconciled.set(key, movedSnapshot)
  }
  return reconciled
}

/**
 * Shared process-table poll behind process-aware tab titles and port previews
 * (ADR 0030). One process-table snapshot is shared by every live terminal in
 * the tick, so polling launches a constant number of operating-system probes
 * regardless of pane count. The foreground name is exact: the shell row's
 * `tpgid` is the controlling tty's foreground process group, so the process
 * leading that group is the command the user is interacting with. Windows
 * keeps a nearest-descendant walk.
 * Listening ports come from a periodic socket table scan filtered to the
 * shell's descendant pids. Emits only on change, and skips exec entirely
 * while no terminal is live.
 */

export interface TerminalProcessInspector {
  /** Begin polling; the callback fires for each target whose snapshot changed. */
  start(onActivity: (key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => void): void
  /** Observe every successful process-table sample, even when metadata is unchanged. */
  observe(
    onObservation: (key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => void,
  ): void
  /** Replace the polled target set (live terminal pids). */
  setTargets(targets: Iterable<InspectorTarget>): void
  stop(): void
}

export function makeTerminalProcessInspector(): TerminalProcessInspector {
  let onActivity: ((key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => void) | null =
    null
  let onObservation:
    | ((key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => void)
    | null = null
  let lifecycleRevision = 0
  let lastPortScan = 0
  const targets = new Map<TerminalKey, InspectorTarget>()
  const lastSnapshot = new Map<TerminalKey, TerminalProcessActivitySnapshot>()

  const emitIfChanged = (key: TerminalKey, snapshot: TerminalProcessActivitySnapshot) => {
    const previous = lastSnapshot.get(key)
    if (previous !== undefined && sameActivitySnapshot(previous, snapshot)) return
    lastSnapshot.set(key, snapshot)
    onActivity?.(key, snapshot)
  }

  const tick = async (): Promise<boolean> => {
    const revision = lifecycleRevision
    const sampledTargets = new Map(targets)
    try {
      const shouldScanPorts = Date.now() - lastPortScan >= TERMINAL.PORT_SCAN_POLL_MS
      const snapshots = await sampleTerminalActivity(
        sampledTargets,
        new Map(lastSnapshot),
        shouldScanPorts,
      )
      if (revision !== lifecycleRevision) return true
      if (shouldScanPorts) lastPortScan = Date.now()
      for (const [key, snapshot] of snapshots) {
        const original = sampledTargets.get(key)
        const current = targets.get(key)
        if (!original || !current || !sameTargetProcess(original, current)) continue
        emitIfChanged(key, snapshot)
        if (snapshot.processReliable) onObservation?.(key, snapshot)
      }
      return [...snapshots.values()].some((snapshot) => snapshot.processReliable)
    } catch (error) {
      if (revision !== lifecycleRevision) return true
      for (const [key, original] of sampledTargets) {
        const current = targets.get(key)
        if (!current || !sameTargetProcess(original, current)) continue
        emitIfChanged(key, makeUnreliableSnapshot(lastSnapshot.get(key)))
      }
      logger.debug('Terminal process poll skipped', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
  const scheduler = makeTerminalProcessPollScheduler(tick)

  return {
    start(activities) {
      onActivity = activities
      scheduler.update(targets.size > 0)
    },
    observe(observations) {
      onObservation = observations
    },
    setTargets(nextTargets) {
      const previousTargets = new Map(targets)
      const nextTargetMap = new Map([...nextTargets].map((target) => [target.key, target] as const))
      const changed =
        previousTargets.size !== nextTargetMap.size ||
        [...nextTargetMap].some(([key, target]) => {
          const previous = previousTargets.get(key)
          return previous === undefined || !sameTargetProcess(previous, target)
        })
      const nextSnapshots = reconcileSnapshotsForTargets(
        previousTargets,
        nextTargetMap,
        lastSnapshot,
      )
      targets.clear()
      for (const [key, target] of nextTargetMap) targets.set(key, target)
      lastSnapshot.clear()
      for (const [key, snapshot] of nextSnapshots) lastSnapshot.set(key, snapshot)
      scheduler.update(onActivity !== null && targets.size > 0, changed)
    },
    stop() {
      onActivity = null
      onObservation = null
      lifecycleRevision += 1
      scheduler.update(false)
      lastPortScan = 0
      lastSnapshot.clear()
      targets.clear()
    },
  }
}
