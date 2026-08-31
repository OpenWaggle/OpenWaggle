// @vitest-environment jsdom

import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/queries/query-keys'
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
})
