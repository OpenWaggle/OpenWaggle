import fs from 'node:fs/promises'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'

const { invalidateGitStatusCacheMock, listExternalEditorsMock, openFileMock, typedHandleMock } =
  vi.hoisted(() => ({
    invalidateGitStatusCacheMock: vi.fn(),
    listExternalEditorsMock: vi.fn(),
    openFileMock: vi.fn(),
    typedHandleMock: vi.fn(),
  }))

vi.mock('../typed-ipc', () => ({ typedHandle: typedHandleMock }))
vi.mock('../git/status-cache', () => ({
  invalidateGitStatusCache: invalidateGitStatusCacheMock,
}))
vi.mock('../../adapters/workspace-file-watcher', () => ({
  watchWorkspaceFiles: vi.fn(),
  unwatchWorkspaceFiles: vi.fn(),
}))

import { registerWorkspaceFileHandlers } from '../workspace-files-handler'

const PROJECT_PATH = process.cwd()

function mutationLayer() {
  const service = fromPartial<WorkspaceFileServiceShape>({
    listExternalEditors: listExternalEditorsMock,
    openFile: openFileMock,
    createEntry: () => Effect.succeed({ path: 'src/new.ts' }),
    moveEntry: () => Effect.succeed({ path: 'src/moved.ts', previousPath: 'src/new.ts' }),
    duplicateEntry: () => Effect.succeed({ path: 'src/copy.ts', previousPath: 'src/moved.ts' }),
    trashEntry: () => Effect.succeed({ path: 'src/copy.ts' }),
  })
  return Layer.succeed(WorkspaceFileService, service)
}

function registeredHandler(name: string, layer: ReturnType<typeof mutationLayer>) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('workspace file mutation handlers', () => {
  beforeEach(() => {
    invalidateGitStatusCacheMock.mockReset()
    listExternalEditorsMock.mockReset()
    openFileMock.mockReset()
    listExternalEditorsMock.mockReturnValue(
      Effect.succeed([
        { id: 'vscode', label: 'Visual Studio Code' },
        { id: 'zed', label: 'Zed' },
      ]),
    )
    openFileMock.mockReturnValue(Effect.succeed(undefined))
    typedHandleMock.mockReset()
    registerWorkspaceFileHandlers()
  })

  it('lists supported editors without requiring a workspace path', async () => {
    const result = await registeredHandler(
      'workspace-files:list-external-editors',
      mutationLayer(),
    )?.({})

    expect(result).toEqual([
      { id: 'vscode', label: 'Visual Studio Code' },
      { id: 'zed', label: 'Zed' },
    ])
  })

  it('validates and forwards the selected editor and line to the workspace service', async () => {
    const canonicalProjectPath = await fs.realpath(PROJECT_PATH)

    await registeredHandler('workspace-files:open-external', mutationLayer())?.(
      {},
      {
        projectPath: PROJECT_PATH,
        path: 'src/example.ts',
        editor: 'vscode',
        line: 14,
      },
    )

    expect(openFileMock).toHaveBeenCalledWith({
      projectPath: canonicalProjectPath,
      path: 'src/example.ts',
      editor: 'vscode',
      line: 14,
    })
  })

  it('rejects an unknown editor before touching the workspace service', async () => {
    await expect(
      registeredHandler('workspace-files:open-external', mutationLayer())?.(
        {},
        {
          projectPath: PROJECT_PATH,
          path: 'src/example.ts',
          editor: 'not-a-real-editor',
        },
      ),
    ).rejects.toThrow()

    expect(openFileMock).not.toHaveBeenCalled()
  })

  it('invalidates and broadcasts Git state after every entry mutation', async () => {
    const layer = mutationLayer()
    const canonicalProjectPath = await fs.realpath(PROJECT_PATH)

    await registeredHandler('workspace-files:create-entry', layer)?.(
      {},
      { projectPath: PROJECT_PATH, path: 'src/new.ts', kind: 'file' },
    )
    await registeredHandler('workspace-files:move-entry', layer)?.(
      {},
      {
        projectPath: PROJECT_PATH,
        path: 'src/new.ts',
        targetPath: 'src/moved.ts',
      },
    )
    await registeredHandler('workspace-files:duplicate-entry', layer)?.(
      {},
      {
        projectPath: PROJECT_PATH,
        path: 'src/moved.ts',
        targetPath: 'src/copy.ts',
      },
    )
    await registeredHandler('workspace-files:trash-entry', layer)?.(
      {},
      { projectPath: PROJECT_PATH, path: 'src/copy.ts' },
    )

    expect(invalidateGitStatusCacheMock).toHaveBeenCalledTimes(4)
    expect(invalidateGitStatusCacheMock.mock.calls).toEqual([
      [canonicalProjectPath],
      [canonicalProjectPath],
      [canonicalProjectPath],
      [canonicalProjectPath],
    ])
  })
})
