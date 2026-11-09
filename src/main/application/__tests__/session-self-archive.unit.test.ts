import { SessionId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import { cancelAllSessionRuns, reserveActiveSessionRun } from '../active-session-runs'
import { liveCallerRunOfSession, selfArchiveSkipReason } from '../session-self-archive'

const idle = {
  archived: false,
  activeRunId: null,
  queuedFollowUpCount: 0,
  runStatus: 'completed',
  laterRunCount: 0,
}

describe('a Session archiving itself', () => {
  afterEach(() => cancelAllSessionRuns())

  it('finds the caller Run only for the agent of a live Run of the target Session', () => {
    const sessionId = SessionId('session-self')
    const run = reserveActiveSessionRun(sessionId, 'run-live')

    expect(liveCallerRunOfSession('session-agent:session-self:run-live', sessionId)).toBe(
      'run-live',
    )
    // A requested Waggle's agent acts inside the classic Run it names.
    expect(liveCallerRunOfSession('session-agent:session-self:waggle-of-run-live', sessionId)).toBe(
      'run-live',
    )
    expect(liveCallerRunOfSession('session-agent:session-self:run-ended', sessionId)).toBe(
      undefined,
    )
    expect(liveCallerRunOfSession('session-agent:other:run-live', sessionId)).toBe(undefined)
    expect(liveCallerRunOfSession('gui:local-user', sessionId)).toBe(undefined)
    run.release()
    expect(liveCallerRunOfSession('session-agent:session-self:run-live', sessionId)).toBe(undefined)
  })

  it('archives only when nothing changed since the Run asked', () => {
    expect(selfArchiveSkipReason(idle)).toBe(undefined)
    expect(selfArchiveSkipReason({ ...idle, runStatus: null })).toBe(undefined)
    expect(selfArchiveSkipReason(null)).toBe('session-missing')
    expect(selfArchiveSkipReason({ ...idle, archived: true })).toBe('already-archived')
    expect(selfArchiveSkipReason({ ...idle, activeRunId: 'run-next' })).toBe('later-run')
    expect(selfArchiveSkipReason({ ...idle, laterRunCount: 1 })).toBe('later-run')
    expect(selfArchiveSkipReason({ ...idle, queuedFollowUpCount: 1 })).toBe('follow-up-queued')
    expect(selfArchiveSkipReason({ ...idle, runStatus: 'interrupted' })).toBe('run-not-completed')
  })
})
