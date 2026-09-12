import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROJECT_ACTION_LIMITS } from '@shared/types/project-actions'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  addProjectActionMock,
  deleteProjectActionMock,
  discoverT3ProjectActionsMock,
  importT3ProjectActionMock,
  listProjectActionsMock,
  updateProjectActionMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  addProjectActionMock: vi.fn(),
  deleteProjectActionMock: vi.fn(),
  discoverT3ProjectActionsMock: vi.fn(),
  importT3ProjectActionMock: vi.fn(),
  listProjectActionsMock: vi.fn(),
  updateProjectActionMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ hostHandle: typedHandleMock }))
vi.mock('../../config/project-actions', () => ({
  addProjectAction: addProjectActionMock,
  deleteProjectAction: deleteProjectActionMock,
  discoverT3ProjectActions: discoverT3ProjectActionsMock,
  importT3ProjectAction: importT3ProjectActionMock,
  listProjectActions: listProjectActionsMock,
  updateProjectAction: updateProjectActionMock,
}))

import { registerProjectActionHandlers } from '../project-actions-handler'

function getRegisteredHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('project action IPC handlers', () => {
  let temporaryRoot: string
  let projectPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    listProjectActionsMock.mockResolvedValue([])
    addProjectActionMock.mockResolvedValue([])
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-actions-ipc-'))
    projectPath = path.join(temporaryRoot, 'project')
    await mkdir(projectPath)
    registerProjectActionHandlers()
  })

  afterEach(async () => {
    await rm(temporaryRoot, { force: true, recursive: true })
  })

  it('registers the complete project action transport', () => {
    expect(typedHandleMock.mock.calls.map((call) => call[0])).toEqual([
      'project-actions:list',
      'project-actions:add',
      'project-actions:update',
      'project-actions:delete',
      'project-actions:discover-t3',
      'project-actions:import-t3',
    ])
  })

  it('canonicalizes a symlinked project path before invoking the core', async () => {
    const aliasPath = path.join(temporaryRoot, 'alias')
    await symlink(projectPath, aliasPath, 'dir')
    const handler = getRegisteredHandler('project-actions:list')

    await handler?.({}, aliasPath)

    expect(listProjectActionsMock).toHaveBeenCalledWith(await realpath(projectPath))
  })

  it('rejects relative and non-directory project paths', async () => {
    const handler = getRegisteredHandler('project-actions:list')

    await expect(handler?.({}, '../outside')).rejects.toThrow('absolute')
    await expect(handler?.({}, path.join(temporaryRoot, 'missing'))).rejects.toThrow()
    expect(listProjectActionsMock).not.toHaveBeenCalled()
  })

  it('rejects oversized and malformed action payloads before the core', async () => {
    const handler = getRegisteredHandler('project-actions:add')

    await expect(
      handler?.({}, projectPath, { name: 'Large', command: 'x'.repeat(8_193) }),
    ).rejects.toThrow('Invalid project action')
    await expect(
      handler?.({}, projectPath, {
        name: 'Extra',
        command: 'safe',
        ignored: 'x'.repeat(PROJECT_ACTION_LIMITS.IPC_PAYLOAD_BYTES + 1),
      }),
    ).rejects.toThrow('exceeds')
    await expect(handler?.({}, projectPath, { name: '   ', command: 'safe' })).rejects.toThrow(
      'Invalid project action',
    )
    expect(addProjectActionMock).not.toHaveBeenCalled()
  })

  it('rejects hostile ids and t3 indexes before mutation', async () => {
    const deleteHandler = getRegisteredHandler('project-actions:delete')
    const importHandler = getRegisteredHandler('project-actions:import-t3')

    await expect(deleteHandler?.({}, projectPath, '../../settings')).rejects.toThrow(
      'Invalid project action id',
    )
    await expect(importHandler?.({}, projectPath, 50)).rejects.toThrow(
      'Invalid t3.json action index',
    )
    expect(deleteProjectActionMock).not.toHaveBeenCalled()
    expect(importT3ProjectActionMock).not.toHaveBeenCalled()
  })
})
