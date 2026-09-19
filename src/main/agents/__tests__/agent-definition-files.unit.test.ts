import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteAgentDefinitionFile, writeAgentDefinitionFile } from '../agent-definition-files'
import { MAX_AGENT_DEFINITION_SOURCE_BYTES } from '../agent-definition-source-reader'

const SUBPROCESS_TEST_TIMEOUT_MS = 15_000

describe('Agent definition file mutations', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-definition-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not write through a project directory replaced by an outside symlink', async () => {
    const projectPath = path.join(root, 'project')
    const definitions = path.join(projectPath, '.openwaggle', 'agents')
    const movedDefinitions = path.join(projectPath, '.openwaggle', 'agents-authorized')
    const outside = path.join(root, 'outside')
    await Promise.all([fs.mkdir(definitions, { recursive: true }), fs.mkdir(outside)])
    const outsideDefinition = path.join(outside, 'reviewer.md')
    await fs.writeFile(outsideDefinition, 'outside user data')

    const operation = writeAgentDefinitionFile({
      projectPath,
      scope: 'project',
      replaceExisting: false,
      document: {
        schemaVersion: 1,
        name: 'reviewer',
        description: 'Reviews changes',
        instructions: 'Review the change.',
      },
      beforeMutation: async () => {
        await fs.rename(definitions, movedDefinitions)
        await fs.symlink(outside, definitions, process.platform === 'win32' ? 'junction' : 'dir')
      },
    })
    let completed = true
    if (process.platform === 'win32') {
      completed = await operation.then(
        () => true,
        () => false,
      )
    } else {
      await expect(operation).resolves.toMatchObject({ name: 'reviewer' })
    }
    await expect(fs.readFile(outsideDefinition, 'utf8')).resolves.toBe('outside user data')
    if (completed) {
      await expect(
        fs.readFile(path.join(movedDefinitions, 'reviewer.md'), 'utf8'),
      ).resolves.toContain('Review the change.')
    }
  })

  it('rejects a project directory replaced before the mutation helper pins it', async () => {
    const projectPath = path.join(root, 'pre-spawn-project')
    const definitions = path.join(projectPath, '.openwaggle', 'agents')
    const movedDefinitions = path.join(root, 'pre-spawn-outside')
    await fs.mkdir(definitions, { recursive: true })

    await expect(
      writeAgentDefinitionFile({
        projectPath,
        scope: 'project',
        replaceExisting: false,
        document: {
          schemaVersion: 1,
          name: 'reviewer',
          description: 'Reviews changes',
          instructions: 'Review the change.',
        },
        beforeMutationSpawn: async () => {
          await fs.rename(definitions, movedDefinitions)
          await fs.symlink(
            movedDefinitions,
            definitions,
            process.platform === 'win32' ? 'junction' : 'dir',
          )
        },
      }),
    ).rejects.toThrow()
    await expect(fs.readdir(movedDefinitions)).resolves.toEqual([])
  })

  it('creates the first definition directory from a bound parent during a root swap', async () => {
    const projectPath = path.join(root, 'new-project')
    const movedProject = path.join(root, 'new-project-authorized')
    const outside = path.join(root, 'outside-first-create')
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(outside)])
    let swapped = false

    await expect(
      writeAgentDefinitionFile({
        projectPath,
        scope: 'project',
        replaceExisting: false,
        document: {
          schemaVersion: 1,
          name: 'explorer',
          description: 'Explores safely',
          instructions: 'Explore the change.',
        },
        beforeDirectoryMutation: async (_component, index) => {
          if (index !== 0 || swapped) return
          swapped = true
          await fs.rename(projectPath, movedProject)
          await fs.symlink(outside, projectPath)
        },
      }),
    ).rejects.toThrow()

    await expect(fs.stat(path.join(outside, '.openwaggle'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    if (process.platform !== 'win32') {
      await expect(fs.stat(path.join(movedProject, '.openwaggle'))).resolves.toMatchObject({})
    }
  })

  it('creates a missing definition hierarchy one bound component at a time', async () => {
    const projectPath = path.join(root, 'empty-project')
    await fs.mkdir(projectPath)

    const result = await writeAgentDefinitionFile({
      projectPath,
      scope: 'project',
      replaceExisting: false,
      document: {
        schemaVersion: 1,
        name: 'implementer',
        description: 'Implements changes',
        instructions: 'Implement the change.',
      },
    })

    await expect(fs.readFile(result.destinationPath, 'utf8')).resolves.toContain(
      'Implement the change.',
    )
  })

  it('creates, replaces, and deletes definitions through the Windows-compatible path', async () => {
    const projectPath = path.join(root, 'windows-project')
    await fs.mkdir(projectPath)
    const created = await writeAgentDefinitionFile({
      projectPath,
      scope: 'project',
      replaceExisting: false,
      platform: 'win32',
      document: {
        schemaVersion: 1,
        name: 'implementer',
        description: 'Implements changes',
        instructions: 'Implement the first change.',
      },
    })

    const replaced = await writeAgentDefinitionFile({
      projectPath,
      scope: 'project',
      replaceExisting: true,
      platform: 'win32',
      expectedContentDigest: created.contentDigest,
      document: {
        schemaVersion: 1,
        name: 'implementer',
        description: 'Implements changes',
        instructions: 'Implement the replacement change.',
      },
    })
    await expect(fs.readFile(replaced.destinationPath, 'utf8')).resolves.toContain(
      'Implement the replacement change.',
    )

    await deleteAgentDefinitionFile({
      projectPath,
      scope: 'project',
      name: 'implementer',
      platform: 'win32',
      expectedContentDigest: replaced.contentDigest,
    })
    await expect(fs.stat(replaced.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects oversized existing definitions before replacement or deletion', async () => {
    const projectPath = path.join(root, 'oversized-project')
    const definitions = path.join(projectPath, '.openwaggle', 'agents')
    const destination = path.join(definitions, 'reviewer.md')
    await fs.mkdir(definitions, { recursive: true })
    await fs.writeFile(destination, Buffer.alloc(MAX_AGENT_DEFINITION_SOURCE_BYTES + 1, 97))

    await expect(
      deleteAgentDefinitionFile({
        projectPath,
        scope: 'project',
        name: 'reviewer',
      }),
    ).rejects.toThrow('1 MiB')
    await expect(fs.stat(destination)).resolves.toMatchObject({ size: expect.any(Number) })
  })

  it.each(['con', 'nul.config', 'com1', 'lpt9'])(
    'rejects the Windows-reserved portable name %s',
    async (name) => {
      const projectPath = path.join(root, 'portable-name-project')
      await fs.mkdir(projectPath)

      await expect(
        writeAgentDefinitionFile({
          projectPath,
          scope: 'project',
          replaceExisting: false,
          document: {
            schemaVersion: 1,
            name,
            description: 'Reserved on Windows',
            instructions: 'Do not create this file.',
          },
        }),
      ).rejects.toThrow('Invalid or non-portable Agent definition name')
    },
  )

  it(
    'does not replace an in-place edit made after mutation validation',
    async () => {
      const projectPath = path.join(root, 'replace-project')
      await fs.mkdir(projectPath)
      const created = await writeAgentDefinitionFile({
        projectPath,
        scope: 'project',
        replaceExisting: false,
        document: {
          schemaVersion: 1,
          name: 'reviewer',
          description: 'Reviews changes',
          instructions: 'Original instructions.',
        },
      })

      await expect(
        writeAgentDefinitionFile({
          projectPath,
          scope: 'project',
          replaceExisting: true,
          document: {
            schemaVersion: 1,
            name: 'reviewer',
            description: 'Reviews changes',
            instructions: 'Replacement instructions.',
          },
          beforeMutation: () => fs.writeFile(created.destinationPath, 'in-place user edit'),
        }),
      ).rejects.toThrow()
      await expect(fs.readFile(created.destinationPath, 'utf8')).resolves.toBe('in-place user edit')
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  )

  it(
    'does not delete an in-place edit made after mutation validation',
    async () => {
      const projectPath = path.join(root, 'delete-project')
      await fs.mkdir(projectPath)
      const created = await writeAgentDefinitionFile({
        projectPath,
        scope: 'project',
        replaceExisting: false,
        document: {
          schemaVersion: 1,
          name: 'reviewer',
          description: 'Reviews changes',
          instructions: 'Original instructions.',
        },
      })

      await expect(
        deleteAgentDefinitionFile({
          projectPath,
          scope: 'project',
          name: 'reviewer',
          beforeMutation: () => fs.writeFile(created.destinationPath, 'in-place user edit'),
        }),
      ).rejects.toThrow()
      await expect(fs.readFile(created.destinationPath, 'utf8')).resolves.toBe('in-place user edit')
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  )
})
