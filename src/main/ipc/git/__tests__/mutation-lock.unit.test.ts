import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { withGitMutationLock } from '../mutation-lock'

describe('withGitMutationLock', () => {
  it('serializes mutations of the same canonical working path', async () => {
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const workingPath = process.cwd()

    const first = Effect.runPromise(
      withGitMutationLock(
        workingPath,
        Effect.promise(async () => {
          events.push('first:start')
          firstStarted?.()
          await firstGate
          events.push('first:end')
        }),
      ),
    )
    await started
    const second = Effect.runPromise(
      withGitMutationLock(
        workingPath,
        Effect.sync(() => {
          events.push('second')
        }),
      ),
    )

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second'])
  })

  it('releases the working-path lock when a mutation fails', async () => {
    const workingPath = process.cwd()
    await expect(
      Effect.runPromise(
        withGitMutationLock(workingPath, Effect.fail(new Error('mutation failed'))),
      ),
    ).rejects.toThrow('mutation failed')

    await expect(
      Effect.runPromise(withGitMutationLock(workingPath, Effect.succeed('recovered'))),
    ).resolves.toBe('recovered')
  })
})
