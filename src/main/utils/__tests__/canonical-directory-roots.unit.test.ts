import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { canonicalizeExistingDirectoryRoots } from '../canonical-directory-roots'

const ROOT_COUNT = 32
const EXPECTED_CONCURRENCY = 8

describe('canonical directory roots', () => {
  it('bounds concurrent filesystem canonicalization work', async () => {
    let active = 0
    let peak = 0
    let release: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const realpath = vi.spyOn(fs, 'realpath').mockImplementation(async (root) => {
      active += 1
      peak = Math.max(peak, active)
      await barrier
      active -= 1
      return String(root)
    })
    vi.spyOn(fs, 'stat').mockResolvedValue(fromPartial<Stats>({ isDirectory: () => true }))
    const pending = canonicalizeExistingDirectoryRoots(
      Array.from({ length: ROOT_COUNT }, (_, index) => `/tmp/root-${String(index)}`),
      'Profile root',
    )

    await vi.waitFor(() => expect(realpath).toHaveBeenCalledTimes(EXPECTED_CONCURRENCY))
    release?.()
    await expect(pending).resolves.toHaveLength(ROOT_COUNT)
    expect(peak).toBe(EXPECTED_CONCURRENCY)
  })
})
