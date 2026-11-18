import { describe, expect, it, vi } from 'vitest'
import {
  ProfileCredentialGenerationBudget,
  ProfileCredentialGenerationRateLimitError,
} from '../profile-credential-generation-budget'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

describe('profile credential generation budget', () => {
  it('bounds active and pending verifier work', async () => {
    const budget = new ProfileCredentialGenerationBudget({
      maxConcurrent: 2,
      maxPending: 1,
      maxNamedProfileStartsPerWindow: 20,
    })
    const first = deferred<string>()
    const second = deferred<string>()
    const third = deferred<string>()
    let active = 0
    let peak = 0
    const task = (operationKey: string, gate: ReturnType<typeof deferred<string>>) =>
      budget.run({
        callerId: 'profile:worker',
        operationKey,
        task: async () => {
          active += 1
          peak = Math.max(peak, active)
          const value = await gate.promise
          active -= 1
          return value
        },
      })

    const operations = [task('one', first), task('two', second), task('three', third)]
    await expect(task('four', deferred<string>())).rejects.toBeInstanceOf(
      ProfileCredentialGenerationRateLimitError,
    )
    expect(peak).toBe(2)

    first.resolve('one')
    second.resolve('two')
    await Promise.resolve()
    await Promise.resolve()
    third.resolve('three')
    await expect(Promise.all(operations)).resolves.toEqual(['one', 'two', 'three'])
    expect(peak).toBe(2)
  })

  it('deduplicates retries and rate limits unique named-profile rotations', async () => {
    let now = 1_000
    const budget = new ProfileCredentialGenerationBudget({
      maxConcurrent: 2,
      maxPending: 2,
      maxNamedProfileStartsPerWindow: 2,
      windowMs: 100,
      now: () => now,
    })
    const task = vi.fn(async () => 'verifier')
    const first = budget.run({ callerId: 'profile:worker', operationKey: 'one', task })
    const retry = budget.run({ callerId: 'profile:worker', operationKey: 'one', task })
    expect(retry).toBe(first)
    await expect(first).resolves.toBe('verifier')
    await expect(
      budget.run({ callerId: 'profile:worker', operationKey: 'two', task }),
    ).resolves.toBe('verifier')
    await expect(
      budget.run({ callerId: 'profile:worker', operationKey: 'three', task }),
    ).rejects.toBeInstanceOf(ProfileCredentialGenerationRateLimitError)
    expect(task).toHaveBeenCalledTimes(2)

    now += 100
    await expect(
      budget.run({ callerId: 'profile:worker', operationKey: 'four', task }),
    ).resolves.toBe('verifier')
  })
})
