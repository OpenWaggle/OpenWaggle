import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, listContributionsMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listContributionsMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerExtensionsHandlers } from '../extensions-handler'

function makeContributionsView(
  input: ExtensionListContributionsInput,
): ExtensionContributionRegistryView {
  return {
    projectPaths: input.projectPaths ?? [],
    entries: [
      {
        extensionId: 'sample-extension',
        extensionName: 'Sample Extension',
        extensionVersion: '1.0.0',
        scope: {
          kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
          label: 'Global',
        },
        packagePath: '/tmp/user-data/extensions/sample-extension',
        manifestPath: '/tmp/user-data/extensions/sample-extension/openwaggle.extension.json',
        contentHash: 'abcdef',
        projectPaths: input.projectPaths ?? [],
        appliesToAllRequestedProjects: true,
        family: 'commands',
        contributionId: 'sample.run',
        title: 'Run Sample',
        label: 'Run Sample',
        eligibility: {
          runtimeEnabled: true,
          enabled: true,
          trusted: true,
          sdkCompatible: true,
          updateAvailable: false,
          disabledProjectPaths: [],
        },
        diagnostics: [],
      },
    ],
  }
}

function registerContributionsHandler() {
  registerExtensionsHandlers({
    listExtensionContributionsView: (input: ExtensionListContributionsInput) =>
      Effect.sync(() => listContributionsMock(input)),
  })
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'extensions:list-contributions' && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerExtensionsHandlers contribution registry', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listContributionsMock.mockReset()
    listContributionsMock.mockImplementation(makeContributionsView)
  })

  it('registers extensions:list-contributions and decodes multiple project paths', async () => {
    const firstProjectPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'openwaggle-contributions-first-'),
    )
    const secondProjectPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'openwaggle-contributions-second-'),
    )
    const realFirstProjectPath = await fs.realpath(firstProjectPath)
    const realSecondProjectPath = await fs.realpath(secondProjectPath)
    const handler = registerContributionsHandler()

    try {
      const view = await handler?.(
        {},
        {
          projectPaths: [firstProjectPath, secondProjectPath, firstProjectPath],
          sessionId: ' session-1 ',
        },
      )

      expect(listContributionsMock).toHaveBeenCalledWith({
        projectPaths: [realFirstProjectPath, realSecondProjectPath],
        sessionId: 'session-1',
      })
      expect(view).toMatchObject({
        projectPaths: [realFirstProjectPath, realSecondProjectPath],
        entries: [{ contributionId: 'sample.run', family: 'commands' }],
      })
    } finally {
      await fs.rm(firstProjectPath, { recursive: true, force: true })
      await fs.rm(secondProjectPath, { recursive: true, force: true })
    }
  })

  it('rejects legacy or malformed contribution registry payloads before reading', async () => {
    const handler = registerContributionsHandler()

    await expect(handler?.({}, 123)).rejects.toThrow()
    await expect(handler?.({}, null)).rejects.toThrow()
    await expect(handler?.({}, '/tmp/project')).rejects.toThrow()
    await expect(handler?.({}, { projectPath: '/tmp/project' })).rejects.toThrow()
    await expect(handler?.({}, { projectPaths: [], extra: true })).rejects.toThrow()
    await expect(handler?.({}, { projectPaths: [], sessionId: 123 })).rejects.toThrow()
    expect(listContributionsMock).not.toHaveBeenCalled()
  })
})
