import { describe, expect, it } from 'vitest'
import {
  isScheduledTaskRunKey,
  scheduledTaskRunKey,
  scheduledTaskRunWork,
} from '../scheduled-task-run-key'

describe('scheduledTaskRunKey', () => {
  it('names a Scheduled task run’s request, and only such a request', () => {
    expect(isScheduledTaskRunKey(scheduledTaskRunKey('run-1', 'person'))).toBe(true)
    expect(isScheduledTaskRunKey('hive-wake:session:1')).toBe(false)
    expect(isScheduledTaskRunKey(undefined)).toBe(false)
  })

  it('marks whose work the run is, so the mark outlives the task', () => {
    expect(scheduledTaskRunKey('run-1', 'person')).toBe('scheduled-task-run:person:run-1')
    expect(scheduledTaskRunKey('run-1', 'agents')).toBe('scheduled-task-run:agents:run-1')
    expect(scheduledTaskRunWork(scheduledTaskRunKey('run-1', 'person'))).toBe('person')
    expect(scheduledTaskRunWork(scheduledTaskRunKey('run-1', 'agents'))).toBe('agents')
    // A key from before the mark, and any other key, carries none.
    expect(scheduledTaskRunWork('scheduled-task-run:run-1')).toBeUndefined()
    expect(scheduledTaskRunWork('hive-wake:session:1')).toBeUndefined()
  })
})
