// @vitest-environment jsdom

import type {
  WorkspaceDocumentApplyResult,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeWorkspaceLineEndings } from '../workspace-document-fidelity-actions'
import {
  recordWorkspaceDocumentChange,
  type WorkspaceSaveQueueContext,
} from '../workspace-save-queue'

const { applyWorkspaceDocumentEdits } = vi.hoisted(() => ({
  applyWorkspaceDocumentEdits: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { applyWorkspaceDocumentEdits },
}))

describe('workspace document normalization actions', () => {
  beforeEach(() => {
    window.localStorage.clear()
    applyWorkspaceDocumentEdits.mockReset()
  })

  it('serializes requests and preserves edits made during queued normalization', async () => {
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
      encoding: { current: file.fidelity.encoding },
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
      encoding: 'utf-16le',
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

    expect(applyWorkspaceDocumentEdits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedRevision: 'lf-revision',
        baseVersion: 3,
        normalizeLineEnding: 'crlf',
        targetEncoding: 'utf-16le',
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
