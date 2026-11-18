/** Stable kernel-process identity. `startedAt` is an opaque token, never a wall-clock date. */
export interface TerminalProcessIdentity {
  readonly pid: number
  readonly startedAt: string
}

export interface TerminalProcessMetadata extends TerminalProcessIdentity {
  readonly tty: string | null
  /** Kernel device identity of the controlling tty, independent of its path text. */
  readonly ttyIdentity: string | null
}

/** One kernel-coherent process observation used for identity and ancestry proof. */
export interface TerminalKernelProcessInfo extends TerminalProcessIdentity {
  readonly ppid: number
  readonly pgid: number
  readonly tpgid: number
  readonly ttyIdentity: string | null
  readonly zombie: boolean
  readonly name: string
}

/** Maximum wall time for the single targeted process sample started with a PTY. */
export const TERMINAL_SPAWN_PROCESS_METADATA_MS = 25

export function mergeTerminalProcessIdentities(
  ...groups: readonly (readonly TerminalProcessIdentity[])[]
) {
  const identities = new Map<number, TerminalProcessIdentity>()
  const conflicts = new Set<number>()
  for (const group of groups) {
    for (const identity of group) {
      if (conflicts.has(identity.pid)) continue
      const current = identities.get(identity.pid)
      if (current !== undefined && current.startedAt !== identity.startedAt) {
        identities.delete(identity.pid)
        conflicts.add(identity.pid)
        continue
      }
      identities.set(identity.pid, identity)
    }
  }
  return [...identities.values()]
}
