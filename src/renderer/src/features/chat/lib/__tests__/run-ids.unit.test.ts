import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { createStartedRuns, settlingRunId } from '../run-ids'

const SESSION = SessionId('session-1')

describe('createStartedRuns', () => {
  it('takes the settlement of the classic Run behind a requested Waggle for the last Run', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    expect(runs.start(SESSION, 'waggle-of-run-1')).toBe(false)
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
  })

  it('settles the Session for a Run that never started', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('takes a settlement of an earlier started Run for an earlier one, once', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    expect(runs.start(SESSION, 'run-2')).toBe(true)
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('takes an unknown settlement for a Run seen only under an unnamed start before the next', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'remote-snapshot:session-1')
    runs.start(SESSION, 'run-4')
    expect(runs.settle(SESSION, 'waggle-3')).toBe(true)
    expect(runs.settle(SESSION, 'run-4')).toBe(false)
  })

  it('remembers a Run restored at a reload that starts again under its own id', () => {
    const runs = createStartedRuns()
    expect(runs.start(SESSION, 'run-1', 'run-1')).toBe(false)
    expect(runs.start(SESSION, 'run-2')).toBe(true)
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('names a Run started unnamed by its end, so the next start is another Run', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'remote-snapshot:session-1')
    runs.end(SESSION, 'run-1')
    expect(runs.start(SESSION, 'run-2')).toBe(true)
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
  })

  it('settles a Run the bridge re-announced after it started named, at its own settlement', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-w')
    runs.start(SESSION, 'run-x')
    expect(runs.settle(SESSION, 'run-w')).toBe(true)
    // The bridge re-announces X after a reconnect found the replica without its buffer.
    runs.start(SESSION, 'remote-snapshot:session-1')
    runs.end(SESSION, 'run-x')
    expect(runs.settle(SESSION, 'run-x')).toBe(false)
  })

  it('names the classic Run a requested Waggle settles as', () => {
    expect(settlingRunId('waggle-of-run-1')).toBe('run-1')
    expect(settlingRunId('waggle-3')).toBe('waggle-3')
  })
})
