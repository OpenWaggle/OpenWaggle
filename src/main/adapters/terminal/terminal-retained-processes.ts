import { createLogger } from '../../logger'
import {
  mergeTerminalProcessIdentities,
  type TerminalProcessIdentity,
} from './terminal-process-identity'
import { shutdownDetachedTerminal } from './terminal-process-shutdown'
import type {
  LiveTerminalProcess,
  RetainedTerminalProcess,
  TerminalRecord,
} from './terminal-records'

const logger = createLogger('terminal-retained-processes')
export const TERMINAL_RESOURCE_DRAIN_MS = 5_000

interface RetainedCleanupEntry {
  readonly target: RetainedTerminalProcess
  treeInFlight: Promise<boolean> | null
  releaseInFlight: Promise<boolean> | null
}

function mergeProcessPids(...groups: readonly (readonly number[])[]) {
  return [...new Set(groups.flat())]
}

/** Own exact PTY instances until tree termination and final native/output drain are both proven. */
export class TerminalRetainedProcesses {
  private readonly entries = new Map<LiveTerminalProcess['pty'], RetainedCleanupEntry>()

  constructor(
    private readonly onRecordInactive: (record: TerminalRecord) => void,
    private readonly shutdownDetachedProcess = shutdownDetachedTerminal,
  ) {}

  readonly registerDetachedProcess = (
    owner: TerminalRecord,
    live: LiveTerminalProcess,
    processPids: readonly number[],
    processIdentities: readonly TerminalProcessIdentity[],
    terminationCommitted: boolean,
    markOwnerInactiveOnRelease: boolean,
  ) => {
    const existing = this.entries.get(live.pty)
    if (existing !== undefined) {
      existing.target.terminationCommitted ||= terminationCommitted
      existing.target.processPids = mergeProcessPids(existing.target.processPids, processPids, [
        live.pid,
      ])
      existing.target.processIdentities = mergeTerminalProcessIdentities(
        existing.target.processIdentities,
        processIdentities,
        live.processIdentity === null ? [] : [live.processIdentity],
      )
      return existing.target
    }
    const target: RetainedTerminalProcess = {
      live,
      owner,
      terminationCommitted,
      markOwnerInactiveOnRelease,
      processPids: mergeProcessPids(processPids, [live.pid]),
      processIdentities: mergeTerminalProcessIdentities(
        processIdentities,
        live.processIdentity === null ? [] : [live.processIdentity],
      ),
    }
    this.entries.set(live.pty, {
      target,
      treeInFlight: null,
      releaseInFlight: null,
    })
    return target
  }

  readonly releaseRetainedProcess = (entry: RetainedCleanupEntry): Promise<boolean> => {
    if (this.entries.get(entry.target.live.pty) !== entry) return Promise.resolve(true)
    if (entry.releaseInFlight !== null) return entry.releaseInFlight
    const { live } = entry.target
    const attempt = live.resourceDrain.whenDrained
      .then((drained) => (drained ? live.exit.whenExited.then(() => true) : false))
      .catch((error: unknown) => {
        logger.error('Retained terminal resource drain failed', {
          pid: live.pid,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      })
      .then((released) => {
        if (!released || this.entries.get(live.pty) !== entry) return released
        this.entries.delete(live.pty)
        entry.target.owner.drainingProcesses.delete(live)
        live.processTreeExit.dispose()
        if (live.exit.exitCode !== null) live.exit.dispose()
        if (entry.target.markOwnerInactiveOnRelease) this.onRecordInactive(entry.target.owner)
        return true
      })
      .finally(() => {
        if (entry.releaseInFlight === attempt) entry.releaseInFlight = null
      })
    entry.releaseInFlight = attempt
    return attempt
  }

  readonly shutdownRetainedProcess = (target: RetainedTerminalProcess): Promise<boolean> => {
    const entry = this.entries.get(target.live.pty)
    if (entry === undefined) return Promise.resolve(true)
    if (entry.target.terminationCommitted) {
      void this.releaseRetainedProcess(entry)
      return Promise.resolve(true)
    }
    if (entry.treeInFlight !== null) return entry.treeInFlight
    const attempt = this.shutdownDetachedProcess(entry.target)
      .catch((error: unknown) => {
        logger.error('Retained terminal process-tree cleanup failed', {
          pid: entry.target.live.pid,
          owner: entry.target.owner.key,
          error: error instanceof Error ? error.message : String(error),
        })
        return false
      })
      .then((stopped) => {
        if (!stopped || this.entries.get(entry.target.live.pty) !== entry) return stopped
        entry.target.terminationCommitted = true
        void this.releaseRetainedProcess(entry)
        return true
      })
      .finally(() => {
        if (entry.treeInFlight === attempt) entry.treeInFlight = null
      })
    entry.treeInFlight = attempt
    return attempt
  }

  readonly shutdownRetainedProcessTrees = async (owners?: ReadonlySet<TerminalRecord>) => {
    while (true) {
      const pending = [...this.entries.values()].filter(
        (entry) =>
          !entry.target.terminationCommitted &&
          (owners === undefined || owners.has(entry.target.owner)),
      )
      if (pending.length === 0) return true
      const results = await Promise.all(
        pending.map((entry) => this.shutdownRetainedProcess(entry.target)),
      )
      if (results.some((stopped) => !stopped)) return false
      // A spawn/exit microtask may have transferred another exact PTY while
      // the snapshot above was stopping. Repeat until this scope has proof.
    }
  }

  readonly awaitRetainedRelease = (
    entry: RetainedCleanupEntry,
    deadline: number,
  ): Promise<boolean> => {
    const release = this.releaseRetainedProcess(entry)
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.resolve(false)
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), remaining)
    })
    return Promise.race([release, timeout]).finally(() => {
      if (timer !== null) clearTimeout(timer)
    })
  }

  readonly shutdownRetainedProcesses = async (owners?: ReadonlySet<TerminalRecord>) => {
    if (!(await this.shutdownRetainedProcessTrees(owners))) return false
    const deadline = Date.now() + TERMINAL_RESOURCE_DRAIN_MS
    while (true) {
      const pending = [...this.entries.values()].filter(
        (entry) => owners === undefined || owners.has(entry.target.owner),
      )
      if (pending.length === 0) return true
      const results = await Promise.all(
        pending.map((entry) => this.awaitRetainedRelease(entry, deadline)),
      )
      if (results.some((released) => !released)) return false
      // Final node-pty exit callbacks can transfer an already-drained target
      // in the same turn. Repeat until no scoped native ownership remains.
    }
  }

  hasOwner(record: TerminalRecord) {
    return [...this.entries.values()].some((entry) => entry.target.owner === record)
  }

  hasUncommittedOwner(record: TerminalRecord) {
    return [...this.entries.values()].some(
      (entry) => entry.target.owner === record && !entry.target.terminationCommitted,
    )
  }
}
