import { SessionId } from '@shared/types/brand'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionSelfArchiveState } from '../../ports/session-organization-repository'
import { cancelAllSessionRuns, reserveActiveSessionRun } from '../active-session-runs'
import { liveCallerRunOfSession, selfArchiveSkipReason } from '../session-self-archive'

const idle: SessionSelfArchiveState = {
  archived: false,
  activeRunId: null,
  queuedFollowUpCount: 0,
  runStatus: 'completed',
  laterRunCount: 0,
  pendingWorkerUpdateCount: 0,
  workingDelegationCount: 0,
  pinned: false,
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
    const live = { pending: true, sessionBusy: false }
    expect(selfArchiveSkipReason(idle, live)).toBe(undefined)
    expect(selfArchiveSkipReason(idle, { ...live, pending: false })).toBe('withdrawn')
    expect(selfArchiveSkipReason(null, live)).toBe('session-missing')
    expect(selfArchiveSkipReason({ ...idle, archived: true }, live)).toBe('already-archived')
    expect(selfArchiveSkipReason({ ...idle, activeRunId: 'run-next' }, live)).toBe('later-run')
    expect(selfArchiveSkipReason({ ...idle, laterRunCount: 1 }, live)).toBe('later-run')
    expect(selfArchiveSkipReason({ ...idle, queuedFollowUpCount: 1 }, live)).toBe(
      'follow-up-queued',
    )
    expect(selfArchiveSkipReason({ ...idle, pinned: true }, live)).toBe('pinned')
    expect(selfArchiveSkipReason({ ...idle, workingDelegationCount: 1 }, live)).toBe(
      'workers-working',
    )
    expect(selfArchiveSkipReason({ ...idle, pendingWorkerUpdateCount: 2 }, live)).toBe(
      'worker-updates-pending',
    )
    expect(selfArchiveSkipReason(idle, { ...live, sessionBusy: true })).toBe('session-busy')
    expect(selfArchiveSkipReason({ ...idle, runStatus: null }, live)).toBe('run-missing')
    expect(selfArchiveSkipReason({ ...idle, runStatus: 'interrupted' }, live)).toBe(
      'run-not-completed',
    )
  })
})
