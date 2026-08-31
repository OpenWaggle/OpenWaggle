import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installArtifactDescriptorInBoundDirectory,
  installArtifactInBoundDirectory,
} from '../filesystem-session-export-bound-installer'

describe('descriptor-bound Session export installation', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-install-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('never overwrites outside the workspace during a transient ancestor swap', async () => {
    if (process.platform === 'win32') return
    const workspace = path.join(temporaryRoot, 'workspace-transient')
    const destinationDirectory = path.join(workspace, 'exports')
    const movedDirectory = path.join(workspace, 'exports-authorized')
    const outsideDirectory = path.join(temporaryRoot, 'outside-transient')
    await Promise.all([
      fs.mkdir(destinationDirectory, { recursive: true }),
      fs.mkdir(outsideDirectory, { recursive: true }),
    ])
    const sourcePath = path.join(destinationDirectory, '.artifact.pending')
    const destinationPath = path.join(destinationDirectory, 'session.jsonl')
    const outsideDestination = path.join(outsideDirectory, 'session.jsonl')
    await Promise.all([
      fs.writeFile(sourcePath, 'authorized export'),
      fs.writeFile(outsideDestination, 'outside user data'),
    ])
    const expectedArtifact = await fs.stat(sourcePath, { bigint: true })

    const installation = installArtifactInBoundDirectory({
      sourcePath,
      destinationPath,
      destinationRoot: await fs.realpath(workspace),
      overwriteExisting: true,
      expectedArtifact,
      afterSpawn: async () => {
        await fs.rename(destinationDirectory, movedDirectory)
        await fs.symlink(outsideDirectory, destinationDirectory)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await fs.unlink(destinationDirectory)
        await fs.rename(movedDirectory, destinationDirectory)
      },
    })

    await installation.catch(() => undefined)
    await expect(fs.readFile(outsideDestination, 'utf8')).resolves.toBe('outside user data')
    const installed = await fs
      .readFile(destinationPath, 'utf8')
      .then((content) => content === 'authorized export')
      .catch(() => false)
    expect(installed || (await fs.readFile(sourcePath, 'utf8')) === 'authorized export').toBe(true)
  })

  it('fails scoped installation closed without descriptor-relative platform support', async () => {
    const workspace = path.join(temporaryRoot, 'workspace-win32')
    await fs.mkdir(workspace)
    const sourcePath = path.join(workspace, '.artifact.pending')
    const destinationPath = path.join(workspace, 'session.jsonl')
    await fs.writeFile(sourcePath, 'authorized export')
    const expectedArtifact = await fs.stat(sourcePath, { bigint: true })

    await expect(
      installArtifactInBoundDirectory({
        sourcePath,
        destinationPath,
        destinationRoot: await fs.realpath(workspace),
        overwriteExisting: true,
        expectedArtifact,
        platform: 'win32',
      }),
    ).rejects.toThrow('use streaming stdout export instead')
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('authorized export')
    await expect(fs.stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps installation pinned to a destination directory moved after validation', async () => {
    if (process.platform === 'win32') return
    const workspace = path.join(temporaryRoot, 'workspace-descriptor-race')
    const destinationDirectory = path.join(workspace, 'exports')
    const movedDirectory = path.join(workspace, 'exports-moved')
    const outsideDirectory = path.join(temporaryRoot, 'outside-descriptor-race')
    const sourcePath = path.join(temporaryRoot, 'authorized-source')
    await Promise.all([
      fs.mkdir(destinationDirectory, { recursive: true }),
      fs.mkdir(outsideDirectory),
      fs.writeFile(sourcePath, 'authorized export'),
    ])
    const outsideDestination = path.join(outsideDirectory, 'session.jsonl')
    await fs.writeFile(outsideDestination, 'outside user data')
    const sourceHandle = await fs.open(sourcePath, 'r')
    try {
      await expect(
        installArtifactDescriptorInBoundDirectory({
          sourceHandle,
          sourceDigest: createHash('sha256').update('authorized export').digest('hex'),
          destinationPath: path.join(destinationDirectory, 'session.jsonl'),
          destinationRoot: await fs.realpath(workspace),
          overwriteExisting: true,
          afterSpawn: async () => {
            await fs.rename(destinationDirectory, movedDirectory)
            await fs.symlink(outsideDirectory, destinationDirectory)
          },
        }),
      ).resolves.toBeUndefined()
    } finally {
      await sourceHandle.close()
    }
    await expect(fs.readFile(outsideDestination, 'utf8')).resolves.toBe('outside user data')
    await expect(fs.readFile(path.join(movedDirectory, 'session.jsonl'), 'utf8')).resolves.toBe(
      'authorized export',
    )
  })

  it('replaces a destination symlink without following its directory target', async () => {
    if (process.platform === 'win32') return
    const workspace = path.join(temporaryRoot, 'workspace-symlink-destination')
    const outsideDirectory = path.join(temporaryRoot, 'outside-symlink-destination')
    await Promise.all([fs.mkdir(workspace), fs.mkdir(outsideDirectory)])
    const sourcePath = path.join(temporaryRoot, 'symlink-source')
    await fs.writeFile(sourcePath, 'authorized export')
    const destinationPath = path.join(workspace, 'session.jsonl')
    await fs.symlink(outsideDirectory, destinationPath)
    const sourceHandle = await fs.open(sourcePath, 'r')
    try {
      await installArtifactDescriptorInBoundDirectory({
        sourceHandle,
        sourceDigest: createHash('sha256').update('authorized export').digest('hex'),
        destinationPath,
        destinationRoot: await fs.realpath(workspace),
        overwriteExisting: true,
      })
    } finally {
      await sourceHandle.close()
    }
    await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('authorized export')
    await expect(fs.readdir(outsideDirectory)).resolves.toEqual([])
  })

  it('rejects a destination directory replaced before the helper pins it', async () => {
    if (process.platform === 'win32') return
    const workspace = path.join(temporaryRoot, 'workspace-pre-spawn')
    const destinationDirectory = path.join(workspace, 'exports')
    const movedDirectory = path.join(temporaryRoot, 'outside-pre-spawn')
    await fs.mkdir(destinationDirectory, { recursive: true })
    const sourcePath = path.join(temporaryRoot, 'pre-spawn-source')
    await fs.writeFile(sourcePath, 'authorized export')
    const sourceHandle = await fs.open(sourcePath, 'r')
    try {
      await expect(
        installArtifactDescriptorInBoundDirectory({
          sourceHandle,
          sourceDigest: createHash('sha256').update('authorized export').digest('hex'),
          destinationPath: path.join(destinationDirectory, 'session.jsonl'),
          destinationRoot: await fs.realpath(workspace),
          overwriteExisting: true,
          beforeSpawn: async () => {
            await fs.rename(destinationDirectory, movedDirectory)
            await fs.symlink(movedDirectory, destinationDirectory)
          },
        }),
      ).rejects.toThrow()
    } finally {
      await sourceHandle.close()
    }
    await expect(fs.readdir(movedDirectory)).resolves.toEqual([])
  })
})
