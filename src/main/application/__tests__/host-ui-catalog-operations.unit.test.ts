import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionListContributionsInput } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverHostUiDocsWith } from '../host-ui-docs-operation'
import { listHostUiExtensionContributionsWith } from '../host-ui-extension-operations'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((temporaryPath) => fs.rm(temporaryPath, { recursive: true, force: true })),
  )
})

describe('Host-backed catalog operations', () => {
  it('normalizes docs discovery inputs without an Electron IPC event', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-docs-'))
    temporaryPaths.push(projectPath)
    const canonicalProjectPath = await fs.realpath(projectPath)
    const listDocs = vi.fn(() =>
      Effect.succeed({
        generatedAt: '2026-01-01T00:00:00.000Z',
        bundlePath: '/bundle',
        firstPartyTopics: [],
        extensionTopics: [],
        diagnostics: [],
      }),
    )

    await Effect.runPromise(
      discoverHostUiDocsWith(
        { projectPaths: [projectPath, projectPath], includeExtensions: true },
        listDocs,
      ),
    )

    expect(listDocs).toHaveBeenCalledWith({
      projectPaths: [canonicalProjectPath],
      includeExtensions: true,
    })
  })

  it('normalizes extension contribution inputs without an Electron IPC event', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-ext-'))
    temporaryPaths.push(projectPath)
    const canonicalProjectPath = await fs.realpath(projectPath)
    const listContributions = vi.fn((input: ExtensionListContributionsInput) =>
      Effect.succeed({
        projectPaths: [...(input.projectPaths ?? [])],
        entries: [],
        diagnostics: [],
      }),
    )

    const result = await Effect.runPromise(
      listHostUiExtensionContributionsWith(
        { projectPaths: [projectPath, projectPath], sessionId: ' session-1 ' },
        listContributions,
      ),
    )

    expect(listContributions).toHaveBeenCalledWith({
      projectPaths: [canonicalProjectPath],
      sessionId: 'session-1',
    })
    expect(result.projectPaths).toEqual([canonicalProjectPath])
  })
})
