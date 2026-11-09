import { describe, expect, it } from 'vitest'
import { isAgentScheduledRunKey, scheduledTaskRunKey } from '../scheduled-task-run-key'

describe('Scheduled task run keys', () => {
  it('marks only the firings of an agent’s work as the agent’s', () => {
    expect(isAgentScheduledRunKey(scheduledTaskRunKey('run-1', true))).toBe(true)
    expect(isAgentScheduledRunKey(scheduledTaskRunKey('run-1', false))).toBe(false)
    expect(isAgentScheduledRunKey(undefined)).toBe(false)
  })

  it('keeps the key every firing of the person’s work had before', () => {
    expect(scheduledTaskRunKey('run-1', false)).toBe('scheduled-task-run:run-1')
  })
})
