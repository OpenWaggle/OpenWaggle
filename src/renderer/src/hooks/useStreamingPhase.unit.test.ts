import type { OrchestrationRunRecord } from '@shared/types/orchestration'
import { describe, expect, it } from 'vitest'
import { _derivePhaseLabel as derivePhaseLabel, formatElapsed } from './useStreamingPhase'

function makeRun(
  overrides: Partial<OrchestrationRunRecord> & { status: OrchestrationRunRecord['status'] },
): OrchestrationRunRecord {
  return {
    runId: 'run-1' as OrchestrationRunRecord['runId'],
    conversationId: 'conv-1' as OrchestrationRunRecord['conversationId'],
    startedAt: new Date().toISOString(),
    taskOrder: [],
    tasks: {},
    outputs: {},
    fallbackUsed: false,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('derivePhaseLabel', () => {
  it('returns null when not loading', () => {
    expect(derivePhaseLabel(false, [], false)).toBeNull()
  })

  it('returns "Thinking" when loading with no orchestration and no content', () => {
    expect(derivePhaseLabel(true, [], false)).toBe('Thinking')
  })

  it('returns "Writing" when loading with no orchestration but has streaming content', () => {
    expect(derivePhaseLabel(true, [], true)).toBe('Writing')
  })

  it('returns "Planning" when run is running and all tasks are queued', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'analysis',
          status: 'queued',
          dependsOn: [],
        },
        t2: {
          id: 't2' as never,
          kind: 'analysis',
          status: 'queued',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Planning')
  })

  it('returns "Researching" when a running task has kind "analysis"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'analysis',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Researching')
  })

  it('returns "Debugging" when a running task has kind "debugging"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'debugging',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Debugging')
  })

  it('returns "Refactoring" when a running task has kind "refactoring"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'refactoring',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Refactoring')
  })

  it('returns "Testing" when a running task has kind "testing"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'testing',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Testing')
  })

  it('returns "Documenting" when a running task has kind "documentation"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'documentation',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Documenting')
  })

  it('returns "Editing" when a running task has kind "repo-edit"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'repo-edit',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Editing')
  })

  it('returns "Executing" when a running task has kind "general"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'general',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Executing')
  })

  it('picks highest priority kind when multiple tasks are running', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'analysis',
          status: 'running',
          dependsOn: [],
        },
        t2: {
          id: 't2' as never,
          kind: 'debugging',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    // debugging has higher priority than analysis
    expect(derivePhaseLabel(true, [run], false)).toBe('Debugging')
  })

  it('picks repo-edit over all other kinds', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'debugging',
          status: 'running',
          dependsOn: [],
        },
        t2: {
          id: 't2' as never,
          kind: 'repo-edit',
          status: 'running',
          dependsOn: [],
        },
        t3: {
          id: 't3' as never,
          kind: 'analysis',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Editing')
  })

  it('returns "Executing" for retrying task with kind "general"', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'general',
          status: 'retrying',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Executing')
  })

  it('returns "Reviewing" when run is running and all tasks are terminal', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'analysis',
          status: 'completed',
          dependsOn: [],
        },
        t2: {
          id: 't2' as never,
          kind: 'debugging',
          status: 'failed',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Reviewing')
  })

  it('returns "Writing" when run is completed but still loading', () => {
    const run = makeRun({ status: 'completed' })
    expect(derivePhaseLabel(true, [run], false)).toBe('Writing')
  })

  it('returns "Writing" when run is failed but still loading', () => {
    const run = makeRun({ status: 'failed' })
    expect(derivePhaseLabel(true, [run], false)).toBe('Writing')
  })

  it('returns null when not loading even with orchestration present', () => {
    const run = makeRun({ status: 'running', tasks: {} })
    expect(derivePhaseLabel(false, [run], true)).toBeNull()
  })

  it('returns "Executing" for unknown kind', () => {
    const run = makeRun({
      status: 'running',
      tasks: {
        t1: {
          id: 't1' as never,
          kind: 'unknown-kind',
          status: 'running',
          dependsOn: [],
        },
      },
    })
    expect(derivePhaseLabel(true, [run], false)).toBe('Executing')
  })
})

describe('formatElapsed', () => {
  it('formats seconds under 60', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(3_000)).toBe('3s')
    expect(formatElapsed(11_500)).toBe('11s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('formats minutes and seconds at 60+', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s')
    expect(formatElapsed(83_000)).toBe('1m 23s')
    expect(formatElapsed(125_000)).toBe('2m 5s')
  })
})
