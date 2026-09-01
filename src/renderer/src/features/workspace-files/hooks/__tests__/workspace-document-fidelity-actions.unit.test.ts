// @vitest-environment jsdom

import type {
  WorkspaceFileReadResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draftStorageKey } from '../../lib/workspace-draft-journal'
import { reopenWorkspaceDocumentWithEncoding } from '../workspace-document-fidelity-actions'
import {
  recordWorkspaceDocumentChange,
  type WorkspaceSaveQueueContext,
} from '../workspace-save-queue'

const { applyWorkspaceDocumentEdits, readWorkspaceFileWithEncoding } = vi.hoisted(() => ({
  applyWorkspaceDocumentEdits: vi.fn(),
  readWorkspaceFileWithEncoding: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { applyWorkspaceDocumentEdits, readWorkspaceFileWithEncoding },
}))

describe('workspace document fidelity actions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEdits.mockReset()
    readWorkspaceFileWithEncoding.mockReset()
  })

  it('preserves edits made while reopening with another encoding', async () => {
    const reopened = Promise.withResolvers<WorkspaceFileReadResult>()
    const file = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      basename: 'file.ts',
      content: 'saved content',
      documentVersion: 2,
      revision: 'saved-revision',
      fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
    })
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file,
      queryClient: fromPartial({ setQueryData: vi.fn() }),
      revision: { current: file.revision },
      persistedVersion: { current: file.documentVersion },
      nextVersion: { current: file.documentVersion + 1 },
      latestContent: { current: file.content },
      latestSnapshot: { current: () => file.content },
      savedContent: { current: file.content },
      pending: { current: [] },
      conflict: { current: false },
      mounted: { current: true },
      setContent: vi.fn(),
      setEditorRevision: vi.fn(),
      setSavedContent: vi.fn(),
      setStatus: vi.fn(),
      setErrorMessage: vi.fn(),
      setConflictDiskContent: vi.fn(),
      setNormalizationRequired: vi.fn(),
      setEncoding: vi.fn(),
      setLineEnding: vi.fn(),
      setChangeSequence: vi.fn(),
    })
    readWorkspaceFileWithEncoding.mockReturnValueOnce(reopened.promise)

    const reopening = reopenWorkspaceDocumentWithEncoding(context, 'utf-16le')
    await vi.waitFor(() => expect(readWorkspaceFileWithEncoding).toHaveBeenCalledOnce())
    recordWorkspaceDocumentChange(
      context,
      [{ rangeOffset: file.content.length, rangeLength: 0, text: ' + newer edit' }],
      () => 'saved content + newer edit',
    )
    reopened.resolve(
      fromPartial<WorkspaceTextFileReadResult>({
        ...file,
        content: 'decoded disk content',
        revision: 'decoded-revision',
        fidelity: { ...file.fidelity, encoding: 'utf-16le' },
      }),
    )

    await expect(reopening).rejects.toThrow('Your newer edits were kept')
    expect(context.revision.current).toBe('saved-revision')
    expect(context.pending.current).toHaveLength(1)
    expect(context.setContent).not.toHaveBeenCalledWith('decoded disk content')
    expect(window.localStorage.getItem(draftStorageKey('/project', file.path))).toContain(
      'saved content + newer edit',
    )
  })
})
