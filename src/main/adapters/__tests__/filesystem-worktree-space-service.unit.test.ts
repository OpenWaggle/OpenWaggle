import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorktreeSpaceService,
  measureReclaimableBytes,
  WORKTREE_SPACE_CACHE_MS,
} from '../filesystem-worktree-space-service'

const FILE_BYTES = 64 * 1024

describe('Reclaimable space of a worktree', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-space-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('counts files in nested folders and leaves out files hard-linked from elsewhere', async () => {
    const worktree = path.join(root, 'worktree')
    const store = path.join(root, 'store')
    await fs.mkdir(path.join(worktree, 'src', 'deep'), { recursive: true })
    await fs.mkdir(store)
    await fs.writeFile(path.join(worktree, 'src', 'deep', 'own.bin'), Buffer.alloc(FILE_BYTES, 1))
    const onlyOwn = await measureReclaimableBytes(worktree)

    await fs.writeFile(path.join(store, 'shared.bin'), Buffer.alloc(FILE_BYTES, 2))
    await fs.link(path.join(store, 'shared.bin'), path.join(worktree, 'src', 'shared.bin'))
    await fs.symlink(path.join(store, 'shared.bin'), path.join(worktree, 'link.bin'))

    expect(onlyOwn).toBeGreaterThanOrEqual(FILE_BYTES)
    // The hard link frees nothing; the symlink frees only itself, far less than the file.
    expect((await measureReclaimableBytes(worktree)) - onlyOwn).toBeLessThan(FILE_BYTES)
  })

  it('is zero for a path that is not a folder', async () => {
    const file = path.join(root, 'file.txt')
    await fs.writeFile(file, 'x')
    await expect(measureReclaimableBytes(file)).resolves.toBe(0)
  })

  it('reuses a measurement for an hour, then measures again, and forgets on request', async () => {
    let now = 1_000
    const measure = vi.fn(async () => FILE_BYTES)
    const service = createWorktreeSpaceService({ now: () => now, measure })

    const first = await Effect.runPromise(service.measure(root))
    await Effect.runPromise(service.measure(root))
    expect(measure).toHaveBeenCalledTimes(1)
    await expect(Effect.runPromise(service.cached(root))).resolves.toEqual(first)

    now += WORKTREE_SPACE_CACHE_MS
    await expect(Effect.runPromise(service.cached(root))).resolves.toBeNull()
    await Effect.runPromise(service.measure(root))
    expect(measure).toHaveBeenCalledTimes(2)

    await Effect.runPromise(service.forget(root))
    await expect(Effect.runPromise(service.cached(root))).resolves.toBeNull()
  })

  it('walks one worktree at a time and shares a walk already under way', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const measure = vi.fn(async (folder: string) => {
      order.push(`start ${path.basename(folder)}`)
      if (path.basename(folder) === 'a') await gate
      order.push(`end ${path.basename(folder)}`)
      return 1
    })
    const service = createWorktreeSpaceService({ measure })

    const a = Effect.runPromise(service.measure(path.join(root, 'a')))
    const again = Effect.runPromise(service.measure(path.join(root, 'a')))
    const b = Effect.runPromise(service.measure(path.join(root, 'b')))
    await Promise.resolve()
    release()
    await Promise.all([a, again, b])

    expect(measure).toHaveBeenCalledTimes(2)
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('does not cache a walk that a removal overtook', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = createWorktreeSpaceService({ measure: async () => gate.then(() => 1) })

    const walk = Effect.runPromise(service.measure(root))
    await Effect.runPromise(service.forget(root))
    release()
    await walk

    await expect(Effect.runPromise(service.cached(root))).resolves.toBeNull()
  })

  it('reports a folder it cannot read as a failure', async () => {
    const service = createWorktreeSpaceService()
    await expect(Effect.runPromise(service.measure(path.join(root, 'missing')))).rejects.toThrow(
      /Could not measure/,
    )
  })
})
