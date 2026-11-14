import type { SessionId } from '@shared/types/brand'

/*
 * Run ids as the renderer meets them on `agent_start` and on a Run's settlement.
 */

/**
 * The prefix of the Run id an agent-requested Waggle streams under (`requestedWaggleRunId` in the
 * main process): it has no Run of its own, and settles as the classic Run it names.
 */
const REQUESTED_WAGGLE_RUN_PREFIX = 'waggle-of-'

/** The prefix of the start the Host bridge synthesizes for a Run it found in progress. */
const REMOTE_SNAPSHOT_RUN_PREFIX = 'remote-snapshot:'

/**
 * What the renderer lists for a Run it learned of only from what it streamed: its `agent_start`
 * was lost (`noteUnannounced`). It is another Run than those listed before it until its end names
 * it, since Pi only streams after a start.
 */
const UNANNOUNCED_RUN = 'unannounced:'

function isUnannouncedRun(runId: string | undefined) {
  return runId === UNANNOUNCED_RUN
}

/** The Run a Run id settles as: the classic Run behind an agent-requested Waggle, or itself. */
export function settlingRunId(runId: string) {
  return runId.startsWith(REQUESTED_WAGGLE_RUN_PREFIX)
    ? runId.slice(REQUESTED_WAGGLE_RUN_PREFIX.length)
    : runId
}

/** Whether a start names no Run: the bridge's start for a Run it found in progress. */
export function isUnnamedRunStart(runId: string) {
  return runId.startsWith(REMOTE_SNAPSHOT_RUN_PREFIX)
}

/**
 * The Runs each Session started and has not settled yet, in start order, by the Run they settle as.
 * A settlement names one of them; one naming an earlier Run than the last started arrives after the
 * next Run started (a Run restored in progress at the renderer's start counts as started), while
 * one naming a Run that never started (it failed before Pi did) or the last one settles it.
 */
