import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserPreviewArtifactStorage } from '../browser-preview-artifact-storage'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-preview-artifacts-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('BrowserPreviewArtifactStorage', () => {
  it('writes private artifacts atomically inside its managed directory', async () => {
    const directory = path.join(root, 'artifacts')
    const storage = new BrowserPreviewArtifactStorage(directory)

    const artifact = await storage.write('screenshot', 'png', new Uint8Array([1, 2, 3]))

    expect(path.dirname(artifact.path)).toBe(directory)
    expect(await fs.readFile(artifact.path)).toEqual(Buffer.from([1, 2, 3]))
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(artifact.path)).mode & 0o777).toBe(0o600)
    expect((await fs.readdir(directory)).some((entry) => entry.endsWith('.tmp'))).toBe(false)
  })

  it('prunes only managed artifacts once the count limit is exceeded', async () => {
    const directory = path.join(root, 'artifacts')
    const storage = new BrowserPreviewArtifactStorage(directory, {
      maxFiles: 2,
      maxTotalBytes: 1_024,
    })
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'keep-me.txt'), 'unmanaged')

    await storage.write('screenshot', 'png', new Uint8Array([1]))
    await storage.write('recording', 'webm', new Uint8Array([2]))
    await storage.write('screenshot', 'png', new Uint8Array([3]))

    const entries = await fs.readdir(directory)
    expect(entries).toContain('keep-me.txt')
    expect(
      entries.filter((entry) => entry.endsWith('.png') || entry.endsWith('.webm')),
    ).toHaveLength(2)
  })

  it('rejects arbitrary paths and symbolic-link artifacts', async () => {
    const directory = path.join(root, 'artifacts')
    const storage = new BrowserPreviewArtifactStorage(directory)
    const outside = path.join(root, 'outside.png')
    await fs.writeFile(outside, 'outside')

    await expect(storage.resolveOwnedArtifact(outside)).rejects.toThrow('outside')

    await fs.symlink(outside, path.join(directory, 'browser-screenshot-linked.png'))
    await expect(
      storage.resolveOwnedArtifact(path.join(directory, 'browser-screenshot-linked.png')),
    ).rejects.toThrow('regular file')
  })
})
