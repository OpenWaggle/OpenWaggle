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
  return {
    /**
     * A Run started; `true` when it is another Run than the one started last (not a retry).
     * `restoredRunId`: the Run in progress when the renderer started, whose start it never saw.
     */
    start(sessionId: SessionId, runId: string, restoredRunId?: string) {
      const restored = restoredRunId === undefined ? [] : [settlingRunId(restoredRunId)]
      const started = bySession.get(sessionId) ?? restored
      const settling = settlingRunId(runId)
      const last = started.at(-1)
      // The start of the Run already streaming, late (the bridge announcing it after a resync).
      if (isUnannouncedRun(last)) {
        bySession.set(sessionId, [...started.slice(0, -1), settling])
        return false
      }
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
     * Runs listed, so a late settlement of the one before it does not settle the Session; its end
     * names it, as a start would have. `restoredRunId`: as for `start`. `true`, as for `start`,
     * when a Run is listed before it: the Host settled that one, as at another Run's start.
     */
    noteUnannounced(sessionId: SessionId, restoredRunId?: string) {
      const restored = restoredRunId === undefined ? [] : [settlingRunId(restoredRunId)]
      const started = bySession.get(sessionId) ?? restored
      const last = started.at(-1)
      if (isUnannouncedRun(last)) return false
      bySession.set(sessionId, [...started, UNANNOUNCED_RUN])
      return last !== undefined && !isUnnamedRunStart(last)
    },
    /**
     * A Run settled (`undefined`: a settlement naming none, which settles the Session): whether it
     * is an earlier one than the Run started last. Forgets it and the Runs started before it.
     */
    settle(sessionId: SessionId, runId: string | undefined, restoredRunId?: string) {
      const restored = restoredRunId === undefined ? [] : [settlingRunId(restoredRunId)]
      const started = bySession.get(sessionId) ?? restored
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
      return later.some((laterRunId) => !isUnnamedRunStart(laterRunId))
    },
  }
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
