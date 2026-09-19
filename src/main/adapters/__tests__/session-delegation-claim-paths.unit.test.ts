import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionDelegationClaimPathResolver } from '../session-delegation-claim-paths'

describe('Delegation claim path comparison', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-claim-paths-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('compares case variants on case-insensitive workspaces without folding case-sensitive ones', async () => {
    const insensitive = createSessionDelegationClaimPathResolver({ caseSensitive: false })
    const sensitive = createSessionDelegationClaimPathResolver({ caseSensitive: true })

    expect(await insensitive(root, 'src/Foo.ts')).toEqual(await insensitive(root, 'SRC/foo.ts'))
    expect(await sensitive(root, 'src/Foo.ts')).not.toEqual(await sensitive(root, 'SRC/foo.ts'))
  })

  it('detects the bound filesystem case behavior automatically', async () => {
    await fs.writeFile(path.join(root, 'CaseProbe'), '')
    const caseSensitive = await fs
      .stat(path.join(root, 'caseProbe'))
      .then(() => false)
      .catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true
        throw error
      })
    const resolve = createSessionDelegationClaimPathResolver()

    expect(
      (await resolve(root, 'src/Foo.ts'))?.targetKey ===
        (await resolve(root, 'SRC/foo.ts'))?.targetKey,
    ).toBe(!caseSensitive)
  })

  it('resolves symlink aliases even when the claimed file does not exist yet', async () => {
    if (process.platform === 'win32') return
    await fs.mkdir(path.join(root, 'src'))
    await fs.symlink('src', path.join(root, 'alias'), 'dir')
    const resolve = createSessionDelegationClaimPathResolver({ caseSensitive: true })

    expect(await resolve(root, 'alias/new-file.ts')).toEqual({
      targetKey: 'src/new-file.ts',
      caseSensitive: true,
    })
    expect(await resolve(root, 'src/new-file.ts')).toEqual({
      targetKey: 'src/new-file.ts',
      caseSensitive: true,
    })
  })

  it('rejects a symlink whose resolved path leaves the bound workspace', async () => {
    if (process.platform === 'win32') return
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-claim-outside-'))
    try {
      await fs.symlink(outside, path.join(root, 'escape'), 'dir')
      const resolve = createSessionDelegationClaimPathResolver({ caseSensitive: true })

      expect(await resolve(root, 'escape/new-file.ts')).toBeUndefined()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
