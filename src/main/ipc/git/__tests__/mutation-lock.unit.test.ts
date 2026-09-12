import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  runWithGitMutationLock,
  runWithGitNetworkLock,
  withGitMutationLock,
} from '../mutation-lock'

describe('withGitMutationLock', () => {
  it('does not make a local mutation wait for a stalled background network operation', async () => {
    const workingPath = process.cwd()
    const events: string[] = []
    let releaseNetwork: (() => void) | undefined
    const networkGate = new Promise<void>((resolve) => {
      releaseNetwork = resolve
    })
    let markStarted: (() => void) | undefined
    const networkStarted = new Promise<void>((resolve) => {
      markStarted = resolve
    })

    const network = runWithGitNetworkLock(workingPath, async () => {
      events.push('network:start')
      markStarted?.()
      await networkGate
      events.push('network:end')
    })
    await networkStarted
    await runWithGitMutationLock(workingPath, async () => {
      events.push('mutation')
    })

    expect(events).toEqual(['network:start', 'mutation'])
    releaseNetwork?.()
    await network
    expect(events).toEqual(['network:start', 'mutation', 'network:end'])
  })

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

  it('serializes mutations across linked worktrees through their common Git directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-linked-lock-'))
    const repository = path.join(root, 'repository')
    const linked = path.join(root, 'linked')
    const linkedGitDir = path.join(repository, '.git', 'worktrees', 'linked')
    await fs.mkdir(linkedGitDir, { recursive: true })
    await fs.mkdir(linked, { recursive: true })
    await fs.writeFile(path.join(linked, '.git'), `gitdir: ${linkedGitDir}\n`)
    await fs.writeFile(path.join(linkedGitDir, 'commondir'), '../..\n')
    const events: string[] = []
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    try {
      const first = Effect.runPromise(
        withGitMutationLock(
          repository,
          Effect.promise(async () => {
            events.push('repository:start')
            await gate
            events.push('repository:end')
          }),
        ),
      )
      await vi.waitFor(() => expect(events).toEqual(['repository:start']))
      const second = Effect.runPromise(
        withGitMutationLock(
          linked,
          Effect.sync(() => events.push('linked')),
        ),
      )
      await Promise.resolve()
      expect(events).toEqual(['repository:start'])
      releaseFirst?.()
      await Promise.all([first, second])
      expect(events).toEqual(['repository:start', 'repository:end', 'linked'])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
