// @vitest-environment jsdom

import type {
  WorkspaceDocumentApplyResult,
  WorkspaceFileReadResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { draftStorageKey } from '../../lib/workspace-draft-journal'
import {
  normalizeWorkspaceLineEndings,
  reopenWorkspaceDocumentWithEncoding,
  saveWorkspaceDocumentWithEncoding,
} from '../workspace-document-fidelity-actions'
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

  it('serializes edits made while saving with another encoding', async () => {
    const encodingSave = Promise.withResolvers<WorkspaceDocumentApplyResult>()
    const file = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      basename: 'file.ts',
      content: 'saved content',
      documentVersion: 2,
      revision: 'saved-revision',
      fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
    })
    let liveContent = file.content
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file,
      queryClient: fromPartial({ setQueryData: vi.fn() }),
      revision: { current: file.revision },
      persistedVersion: { current: file.documentVersion },
      nextVersion: { current: file.documentVersion + 1 },
      latestContent: { current: file.content },
      latestSnapshot: { current: () => liveContent },
      savedContent: { current: file.content },
      saving: { current: false },
      inFlight: { current: null },
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
    applyWorkspaceDocumentEdits.mockReturnValueOnce(encodingSave.promise).mockResolvedValueOnce({
      status: 'saved',
      version: 3,
      size: 26,
      modifiedAt: 3,
      revision: 'edited-revision',
      encoding: 'utf-16le',
      lineEnding: 'lf',
    })

    const saving = saveWorkspaceDocumentWithEncoding(context, 'utf-16le')
    await vi.waitFor(() => expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce())
    liveContent = 'saved content + newer edit'
    recordWorkspaceDocumentChange(
      context,
      [{ rangeOffset: file.content.length, rangeLength: 0, text: ' + newer edit' }],
      () => liveContent,
    )
    expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce()
    encodingSave.resolve({
      status: 'saved',
      version: 2,
      size: 26,
      modifiedAt: 2,
      revision: 'encoded-revision',
      encoding: 'utf-16le',
      lineEnding: 'lf',
    })
    await saving

    expect(applyWorkspaceDocumentEdits).toHaveBeenCalledTimes(2)
    expect(applyWorkspaceDocumentEdits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedRevision: 'encoded-revision',
        baseVersion: 2,
        batches: [
          {
            version: 3,
            changes: [{ rangeOffset: file.content.length, rangeLength: 0, text: ' + newer edit' }],
          },
        ],
      }),
    )
    expect(context.revision.current).toBe('edited-revision')
    expect(context.pending.current).toEqual([])
  })

  it('serializes concurrent line-ending normalization requests', async () => {
    const firstNormalization = Promise.withResolvers<WorkspaceDocumentApplyResult>()
    const secondNormalization = Promise.withResolvers<WorkspaceDocumentApplyResult>()
    const file = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      basename: 'file.ts',
      content: 'first\nsecond\n',
      documentVersion: 2,
      revision: 'saved-revision',
      fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
    })
    let liveContent = file.content
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file,
      queryClient: fromPartial({ setQueryData: vi.fn() }),
      revision: { current: file.revision },
      persistedVersion: { current: file.documentVersion },
      nextVersion: { current: file.documentVersion + 1 },
      latestContent: { current: file.content },
      latestSnapshot: { current: () => liveContent },
      savedContent: { current: file.content },
      saving: { current: false },
      inFlight: { current: null },
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
    applyWorkspaceDocumentEdits
      .mockReturnValueOnce(firstNormalization.promise)
      .mockReturnValueOnce(secondNormalization.promise)

    const normalizingToLf = normalizeWorkspaceLineEndings(context, 'lf')
    await vi.waitFor(() => expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce())
    const normalizingToCrlf = normalizeWorkspaceLineEndings(context, 'crlf')
    expect(applyWorkspaceDocumentEdits).toHaveBeenCalledOnce()

    firstNormalization.resolve({
      status: 'saved',
      version: 3,
      size: file.content.length,
      modifiedAt: 3,
      revision: 'lf-revision',
      encoding: 'utf-8',
      lineEnding: 'lf',
    })
    await normalizingToLf
    await vi.waitFor(() => expect(applyWorkspaceDocumentEdits).toHaveBeenCalledTimes(2))
    liveContent = `${file.content}typed while normalizing`
    recordWorkspaceDocumentChange(
      context,
      [{ rangeOffset: file.content.length, rangeLength: 0, text: 'typed while normalizing' }],
      () => liveContent,
    )
    secondNormalization.resolve({
      status: 'saved',
      version: 4,
      size: file.content.length,
      modifiedAt: 4,
      revision: 'crlf-revision',
      encoding: 'utf-8',
      lineEnding: 'crlf',
    })
    await normalizingToCrlf

    expect(applyWorkspaceDocumentEdits).toHaveBeenCalledTimes(2)
    expect(applyWorkspaceDocumentEdits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedRevision: 'lf-revision',
        baseVersion: 3,
        normalizeLineEnding: 'crlf',
        batches: [expect.objectContaining({ version: 4 })],
      }),
    )
    expect(context.revision.current).toBe('crlf-revision')
    expect(context.latestContent.current).toBe(liveContent)
    expect(context.savedContent.current).toBe(file.content)
    expect(context.pending.current).toEqual([
      {
        version: 5,
        changes: [
          {
            rangeOffset: 0,
            rangeLength: file.content.length,
            text: liveContent,
          },
        ],
      },
    ])
  })
})
