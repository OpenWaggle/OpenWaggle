import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
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

  it('serializes different opened folders inside the same checkout', async () => {
    const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-git-lock-'))
    const firstFolder = path.join(checkout, 'packages', 'first')
    const secondFolder = path.join(checkout, 'packages', 'second')
    await fs.mkdir(path.join(checkout, '.git'))
    await fs.mkdir(firstFolder, { recursive: true })
    await fs.mkdir(secondFolder, { recursive: true })
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    try {
      const first = Effect.runPromise(
        withGitMutationLock(
          firstFolder,
          Effect.promise(async () => {
            events.push('first:start')
            await firstGate
            events.push('first:end')
          }),
        ),
      )
      await vi.waitFor(() => expect(events).toEqual(['first:start']))
      const second = Effect.runPromise(
        withGitMutationLock(
          secondFolder,
          Effect.sync(() => events.push('second')),
        ),
      )

      await Promise.resolve()
      expect(events).toEqual(['first:start'])
      releaseFirst?.()
      await Promise.all([first, second])
      expect(events).toEqual(['first:start', 'first:end', 'second'])
    } finally {
      await fs.rm(checkout, { recursive: true, force: true })
    }
  })
})
