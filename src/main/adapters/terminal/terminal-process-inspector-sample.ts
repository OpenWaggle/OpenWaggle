import os from 'node:os'
import type { TerminalKey } from '@shared/types/terminal'
import {
  collectDescendants,
  makeActivitySnapshot,
  makeUnreliableSnapshot,
} from './terminal-process-activity'
import type {
  InspectorTarget,
  TerminalProcessActivitySnapshot,
} from './terminal-process-inspector-types'
import {
  hydratePosixProcessRows,
  type ProcessRow,
  readListeningPorts,
  readProcessTable,
} from './terminal-process-probes'

const TERMINAL_ACTIVITY_KERNEL_ENRICH_MS = 50

export async function sampleTerminalActivity(
  targets: ReadonlyMap<TerminalKey, InspectorTarget>,
  previousSnapshots: ReadonlyMap<TerminalKey, TerminalProcessActivitySnapshot>,
  scanPorts: boolean,
) {
  const rows = await readProcessTable()
  if (rows === null) {
    return new Map(
      [...targets.keys()].map(
        (key) => [key, makeUnreliableSnapshot(previousSnapshots.get(key))] as const,
      ),
    )
  }
  const candidatePids = collectTargetProcessCandidates(targets, previousSnapshots, rows)
  const hydratedRows = hydratePosixProcessRows(
    rows,
    candidatePids,
    Date.now() + TERMINAL_ACTIVITY_KERNEL_ENRICH_MS,
  )
  if (hydratedRows === null) {
    return unreliableSnapshots(targets, previousSnapshots)
  }
  const verifiedRows = new Map(
    [...hydratedRows].filter(([, row]) => os.platform() === 'win32' || row.identityVerified),
  )
  const ownedPids = collectOwnedTargetProcessPids(targets, previousSnapshots, verifiedRows)
  const portsByPid = scanPorts ? await readListeningPorts(ownedPids) : undefined
  return new Map(
    [...targets.entries()].map(([key, target]) => {
      if (!targetRootIsVerified(target, verifiedRows)) {
        return [key, makeUnreliableSnapshot(previousSnapshots.get(key))] as const
      }
      const snapshot = makeActivitySnapshot(
        target.pid,
        target.tty,
        target.ttyIdentity,
        verifiedRows,
        portsByPid,
        previousSnapshots.get(key),
      )
      return [key, snapshot] as const
    }),
  )
}

function unreliableSnapshots(
  targets: ReadonlyMap<TerminalKey, InspectorTarget>,
  previousSnapshots: ReadonlyMap<TerminalKey, TerminalProcessActivitySnapshot>,
) {
  return new Map(
    [...targets.keys()].map(
      (key) => [key, makeUnreliableSnapshot(previousSnapshots.get(key))] as const,
    ),
  )
}

function collectTargetProcessCandidates(
  targets: ReadonlyMap<TerminalKey, InspectorTarget>,
  previousSnapshots: ReadonlyMap<TerminalKey, TerminalProcessActivitySnapshot>,
  rows: Map<number, ProcessRow>,
) {
  const processPids = new Set<number>()
  for (const [key, target] of targets) {
    for (const pid of collectDescendants(target.pid, rows).pids) processPids.add(pid)
    for (const row of rows.values()) {
      if (target.tty !== null && row.tty === target.tty) processPids.add(row.pid)
    }
    for (const pid of previousSnapshots.get(key)?.processPids ?? []) processPids.add(pid)
  }
  return [...processPids]
}

function targetRootIsVerified(target: InspectorTarget, rows: ReadonlyMap<number, ProcessRow>) {
  const root = rows.get(target.pid)
  if (root === undefined) return false
  if (os.platform() === 'win32') return true
  return (
    target.processIdentity !== null &&
    target.ttyIdentity !== null &&
    root.startedAt === target.processIdentity.startedAt &&
    root.ttyIdentity === target.ttyIdentity
  )
}

function collectOwnedTargetProcessPids(
  targets: ReadonlyMap<TerminalKey, InspectorTarget>,
  previousSnapshots: ReadonlyMap<TerminalKey, TerminalProcessActivitySnapshot>,
  rows: Map<number, ProcessRow>,
) {
  const processPids = new Set<number>()
  for (const [key, target] of targets) {
    if (!targetRootIsVerified(target, rows)) continue
    for (const pid of collectDescendants(target.pid, rows).pids) processPids.add(pid)
    for (const identity of previousSnapshots.get(key)?.processIdentities ?? []) {
      if (rows.get(identity.pid)?.startedAt === identity.startedAt) processPids.add(identity.pid)
    }
    if (target.ttyIdentity !== null) {
      for (const row of rows.values()) {
        if (row.ttyIdentity === target.ttyIdentity) processPids.add(row.pid)
      }
    }
  }
  return [...processPids]
}
