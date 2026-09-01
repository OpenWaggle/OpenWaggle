// @vitest-environment jsdom

import type {
  WorkspaceDocumentApplyResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/queries/query-keys'
import { draftStorageKey } from '../../lib/workspace-draft-journal'
import { restoreWorkspaceDraftOverDisk } from '../workspace-document-recovery-actions'
import type { WorkspaceSaveQueueContext } from '../workspace-save-queue'

const { applyWorkspaceDocumentEdits, readWorkspaceFile } = vi.hoisted(() => ({
  applyWorkspaceDocumentEdits: vi.fn(),
  readWorkspaceFile: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { applyWorkspaceDocumentEdits, readWorkspaceFile },
}))

describe('workspace document recovery actions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEdits.mockReset()
    readWorkspaceFile.mockReset()
  })

  it('uses the saved fidelity in the editor state and workspace-file cache after restoring a draft', async () => {
    const disk = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      basename: 'file.ts',
      content: 'disk',
      documentVersion: 4,
      revision: 'disk-revision',
      fidelity: {
        encoding: 'utf-16le',
        lineEnding: 'crlf',
        finalNewline: false,
        indentStyle: 'space',
        indentSize: 2,
        editorConfigApplied: true,
      },
    })
    readWorkspaceFile.mockResolvedValueOnce(disk)
    applyWorkspaceDocumentEdits.mockResolvedValueOnce({
      status: 'saved',
      version: 5,
      size: 12,
      modifiedAt: 2,
      revision: 'saved-revision',
      encoding: 'utf-8-bom',
      lineEnding: 'lf',
    })
    const queryClient = { setQueryData: vi.fn() }
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file: disk,
      queryClient,
      revision: { current: 'recovered-revision' },
      persistedVersion: { current: 3 },
      nextVersion: { current: 4 },
      latestContent: { current: 'recovered draft' },
      latestSnapshot: { current: null },
      savedContent: { current: 'disk' },
      pending: { current: [] },
      conflict: { current: true },
      mounted: { current: true },
      setContent: vi.fn(),
      setEditorRevision: vi.fn(),
      setSavedContent: vi.fn(),
      setEncoding: vi.fn(),
      setLineEnding: vi.fn(),
      setStatus: vi.fn(),
      setErrorMessage: vi.fn(),
      setConflictDiskContent: vi.fn(),
    })

    await restoreWorkspaceDraftOverDisk(context)

    expect(context.setEncoding).toHaveBeenCalledWith('utf-8-bom')
    expect(context.setLineEnding).toHaveBeenCalledWith('lf')
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      queryKeys.workspaceFile('/project', 'src/file.ts'),
      expect.objectContaining({
        content: 'recovered draft',
        documentVersion: 5,
        revision: 'saved-revision',
        fidelity: expect.objectContaining({ encoding: 'utf-8-bom', lineEnding: 'lf' }),
      }),
    )
  })

  it('preserves edits made while a conflicted draft is being restored', async () => {
    const disk = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      basename: 'file.ts',
      content: 'disk',
      documentVersion: 4,
      revision: 'disk-revision',
      fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
    })
    const save = Promise.withResolvers<WorkspaceDocumentApplyResult>()
    readWorkspaceFile.mockResolvedValueOnce(disk)
    applyWorkspaceDocumentEdits.mockReturnValueOnce(save.promise)
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file: disk,
      queryClient: fromPartial({ setQueryData: vi.fn() }),
      revision: { current: 'recovered-revision' },
      persistedVersion: { current: 3 },
      nextVersion: { current: 4 },
      latestContent: { current: 'recovered draft' },
      latestSnapshot: { current: () => 'recovered draft' },
      savedContent: { current: 'disk' },
      pending: { current: [] },
      conflict: { current: true },
      mounted: { current: true },
      setContent: vi.fn(),
      setEditorRevision: vi.fn(),
      setSavedContent: vi.fn(),
      setEncoding: vi.fn(),
      setLineEnding: vi.fn(),
      setStatus: vi.fn(),
      setErrorMessage: vi.fn(),
      setConflictDiskContent: vi.fn(),
      setChangeSequence: vi.fn(),
    })

    const restoring = restoreWorkspaceDraftOverDisk(context)
    await vi.waitFor(() => expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce())
    context.latestSnapshot.current = () => 'recovered draft + typed while saving'
    save.resolve({
      status: 'saved',
      version: 5,
      size: 15,
      modifiedAt: 2,
      revision: 'saved-revision',
      encoding: 'utf-8',
      lineEnding: 'lf',
    })
    await restoring

    expect(context.latestContent.current).toBe('recovered draft + typed while saving')
    expect(context.savedContent.current).toBe('recovered draft')
    expect(context.pending.current).toEqual([
      {
        version: 6,
        changes: [
          {
            rangeOffset: 0,
            rangeLength: 'recovered draft'.length,
            text: 'recovered draft + typed while saving',
          },
        ],
      },
    ])
    expect(context.setContent).toHaveBeenLastCalledWith('recovered draft + typed while saving')
    expect(context.setStatus).toHaveBeenLastCalledWith('dirty')
    expect(context.setChangeSequence).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(draftStorageKey('/project', 'src/file.ts'))).toContain(
      'recovered draft + typed while saving',
    )
  })
})
