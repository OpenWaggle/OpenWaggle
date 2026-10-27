import { describe, expect, it } from 'vitest'
import {
  doneAutoPauseMessage,
  heartbeatHasStopCondition,
  idleAutoPauseMessage,
  inferHeartbeatRunOutcome,
} from '../heartbeat-rules'

describe('heartbeatHasStopCondition', () => {
  it('accepts a Stop condition, an end, a run limit, or an explicit indefinite', () => {
    expect(heartbeatHasStopCondition({ stopWhen: 'CI is green' })).toBe(true)
    expect(heartbeatHasStopCondition({ endsAt: 1 })).toBe(true)
    expect(heartbeatHasStopCondition({ maxRuns: 3 })).toBe(true)
    expect(heartbeatHasStopCondition({ indefinite: true })).toBe(true)
  })

  it('refuses an open-ended Heartbeat, a blank Stop condition included', () => {
    expect(heartbeatHasStopCondition({})).toBe(false)
    expect(heartbeatHasStopCondition({ stopWhen: '   ', indefinite: false })).toBe(false)
    expect(heartbeatHasStopCondition({ stopWhen: null, endsAt: null, maxRuns: null })).toBe(false)
  })
})

describe('inferHeartbeatRunOutcome', () => {
  it('is idle when the Run used no tool or only read-only queries', () => {
    expect(inferHeartbeatRunOutcome([])).toBe('idle')
    expect(
      inferHeartbeatRunOutcome([
        { name: 'read', args: { path: 'a.ts' } },
        { name: 'hive', args: { action: 'status' } },
        { name: 'hive', args: { action: 'schedule_outcome' } },
        { name: 'project_actions', args: { action: 'output' } },
      ]),
    ).toBe('idle')
  })

  it('is acted once the Run used any other tool, a shell command included', () => {
    expect(inferHeartbeatRunOutcome([{ name: 'bash', args: { command: 'gh pr view' } }])).toBe(
      'acted',
    )
    expect(
      inferHeartbeatRunOutcome([
        { name: 'read', args: {} },
        { name: 'hive', args: { action: 'follow_up' } },
      ]),
    ).toBe('acted')
    expect(inferHeartbeatRunOutcome([{ name: 'hive', args: {} }])).toBe('acted')
  })
})

describe('Auto-pause messages', () => {
  it('names the idle count and the agent note', () => {
    expect(idleAutoPauseMessage(3)).toBe('auto-paused: 3 idle runs')
    expect(idleAutoPauseMessage(1)).toBe('auto-paused: 1 idle run')
    expect(doneAutoPauseMessage(undefined)).toBe('auto-paused: done')
    expect(doneAutoPauseMessage(' PR merged ')).toBe('auto-paused: done — PR merged')
  })
})
