import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, listDocsMock, resolveTopicMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listDocsMock: vi.fn(),
  resolveTopicMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerDocsHandlers } from '../docs-handler'

function getRegisteredHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerDocsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listDocsMock.mockReset()
    resolveTopicMock.mockReset()
    listDocsMock.mockReturnValue(
      Effect.succeed({
        generatedAt: '2026-01-01T00:00:00.000Z',
        bundlePath: '/bundle',
        firstPartyTopics: [],
        extensionTopics: [],
        diagnostics: [],
      }),
    )
    resolveTopicMock.mockReturnValue(Effect.succeed(null))
  })

  it('registers docs:discover and normalizes existing project paths', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-docs-ipc-'))
    const realProjectPath = await fs.realpath(projectPath)
    registerDocsHandlers({ listDocs: listDocsMock, resolveTopic: resolveTopicMock })
    const handler = getRegisteredHandler('docs:discover')

    try {
      await handler?.({}, { projectPaths: [projectPath, projectPath], includeExtensions: true })

      expect(listDocsMock).toHaveBeenCalledWith({
        projectPaths: [realProjectPath],
        includeExtensions: true,
      })
    } finally {
      await fs.rm(projectPath, { force: true, recursive: true })
    }
  })

  it('rejects invalid docs:discover project paths instead of dropping them', async () => {
    registerDocsHandlers({ listDocs: listDocsMock, resolveTopic: resolveTopicMock })
    const handler = getRegisteredHandler('docs:discover')

    await expect(
      handler?.({}, { projectPaths: ['/definitely/not/an/openwaggle/project'] }),
    ).rejects.toThrow()
    expect(listDocsMock).not.toHaveBeenCalled()
  })

  it('rejects blank docs:discover project paths instead of dropping them', async () => {
    registerDocsHandlers({ listDocs: listDocsMock, resolveTopic: resolveTopicMock })
    const handler = getRegisteredHandler('docs:discover')

    await expect(handler?.({}, { projectPaths: ['   '] })).rejects.toThrow(
      'Project path is required.',
    )
    expect(listDocsMock).not.toHaveBeenCalled()
  })

  it('rejects extension topics on docs:resolve-topic', async () => {
    registerDocsHandlers({ listDocs: listDocsMock, resolveTopic: resolveTopicMock })
    const handler = getRegisteredHandler('docs:resolve-topic')

    await expect(
      handler?.({}, { topic: 'extension:sample/extending/openwaggle-extensions' }),
    ).rejects.toThrow()
    expect(resolveTopicMock).not.toHaveBeenCalled()
  })
})
