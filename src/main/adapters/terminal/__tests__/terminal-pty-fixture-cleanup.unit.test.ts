import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { cleanupPtyFixture } from './terminal-pty-fixture-cleanup'

const EVENT_LOOP_SETTLE_MS = 20

it('keeps the temporary home until shell exit and descriptor drain have completed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'openwaggle-pty-cleanup-'))
  const exited = Promise.withResolvers<void>()
  const drained = Promise.withResolvers<boolean>()
  const kill = vi.fn()
  const cleanup = cleanupPtyFixture(
    {
      pty: { kill },
      exit: { whenExited: exited.promise },
      resourceDrain: { whenDrained: drained.promise },
    },
    home,
  )
  try {
    expect(kill).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, EVENT_LOOP_SETTLE_MS))
    await expect(access(home)).resolves.toBeUndefined()
    // Model Bash persisting its history after receiving the kill signal.
    await writeFile(join(home, '.bash_history'), 'last command\n')
    exited.resolve()
    await new Promise((resolve) => setTimeout(resolve, EVENT_LOOP_SETTLE_MS))
    await expect(access(home)).resolves.toBeUndefined()
    drained.resolve(true)
    await cleanup
    await expect(access(home)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    exited.resolve()
    drained.resolve(true)
    await cleanup
    await rm(home, { recursive: true, force: true })
  }
})

it('preserves the fixture when native resource teardown reports failure', async () => {
  const home = await mkdtemp(join(tmpdir(), 'openwaggle-pty-cleanup-failed-'))
  try {
    await expect(
      cleanupPtyFixture(
        {
          pty: { kill: vi.fn() },
          exit: { whenExited: Promise.resolve() },
          resourceDrain: { whenDrained: Promise.resolve(false) },
        },
        home,
      ),
    ).rejects.toThrow('PTY fixture resource drain failed.')
    await expect(access(home)).resolves.toBeUndefined()
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
