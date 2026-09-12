import type { TerminalProcessActivitySnapshot } from './terminal-process-inspector-types'
import { NO_TTY_FOREGROUND_GROUP, type ProcessRow } from './terminal-process-probes'

/** Descendant names and pids for one shell pid, nearest first (BFS). */
export function collectDescendants(rootPid: number, rows: Map<number, ProcessRow>) {
  const childrenByParent = new Map<number, ProcessRow[]>()
  for (const row of rows.values()) {
    const siblings = childrenByParent.get(row.ppid) ?? []
    siblings.push(row)
    childrenByParent.set(row.ppid, siblings)
  }

  const names: string[] = []
  // Include the shell itself for socket attribution: shells can own listening
  // descriptors directly (for example via a builtin). Keep its name out of
  // `names`, which intentionally describes only child/background work.
  const pids = new Set<number>([rootPid])
  let frontier = [rootPid]
  while (frontier.length > 0) {
    const next: number[] = []
    for (const pid of frontier) {
      for (const child of childrenByParent.get(pid) ?? []) {
        if (pids.has(child.pid)) continue
        pids.add(child.pid)
        names.push(child.name)
        next.push(child.pid)
      }
    }
    frontier = next
  }
  return { names, pids }
}

/** Resolve the command currently owning the tty foreground process group. */
export function resolveForegroundName(shellPid: number, rows: Map<number, ProcessRow>) {
  const shell = rows.get(shellPid)
  if (shell === undefined || shell.tpgid === NO_TTY_FOREGROUND_GROUP) {
    return collectDescendants(shellPid, rows).names[0] ?? null
  }

  const leader = rows.get(shell.tpgid)
  if (leader !== undefined) return leader.name
  for (const row of rows.values()) {
    if (row.pgid === shell.tpgid) return row.name
  }
  return collectDescendants(shellPid, rows).names[0] ?? null
}

type PortProbe = Map<number, number[]> | null | undefined

function collectActivityProcesses(
  pid: number,
  targetTtyIdentity: string | null,
  rows: Map<number, ProcessRow>,
  previous: TerminalProcessActivitySnapshot | undefined,
) {
  const { names: descendantNames, pids } = collectDescendants(pid, rows)
  const names = [...descendantNames]
  if (targetTtyIdentity !== null) {
    for (const row of rows.values()) {
      if (row.pid === pid || row.ttyIdentity !== targetTtyIdentity || pids.has(row.pid)) continue
      pids.add(row.pid)
      names.push(row.name)
    }
  }
  for (const identity of previous?.processIdentities ?? []) {
    const row = rows.get(identity.pid)
    if (
      row?.identityVerified !== true ||
      row.startedAt !== identity.startedAt ||
      pids.has(row.pid)
    ) {
      continue
    }
    pids.add(row.pid)
    if (row.pid !== pid) names.push(row.name)
  }
  return { names, pids }
}

export function makeActivitySnapshot(
  pid: number,
  targetTty: string | null,
  targetTtyIdentity: string | null,
  rows: Map<number, ProcessRow>,
  portsByPid: PortProbe,
  previous: TerminalProcessActivitySnapshot | undefined,
): TerminalProcessActivitySnapshot {
  const { names, pids } = collectActivityProcesses(pid, targetTtyIdentity, rows, previous)
  const ports =
    portsByPid === null || portsByPid === undefined
      ? (previous?.ports ?? [])
      : collectPorts(pids, portsByPid)
  const reliable = portsByPid === undefined ? (previous?.reliable ?? false) : portsByPid !== null
  return {
    // The root shell is not child work. Keep the default "Terminal N" label
    // while idle instead of replacing it with zsh/bash/fish.
    processName: names.length === 0 ? null : resolveForegroundName(pid, rows),
    processNames: [...new Set(names)],
    processPids: [...pids],
    processIdentities: [...pids].flatMap((processPid) => {
      const row = rows.get(processPid)
      return row?.identityVerified === true ? [{ pid: row.pid, startedAt: row.startedAt }] : []
    }),
    tty: rows.get(pid)?.tty ?? targetTty ?? previous?.tty ?? null,
    ports,
    processReliable: true,
    reliable,
  }
}

export function makeUnreliableSnapshot(
  previous: TerminalProcessActivitySnapshot | undefined,
): TerminalProcessActivitySnapshot {
  return {
    processName: previous?.processName ?? null,
    processNames: previous?.processNames ?? [],
    processPids: previous?.processPids ?? [],
    processIdentities: previous?.processIdentities ?? [],
    tty: previous?.tty ?? null,
    ports: previous?.ports ?? [],
    processReliable: false,
    reliable: false,
  }
}

export function sameActivitySnapshot(
  previous: TerminalProcessActivitySnapshot,
  snapshot: TerminalProcessActivitySnapshot,
) {
  return (
    previous.processName === snapshot.processName &&
    sameValues(previous.processNames, snapshot.processNames) &&
    sameValues(previous.processPids, snapshot.processPids) &&
    sameProcessIdentities(previous.processIdentities, snapshot.processIdentities) &&
    previous.tty === snapshot.tty &&
    sameValues(previous.ports, snapshot.ports) &&
    previous.processReliable === snapshot.processReliable &&
    previous.reliable === snapshot.reliable
  )
}

function collectPorts(pids: Set<number>, portsByPid: Map<number, number[]>) {
  const ports = new Set<number>()
  for (const pid of pids) {
    for (const port of portsByPid.get(pid) ?? []) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}

function sameValues<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameProcessIdentities(
  a: TerminalProcessActivitySnapshot['processIdentities'],
  b: TerminalProcessActivitySnapshot['processIdentities'],
) {
  return (
    a.length === b.length &&
    a.every(
      (identity, index) =>
        identity.pid === b[index]?.pid && identity.startedAt === b[index]?.startedAt,
    )
  )
}
