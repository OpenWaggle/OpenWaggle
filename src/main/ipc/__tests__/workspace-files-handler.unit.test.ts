import fs from 'node:fs/promises'
import path from 'node:path'
import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkspaceFileService,
  type WorkspaceFileServiceShape,
} from '../../ports/workspace-file-service'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import { validateAuthorizedProjectPath } from '../../utils/project-path-validation'

const {
  invalidateGitStatusCacheMock,
  listExternalEditorsMock,
  openFileMock,
  searchContentMock,
  searchFilesMock,
  typedHandleMock,
  writeFileMock,
} = vi.hoisted(() => ({
  invalidateGitStatusCacheMock: vi.fn(),
  listExternalEditorsMock: vi.fn(),
  openFileMock: vi.fn(),
  searchContentMock: vi.fn(),
  searchFilesMock: vi.fn(),
  typedHandleMock: vi.fn(),
  writeFileMock: vi.fn(),
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
    searchContent: searchContentMock,
    searchFiles: searchFilesMock,
    writeFile: writeFileMock,
    createEntry: () => Effect.succeed({ path: 'src/new.ts' }),
    moveEntry: () => Effect.succeed({ path: 'src/moved.ts', previousPath: 'src/new.ts' }),
    duplicateEntry: () => Effect.succeed({ path: 'src/copy.ts', previousPath: 'src/moved.ts' }),
    trashEntry: () => Effect.succeed({ path: 'src/copy.ts' }),
  })
  return Layer.mergeAll(
    Layer.succeed(WorkspaceFileService, service),
    Layer.succeed(
      WorkspaceProjectAuthorization,
      WorkspaceProjectAuthorization.of({
        authorize: (projectPath) => validateAuthorizedProjectPath(projectPath, [PROJECT_PATH]),
      }),
    ),
  )
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
    searchContentMock.mockReset()
    searchFilesMock.mockReset()
    writeFileMock.mockReset()
    listExternalEditorsMock.mockReturnValue(
      Effect.succeed([
        { id: 'vscode', label: 'Visual Studio Code' },
        { id: 'zed', label: 'Zed' },
      ]),
    )
    openFileMock.mockReturnValue(Effect.succeed(undefined))
    searchContentMock.mockReturnValue(Effect.succeed([]))
    searchFilesMock.mockReturnValue(Effect.succeed([]))
    writeFileMock.mockReturnValue(Effect.succeed({ status: 'saved' }))
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

  it('rejects an unregistered project root before touching the workspace service', async () => {
    await expect(
      registeredHandler('workspace-files:open-external', mutationLayer())?.(
        {},
        {
          projectPath: path.dirname(PROJECT_PATH),
          path: 'outside.ts',
          editor: 'vscode',
        },
      ),
    ).rejects.toThrow('Project path is not authorized')

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

  it('rejects oversized search queries and content result limits at the IPC boundary', async () => {
    const layer = mutationLayer()

    await expect(
      registeredHandler('workspace-files:search', layer)?.(
        {},
        PROJECT_PATH,
        'x'.repeat(1_025),
        WORKSPACE_FILES.EXPLORER_RESULT_LIMIT,
      ),
    ).rejects.toThrow()
    await expect(
      registeredHandler('workspace-files:search-content', layer)?.(
        {},
        PROJECT_PATH,
        'value',
        WORKSPACE_FILES.CONTENT_RESULT_LIMIT + 1,
      ),
    ).rejects.toThrow()

    expect(searchFilesMock).not.toHaveBeenCalled()
    expect(searchContentMock).not.toHaveBeenCalled()
  })

  it('rejects oversized legacy full-document writes at the IPC boundary', async () => {
    await expect(
      registeredHandler('workspace-files:write', mutationLayer())?.(
        {},
        {
          projectPath: PROJECT_PATH,
          path: 'src/example.ts',
          content: 'x'.repeat(WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES + 1),
          expectedRevision: 'revision-1',
        },
      ),
    ).rejects.toThrow()

    expect(writeFileMock).not.toHaveBeenCalled()
  })
})
