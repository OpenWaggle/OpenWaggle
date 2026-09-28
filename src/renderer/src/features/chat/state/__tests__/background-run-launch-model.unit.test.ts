import { describe, expect, it } from 'vitest'
import { interruptedFirstSendLaunch } from '../background-run-launch-model'

const running = {
  status: 'running' as const,
  stage: 'connecting-tools' as const,
  startedAt: 1,
  updatedAt: 1,
  details: [],
}

describe('interruptedFirstSendLaunch', () => {
  it('offers working locally only for an interrupted worktree launch', () => {
    expect(
      interruptedFirstSendLaunch({ ...running, environment: 'worktree' }).errorMessage,
    ).toMatch(/work locally/)
    expect(interruptedFirstSendLaunch(undefined).errorMessage).toMatch(/work locally/)
  })

  it('describes an interrupted local launch without a worktree or Work locally', () => {
    const launch = interruptedFirstSendLaunch({ ...running, environment: 'local' })
    expect(launch.status).toBe('failed')
    expect(launch.environment).toBe('local')
    expect(launch.errorMessage).not.toMatch(/worktree|work locally/i)
  })
})
