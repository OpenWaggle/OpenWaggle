import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authorizeAgentDefinitionIpcCommand,
  forgetAgentDefinitionImportSources,
  rememberAgentDefinitionImportSource,
} from '../agent-definition-ipc-authority'

const SENDER_ID = 42

describe('Agent definition IPC authority', () => {
  let root = ''
  let projectPath = ''
  let sourcePath = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-definition-ipc-'))
    projectPath = path.join(root, 'project')
    sourcePath = path.join(root, 'reviewer.md')
    await fs.mkdir(projectPath)
    await fs.writeFile(sourcePath, '# Reviewer', 'utf8')
  })

  afterEach(async () => {
    forgetAgentDefinitionImportSources(SENDER_ID)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects a forged project path before management reaches the filesystem', async () => {
    const forgedProject = path.join(root, 'forged-project')
    await fs.mkdir(forgedProject)

    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID,
        command: { operation: 'list', projectPath: forgedProject },
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow('OpenWaggle project')
  })

  it('rejects an import path that was not selected by this renderer', async () => {
    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID,
        command: {
          operation: 'import-plan',
          projectPath,
          sourcePath,
          targetScope: 'project',
        },
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow('Select this Agent definition source')
  })

  it('accepts the canonical selected source only for its selecting renderer', async () => {
    const selected = await rememberAgentDefinitionImportSource(SENDER_ID, sourcePath)
    const command = await authorizeAgentDefinitionIpcCommand({
      senderId: SENDER_ID,
      command: {
        operation: 'import-plan',
        projectPath,
        sourcePath,
        targetScope: 'project',
      },
      knownProjectPaths: [projectPath],
    })

    expect(command).toMatchObject({
      sourcePath: selected,
      projectPath: await fs.realpath(projectPath),
    })
    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID + 1,
        command,
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow('Select this Agent definition source')
  })

  it('rejects undeclared properties and malformed documents at runtime', async () => {
    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID,
        command: { operation: 'list', projectPath, injected: true },
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow()
    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID,
        command: {
          operation: 'write',
          projectPath,
          scope: 'project',
          document: { schemaVersion: 1, name: 'reviewer' },
        },
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow()
  })

  it('rejects renderer-authored import provenance and unselected refresh sources', async () => {
    const provenance = {
      sourceTool: 'openwaggle' as const,
      sourcePath,
      sourceDigest: 'source-digest',
      importerVersion: 1 as const,
      baselineDigest: 'baseline-digest',
      importedAt: 1,
    }
    await expect(
      authorizeAgentDefinitionIpcCommand({
        senderId: SENDER_ID,
        command: {
          operation: 'write',
          projectPath,
          scope: 'project',
          document: {
            schemaVersion: 1,
            name: 'reviewer',
            description: 'Review.',
            instructions: 'Review the work.',
            import: provenance,
          },
        },
        knownProjectPaths: [projectPath],
      }),
    ).rejects.toThrow('cannot be written by the UI')

    const refreshInput = {
      senderId: SENDER_ID,
      command: { operation: 'refresh-plan', projectPath, name: 'reviewer' },
      knownProjectPaths: [projectPath],
      resolveRefreshSourcePath: async () => sourcePath,
    } as const
    await expect(authorizeAgentDefinitionIpcCommand(refreshInput)).rejects.toThrow(
      'before refreshing',
    )
    await rememberAgentDefinitionImportSource(SENDER_ID, sourcePath)
    await expect(authorizeAgentDefinitionIpcCommand(refreshInput)).resolves.toMatchObject({
      operation: 'refresh-plan',
      name: 'reviewer',
    })
  })
})
