import { describe, expect, it } from 'vitest'
import { TEST_TASK } from '../../components/__tests__/native-action-fixtures'
import { actionTaskUnavailable } from '../action-task-availability'

describe('saved task availability', () => {
  it('distinguishes the same task name in different workspace packages and runner environments', () => {
    const invocation = { type: 'task', task: TEST_TASK.reference } as const
    expect(
      actionTaskUnavailable(invocation, { tasks: [TEST_TASK], diagnostics: [] }),
    ).toBeUndefined()
    expect(
      actionTaskUnavailable(invocation, {
        tasks: [{ ...TEST_TASK, reference: { ...TEST_TASK.reference, directory: 'other' } }],
        diagnostics: [],
      }),
    ).toContain('unavailable')
    expect(
      actionTaskUnavailable(invocation, {
        tasks: [{ ...TEST_TASK, unavailableReason: 'Runner missing' }],
        diagnostics: [],
      }),
    ).toBe('Runner missing')
    expect(actionTaskUnavailable(invocation, undefined)).toBeUndefined()
  })
})