export function createStartedRuns() {
  const bySession = new Map<SessionId, string[]>()
  // Runs known first from what they streamed, by Session: their start was lost.
  const unannounced = new Map<SessionId, Set<string>>()
  const named = (sessionId: SessionId, started: readonly string[], settling: string) => {
    const another = nameUnannounced(bySession, sessionId, started, settling)
    if (another) unannounced.set(sessionId, (unannounced.get(sessionId) ?? new Set()).add(settling))
    return another
  }
  // `restoredRunId`: the Run in progress when the renderer started, whose start it never saw.
  const listed = (sessionId: SessionId, restoredRunId: string | undefined) =>
    bySession.get(sessionId) ?? (restoredRunId === undefined ? [] : [settlingRunId(restoredRunId)])
  return {
    /**
     * A Run started; `true` when it is another Run than the one started last (not a retry).
     * `restoredRunId`: the Run in progress when the renderer started, whose start it never saw.
     */
    start(sessionId: SessionId, runId: string, restoredRunId?: string) {
      const started = listed(sessionId, restoredRunId)
      const settling = settlingRunId(runId)
      const last = started.at(-1)
      // The start of the Run already streaming, late (the bridge announcing it after a resync).
      if (isUnannouncedRun(last)) return named(sessionId, started, settling)
      if (last === settling) {
        // The restored Run starting again (an auto-retry, Pi continuing it): still remembered.
        if (!bySession.has(sessionId)) bySession.set(sessionId, started)
        return false
      }
      bySession.set(sessionId, [...started, settling])
      return last !== undefined && !isUnnamedRunStart(runId) && !isUnnamedRunStart(last)
    },
    /**
     * A Run ended: the last one started unnamed (the bridge's start) is named by its end, so the
     * next start tells another Run from Pi continuing this one. A Run the bridge re-announced
     * after its named start is already listed, so it is not listed twice: a second entry would make
     * its own settlement look like an earlier Run's and leave the Session shown as running.
     */
    end(sessionId: SessionId, runId: string | undefined) {
      const started = bySession.get(sessionId)
      const last = started?.at(-1) ?? ''
      if (runId !== undefined && started && (isUnnamedRunStart(last) || isUnannouncedRun(last))) {
        const named = settlingRunId(runId)
        const rest = started.slice(0, -1)
        bySession.set(sessionId, rest.at(-1) === named ? rest : [...rest, named])
      }
    },
    /**
     * A Run streams in a Session the renderer holds as idle: its start was lost. It follows the
     * Runs listed, so a late settlement of the one before it does not settle the Session; its end,
     * a late start or `name` names it. `restoredRunId`: as for `start`.
     */
    noteUnannounced(sessionId: SessionId, restoredRunId?: string) {
      const started = listed(sessionId, restoredRunId)
      if (isUnannouncedRun(started.at(-1))) return
      bySession.set(sessionId, [...started, UNANNOUNCED_RUN])
    },
    /**
     * The Run the Host's buffer names for a Run listed as unannounced: `true` when it is another
     * Run than the one listed before it, as `start` tells; `undefined` when the Run listed last is
     * no longer unannounced (its end or a start named it first).
     */
    name(sessionId: SessionId, runId: string) {
      const started = bySession.get(sessionId)
      if (!started || !isUnannouncedRun(started.at(-1))) return undefined
      return named(sessionId, started, settlingRunId(runId))
    },
    /**
     * Whether the Run after `runId` is one known first from what it streamed: the Session's render
     * snapshot then holds both Runs' rows with no start between them, so a late settlement of
     * `runId` must not settle the snapshot whole (the rows before were set apart when it streamed).
     */
    unannouncedAfter(sessionId: SessionId, runId: string | undefined) {
      const started = bySession.get(sessionId) ?? []
      if (runId === undefined) return false
      const index = started.indexOf(settlingRunId(runId))
      const next = index < 0 ? undefined : started[index + 1]
      if (next === undefined) return false
      return isUnannouncedRun(next) || unannounced.get(sessionId)?.has(next) === true
    },
    /**
     * A Run settled (`undefined`: a settlement naming none, which settles the Session): whether it
     * is an earlier one than the Run started last. Forgets it and the Runs started before it.
     */
    settle(sessionId: SessionId, runId: string | undefined, restoredRunId?: string) {
      const started = listed(sessionId, restoredRunId)
      if (runId === undefined) {
        bySession.delete(sessionId)
        return false
      }
      const named = started.indexOf(settlingRunId(runId))
      // A Run the renderer only saw start unnamed (its start was lost in a stall) settles under
      // its real id; a Run that never started (it failed before Pi did) settles the Session.
      // A Run listed only as unannounced settles under its real id too.
      const unnamed = named >= 0 ? named : unnamedStartBeforeNamed(started)
      const index = unnamed < 0 && isUnannouncedRun(started.at(-1)) ? started.length - 1 : unnamed
      if (index < 0) return false
      const later = started.slice(index + 1)
      if (later.length === 0) bySession.delete(sessionId)
      else bySession.set(sessionId, later)
      const settled = unannounced.get(sessionId)
      for (const settledRunId of started.slice(0, index + 1)) settled?.delete(settledRunId)
      return later.some((laterRunId) => !isUnnamedRunStart(laterRunId))
    },
  }
}

/**
 * Names the Run listed last as unannounced. When it is the Run listed before it (Pi continuing a
 * Run, a retry, a requested Waggle), that one is listed once: listed twice, its settlement would
 * look like an earlier Run's and leave the Session running. `true` when it is another Run.
 */
function nameUnannounced(
  bySession: Map<SessionId, string[]>,
  sessionId: SessionId,
  started: readonly string[],
  settling: string,
) {
  const rest = started.slice(0, -1)
  const before = rest.at(-1)
  bySession.set(sessionId, before === settling ? rest : [...rest, settling])
  return before !== undefined && before !== settling && !isUnnamedRunStart(before)
}

/** The last unnamed start some named start follows: an earlier Run, known by no id. */
function unnamedStartBeforeNamed(started: readonly string[]) {
  const lastNamed = started.reduce(
    (last, runId, index) => (isUnnamedRunStart(runId) ? last : index),
    -1,
  )
  return started.reduce(
    (found, runId, index) => (index < lastNamed && isUnnamedRunStart(runId) ? index : found),
    -1,
  )
}
