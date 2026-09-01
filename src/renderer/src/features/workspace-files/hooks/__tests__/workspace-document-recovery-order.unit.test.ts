// @vitest-environment jsdom

import type {
  WorkspaceDocumentApplyResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reloadWorkspaceDocument,
  restoreWorkspaceDraftOverDisk,
} from '../workspace-document-recovery-actions'
import type { WorkspaceSaveQueueContext } from '../workspace-save-queue'

const { applyWorkspaceDocumentEdits, readWorkspaceFile } = vi.hoisted(() => ({
  applyWorkspaceDocumentEdits: vi.fn(),
  readWorkspaceFile: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { applyWorkspaceDocumentEdits, readWorkspaceFile },
}))

function createDiskFile() {
  return fromPartial<WorkspaceTextFileReadResult>({
    path: 'src/file.ts',
    basename: 'file.ts',
    content: 'disk',
    documentVersion: 4,
    revision: 'disk-revision',
    fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
  })
}

function createRecoveryContext(file: WorkspaceTextFileReadResult) {
  const setContent = vi.fn()
  const context = fromPartial<WorkspaceSaveQueueContext>({
    projectPath: '/project',
    file,
    queryClient: fromPartial({ setQueryData: vi.fn() }),
    revision: { current: 'recovered-revision' },
    persistedVersion: { current: 3 },
    nextVersion: { current: 4 },
    latestContent: { current: 'recovered draft' },
    latestSnapshot: { current: null },
    savedContent: { current: 'disk' },
    encoding: { current: file.fidelity.encoding },
    inFlight: { current: null },
    pending: { current: [] },
    conflict: { current: true },
    mounted: { current: true },
    setContent,
    setEditorRevision: vi.fn(),
    setSavedContent: vi.fn(),
    setEncoding: vi.fn(),
    setLineEnding: vi.fn(),
    setStatus: vi.fn(),
    setErrorMessage: vi.fn(),
    setConflictDiskContent: vi.fn(),
    setNormalizationRequired: vi.fn(),
    setChangeSequence: vi.fn(),
  })
  return { context, setContent }
}

describe('workspace document recovery action order', () => {
  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEdits.mockReset()
    readWorkspaceFile.mockReset()
  })

  it('runs Keep Draft before a subsequently selected Use Disk action', async () => {
    const disk = createDiskFile()
    const restoredDisk = fromPartial<WorkspaceTextFileReadResult>({
      ...disk,
      content: 'recovered draft',
      documentVersion: 5,
      revision: 'restored-revision',
    })
    const restore = Promise.withResolvers<WorkspaceDocumentApplyResult>()
    readWorkspaceFile.mockResolvedValueOnce(disk).mockResolvedValueOnce(restoredDisk)
    applyWorkspaceDocumentEdits.mockReturnValueOnce(restore.promise)
    const { context, setContent } = createRecoveryContext(disk)

    const keepingDraft = restoreWorkspaceDraftOverDisk(context)
    await vi.waitFor(() => expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce())
    const usingDisk = reloadWorkspaceDocument(context)
    expect(readWorkspaceFile).toHaveBeenCalledOnce()
    restore.resolve({
      status: 'saved',
      version: 5,
      size: 15,
      modifiedAt: 2,
      revision: 'restored-revision',
      encoding: 'utf-8',
      lineEnding: 'lf',
    })
    await keepingDraft
    await usingDisk

    expect(readWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(setContent).toHaveBeenLastCalledWith('recovered draft')
    expect(context.revision.current).toBe('restored-revision')
  })

  it('captures Keep Draft before a preceding Use Disk action completes', async () => {
    const disk = createDiskFile()
    const diskReload = Promise.withResolvers<WorkspaceTextFileReadResult>()
    readWorkspaceFile.mockReturnValueOnce(diskReload.promise).mockResolvedValueOnce(disk)
    applyWorkspaceDocumentEdits.mockResolvedValueOnce({
      status: 'saved',
      version: 5,
      size: 15,
      modifiedAt: 2,
      revision: 'restored-revision',
      encoding: 'utf-8',
      lineEnding: 'lf',
    })
    const { context, setContent } = createRecoveryContext(disk)

    const usingDisk = reloadWorkspaceDocument(context)
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalledOnce())
    const keepingDraft = restoreWorkspaceDraftOverDisk(context)
    diskReload.resolve(disk)
    await usingDisk
    await keepingDraft

    expect(applyWorkspaceDocumentEdits).toHaveBeenCalledWith(
      expect.objectContaining({
        batches: [
          expect.objectContaining({
            changes: [expect.objectContaining({ text: 'recovered draft' })],
          }),
        ],
      }),
    )
    expect(setContent).toHaveBeenLastCalledWith('recovered draft')
    expect(context.revision.current).toBe('restored-revision')
  })
})
