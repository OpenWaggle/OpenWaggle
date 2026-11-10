import { describe, expect, it } from 'vitest'
import { isAgentWorkRun, queueHoldsPersonFollowUp } from '../person-started-run'

const AGENT = 'session-agent:queen:run-queen'
const AGENT_TASK_KEY = 'scheduled-task-run:session-agent:run-1'

describe('isAgentWorkRun', () => {
  it.each([
    ['an agent', { callerId: AGENT }, true],
    ['a client profile', { callerId: 'profile:ci' }, true],
    [
      'an agent-written task firing as the person',
      { callerId: 'local-user', idempotencyKey: AGENT_TASK_KEY },
      true,
    ],
    ['the person from the app', { callerId: 'gui:local-user' }, false],
    ['the person from the CLI', { callerId: 'local-user:machine' }, false],
    [
      'the person’s own task firing',
      { callerId: 'local-user', idempotencyKey: 'scheduled-task-run:run-1' },
      false,
    ],
    // The Host's wake is judged by the Session it wakes, not counted as an agent's Run there.
    ['the Host waking a Queen', { callerId: AGENT, hiveWake: true as const }, false],
  ])('is %s', (_, intent, expected) => {
    expect(isAgentWorkRun(intent)).toBe(expected)
  })
})

describe('queueHoldsPersonFollowUp', () => {
  const person = { intent: { callerId: 'gui:local-user' } }
  const agent = { intent: { callerId: AGENT } }
  const agentTask = { intent: { callerId: 'local-user', idempotencyKey: AGENT_TASK_KEY } }

  it('holds the person’s Follow-up in a running queue', () => {
    expect(queueHoldsPersonFollowUp({ state: 'running', items: [agent, person] })).toBe(true)
  })

  it('does not take an agent’s work for the person’s', () => {
    expect(queueHoldsPersonFollowUp({ state: 'running', items: [agent, agentTask] })).toBe(false)
    expect(queueHoldsPersonFollowUp({ state: 'running', items: [] })).toBe(false)
  })

  // A failed Run's retry does not go on to the person's Follow-up: nothing is held for it.
  it('does not hold for a paused queue', () => {
    expect(queueHoldsPersonFollowUp({ state: 'paused', items: [person] })).toBe(false)
  })
})
