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

  it('takes a late settlement of the Run before one whose start was lost for an earlier one', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    runs.end(SESSION, 'run-1')
    runs.noteUnannounced(SESSION)
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
    runs.end(SESSION, 'run-2')
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('settles a Run known only from what it streamed under its real id', () => {
    const runs = createStartedRuns()
    runs.noteUnannounced(SESSION)
    runs.noteUnannounced(SESSION)
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
    expect(runs.start(SESSION, 'run-2')).toBe(false)
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('names a Run whose start was lost by its end, even when it is the Run before continuing', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    runs.end(SESSION, 'run-1')
    // Pi continues run-1 and its start is lost; its end names it.
    runs.noteUnannounced(SESSION)
    runs.end(SESSION, 'run-1')
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
  })

  it('takes a late start of a Run that already streamed for that Run, another than the one before', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    runs.end(SESSION, 'run-1')
    runs.noteUnannounced(SESSION)
    expect(runs.start(SESSION, 'run-2')).toBe(true)
    expect(runs.start(SESSION, 'run-2')).toBe(false)
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  // An auto-retry or a requested Waggle's next turn starts again with no end in between.
  it('lists the Run before once when the Run whose start was lost starts again as it', () => {
    const runs = createStartedRuns()
    runs.start(SESSION, 'run-1')
    runs.end(SESSION, 'run-1')
    runs.noteUnannounced(SESSION)
    expect(runs.start(SESSION, 'waggle-of-run-1')).toBe(false)
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
  })

  it('lists a Run whose start was lost after the Run restored at a reload', () => {
    const runs = createStartedRuns()
    runs.noteUnannounced(SESSION, 'run-1')
    expect(runs.settle(SESSION, 'run-1')).toBe(true)
    runs.end(SESSION, 'run-2')
    expect(runs.settle(SESSION, 'run-2')).toBe(false)
  })

  it('names a Run whose start was lost from the buffer, telling the Run before from another', () => {
    const runs = createStartedRuns()
    runs.noteUnannounced(SESSION)
    expect(runs.name(SESSION, 'run-1')).toBe(false)
    expect(runs.name(SESSION, 'run-1')).toBeUndefined()
    runs.end(SESSION, 'run-1')
    runs.noteUnannounced(SESSION)
    expect(runs.name(SESSION, 'run-1')).toBe(false)
    expect(runs.settle(SESSION, 'run-1')).toBe(false)
    runs.start(SESSION, 'run-2')
    runs.end(SESSION, 'run-2')
    runs.noteUnannounced(SESSION)
    expect(runs.name(SESSION, 'run-3')).toBe(true)
    expect(runs.settle(SESSION, 'run-2')).toBe(true)
    expect(runs.settle(SESSION, 'run-3')).toBe(false)
  })

  it('names the classic Run a requested Waggle settles as', () => {
    expect(settlingRunId('waggle-of-run-1')).toBe('run-1')
    expect(settlingRunId('waggle-3')).toBe('waggle-3')
  })
})
