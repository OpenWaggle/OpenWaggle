import { describe, expect, it } from 'vitest'
import {
  isAgentsScheduledTaskRunKey,
  isScheduledTaskRunKey,
  scheduledTaskRunKey,
} from '../scheduled-task-run-key'

describe('scheduledTaskRunKey', () => {
  it('names a Scheduled task run’s request, and only such a request', () => {
    expect(scheduledTaskRunKey('run-1')).toBe('scheduled-task-run:run-1')
    expect(isScheduledTaskRunKey(scheduledTaskRunKey('run-1'))).toBe(true)
    expect(isScheduledTaskRunKey('hive-wake:session:1')).toBe(false)
    expect(isScheduledTaskRunKey(undefined)).toBe(false)
  })

  it('marks the run of a task an agent or profile made, so the mark outlives the task', () => {
    expect(scheduledTaskRunKey('run-1', 'agents')).toBe('scheduled-task-run:agents:run-1')
    expect(isScheduledTaskRunKey(scheduledTaskRunKey('run-1', 'agents'))).toBe(true)
    expect(isAgentsScheduledTaskRunKey(scheduledTaskRunKey('run-1', 'agents'))).toBe(true)
    expect(isAgentsScheduledTaskRunKey(scheduledTaskRunKey('run-1'))).toBe(false)
  })
})
