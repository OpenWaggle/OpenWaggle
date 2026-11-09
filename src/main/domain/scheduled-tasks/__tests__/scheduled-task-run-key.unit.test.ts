import { describe, expect, it } from 'vitest'
import { isAgentScheduledRunKey, scheduledTaskRunKey } from '../scheduled-task-run-key'

describe('Scheduled task run keys', () => {
  it('marks only a Session agent’s task firings as the agent’s work', () => {
    expect(isAgentScheduledRunKey(scheduledTaskRunKey('run-1', 'session-agent'))).toBe(true)
    expect(isAgentScheduledRunKey(scheduledTaskRunKey('run-1', 'local-user'))).toBe(false)
    expect(isAgentScheduledRunKey(scheduledTaskRunKey('run-1', 'profile'))).toBe(false)
    expect(isAgentScheduledRunKey(undefined)).toBe(false)
  })

  it('keeps the key every firing had before', () => {
    expect(scheduledTaskRunKey('run-1', 'local-user')).toBe('scheduled-task-run:run-1')
  })
})
