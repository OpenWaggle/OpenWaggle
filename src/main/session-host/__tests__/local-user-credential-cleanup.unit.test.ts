import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: { chmodFailurePath: string | null; failLink: boolean; missingReads: number } = {
    chmodFailurePath: null,
    failLink: false,
    missingReads: 0,
  }
  return state
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const errorWithCode = (code: string) => Object.assign(new Error(code), { code })
  return {
    ...actual,
    chmod: async (targetPath: string, mode: number) => {
      if (targetPath === mocks.chmodFailurePath) throw errorWithCode('EACCES')
      return actual.chmod(targetPath, mode)
    },
    link: async (existingPath: string, newPath: string) => {
      if (mocks.failLink) throw errorWithCode('EPERM')
      return actual.link(existingPath, newPath)
    },
    readFile: async (targetPath: string, encoding: BufferEncoding) => {
      if (mocks.missingReads > 0) {
        mocks.missingReads -= 1
        throw errorWithCode('ENOENT')
      }
      return actual.readFile(targetPath, encoding)
    },
  }
})

import { ensureLocalUserCredential } from '../local-user-credential'

describe('Local Session credential temporary-link cleanup', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-credential-cleanup-'))
    mocks.chmodFailurePath = null
    mocks.failLink = false
    mocks.missingReads = 0
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('removes the winner temporary link when installed-credential chmod fails', async () => {
    const credentialPath = path.join(temporaryRoot, 'winner.credential')
    mocks.chmodFailurePath = credentialPath

    await expect(ensureLocalUserCredential(credentialPath)).rejects.toThrow('EACCES')

    const entries = await fs.readdir(temporaryRoot)
    const installed = (await fs.readFile(credentialPath, 'utf8')).trim()
    const stats = await fs.stat(credentialPath)
    expect(entries).toEqual(['winner.credential'])
    expect(Buffer.from(installed, 'base64url')).toHaveLength(32)
    expect(stats.nlink).toBe(1)
  })

  it('removes an EEXIST loser temporary link when installed-credential chmod fails', async () => {
    const credentialPath = path.join(temporaryRoot, 'loser.credential')
    const installed = Buffer.alloc(32, 7).toString('base64url')
    await fs.writeFile(credentialPath, `${installed}\n`, { mode: 0o600 })
    mocks.missingReads = 1
    mocks.chmodFailurePath = credentialPath

    await expect(ensureLocalUserCredential(credentialPath)).rejects.toThrow('EACCES')

    const entries = await fs.readdir(temporaryRoot)
    const persisted = (await fs.readFile(credentialPath, 'utf8')).trim()
    const stats = await fs.stat(credentialPath)
    expect(entries).toEqual(['loser.credential'])
    expect(persisted).toBe(installed)
    expect(stats.nlink).toBe(1)
  })

  it('removes the temporary credential when hard-link installation fails', async () => {
    const credentialPath = path.join(temporaryRoot, 'failed-link.credential')
    mocks.failLink = true

    await expect(ensureLocalUserCredential(credentialPath)).rejects.toThrow('EPERM')

    await expect(fs.readdir(temporaryRoot)).resolves.toEqual([])
    await expect(fs.stat(credentialPath)).rejects.toThrow()
  })
})
