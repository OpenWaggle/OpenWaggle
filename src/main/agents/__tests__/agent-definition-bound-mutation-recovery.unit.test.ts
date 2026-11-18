import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mutateDefinitionInBoundDirectory } from '../agent-definition-bound-mutation'

describe('bound Agent definition mutation recovery', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-definition-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it.each(['after-pending-open', 'after-displacement', 'after-install'] as const)(
    'restores the original definition after an injected %s failure',
    async (faultInjection) => {
      const projectPath = path.join(root, 'project')
      const directory = path.join(projectPath, '.openwaggle', 'agents')
      const destinationPath = path.join(directory, 'reviewer.md')
      const sourcePath = path.join(root, 'replacement.md')
      const original = 'Original instructions.'
      const replacement = 'Replacement instructions.'
      await fs.mkdir(directory, { recursive: true })
      await Promise.all([
        fs.writeFile(destinationPath, original),
        fs.writeFile(sourcePath, replacement),
      ])
      const [directoryStats, destinationStats, sourceHandle] = await Promise.all([
        fs.stat(directory),
        fs.stat(destinationPath),
        fs.open(sourcePath, 'r'),
      ])
      try {
        await expect(
          mutateDefinitionInBoundDirectory({
            rootPath: projectPath,
            directory,
            destinationPath,
            pendingName: '.reviewer.pending',
            mode: 'replace',
            expectedIdentity: `${destinationStats.dev}:${destinationStats.ino}`,
            expectedContentDigest: createHash('sha256').update(original).digest('hex'),
            expectedDirectoryIdentity: `${directoryStats.dev}:${directoryStats.ino}`,
            sourceHandle,
            sourceDigest: createHash('sha256').update(replacement).digest('hex'),
            faultInjection,
          }),
        ).rejects.toThrow('Descriptor-bound Agent definition mutation failed')
      } finally {
        await sourceHandle.close()
      }

      await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe(original)
      await expect(fs.readdir(directory)).resolves.toEqual(['reviewer.md'])
    },
  )

  it('reports a recoverable original when the destination is concurrently recreated', async () => {
    const projectPath = path.join(root, 'occupied-project')
    const directory = path.join(projectPath, '.openwaggle', 'agents')
    const destinationPath = path.join(directory, 'reviewer.md')
    const original = 'Original instructions.'
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(destinationPath, original)
    const [directoryStats, destinationStats] = await Promise.all([
      fs.stat(directory),
      fs.stat(destinationPath),
    ])

    await expect(
      mutateDefinitionInBoundDirectory({
        rootPath: projectPath,
        directory,
        destinationPath,
        pendingName: '.unused',
        mode: 'delete',
        expectedIdentity: `${destinationStats.dev}:${destinationStats.ino}`,
        expectedContentDigest: createHash('sha256').update(original).digest('hex'),
        expectedDirectoryIdentity: `${directoryStats.dev}:${directoryStats.ino}`,
        faultInjection: 'occupy-destination',
      }),
    ).rejects.toThrow('original retained in .reviewer.md.')

    await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('Concurrent definition.')
    const displaced = (await fs.readdir(directory)).find((name) => name.endsWith('.displaced'))
    expect(displaced).toBeDefined()
    await expect(fs.readFile(path.join(directory, displaced ?? ''), 'utf8')).resolves.toBe(original)
  })
})
