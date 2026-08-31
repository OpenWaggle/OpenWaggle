import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertFilesystemWriteScope } from '../filesystem-write-scope'

describe('filesystem write scope', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-write-scope-'))
    temporaryRoots.push(root)
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await fs.mkdir(workspace)
    await fs.mkdir(outside)
    return { workspace, outside }
  }

  it('allows a new destination below a real workspace directory', async () => {
    const { workspace } = await fixture()
    const canonicalWorkspace = await fs.realpath(workspace)
    await expect(
      assertFilesystemWriteScope({
        roots: [workspace],
        destinationPath: path.join(workspace, 'new', 'session.zip'),
      }),
    ).resolves.toEqual({
      rootPath: canonicalWorkspace,
      destinationPath: path.join(canonicalWorkspace, 'new', 'session.zip'),
    })
  })

  it('rejects a lexically contained destination through an escaping parent symlink', async () => {
    const { workspace, outside } = await fixture()
    await fs.symlink(outside, path.join(workspace, 'escaped'))
    await expect(
      assertFilesystemWriteScope({
        roots: [workspace],
        destinationPath: path.join(workspace, 'escaped', 'session.zip'),
      }),
    ).rejects.toThrow('outside the granted filesystem scope')
  })

  it('returns a canonical destination and root for an in-scope parent symlink', async () => {
    const { workspace } = await fixture()
    const canonicalDirectory = path.join(workspace, 'canonical')
    await fs.mkdir(canonicalDirectory)
    await fs.symlink(canonicalDirectory, path.join(workspace, 'linked'))
    const canonicalWorkspace = await fs.realpath(workspace)
    const realCanonicalDirectory = await fs.realpath(canonicalDirectory)

    await expect(
      assertFilesystemWriteScope({
        roots: [workspace],
        destinationPath: path.join(workspace, 'linked', 'session.zip'),
      }),
    ).resolves.toEqual({
      rootPath: canonicalWorkspace,
      destinationPath: path.join(realCanonicalDirectory, 'session.zip'),
    })
  })
})
