import { describe, expect, it } from 'vitest'
import { parsePlannerDecision } from '../planner'

describe('parsePlannerDecision', () => {
  it('parses direct response payload', () => {
    const decision = parsePlannerDecision({ direct: true, response: 'Quick answer.' })
    expect(decision).toEqual({ kind: 'direct', response: 'Quick answer.' })
  })

  it('parses task payload with ack text', () => {
    const decision = parsePlannerDecision({
      ackText: 'Working on it',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do it' }],
    })
    expect(decision.kind).toBe('tasks')
    if (decision.kind === 'tasks') {
      expect(decision.ackText).toBe('Working on it')
      expect(decision.tasks).toHaveLength(1)
    }
  })

  it('falls back to empty task plan on invalid payload', () => {
    const decision = parsePlannerDecision('not-json')
    expect(decision).toEqual({ kind: 'tasks', ackText: null, tasks: [] })
  })
})
