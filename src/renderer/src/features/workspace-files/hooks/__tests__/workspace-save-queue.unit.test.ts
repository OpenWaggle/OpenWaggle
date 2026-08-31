// @vitest-environment jsdom

import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  captureWorkspaceDocumentSnapshot,
  flushWorkspaceEdits,
  initialSaveQueueState,
  persistPendingJournal,
  recordWorkspaceDocumentChange,
  takeWorkspaceEditBatchesForSave,
  type WorkspaceSaveQueueContext,
} from '../workspace-save-queue'

const { applyWorkspaceDocumentEdits } = vi.hoisted(() => ({
  applyWorkspaceDocumentEdits: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { applyWorkspaceDocumentEdits } }))
vi.mock('@/shell/ui-store', () => ({
  useUIStore: { getState: () => ({ showToast: vi.fn() }) },
}))

function contextFixture() {
  return fromPartial<WorkspaceSaveQueueContext>({
    projectPath: '/project',
    file: {
      path: 'src/file.ts',
      basename: 'file.ts',
      fidelity: { encoding: 'utf-8', lineEnding: 'lf' },
    },
    queryClient: { setQueryData: vi.fn() },
    conflict: { current: false },
    inFlight: { current: null },
    latestContent: { current: 'before' },
    latestSnapshot: { current: null },
    mounted: { current: true },
    nextVersion: { current: 1 },
    pending: { current: [] },
    persistedVersion: { current: 0 },
    revision: { current: 'revision-1' },
    savedContent: { current: 'before' },
    saving: { current: false },
    setChangeSequence: vi.fn(),
    setContent: vi.fn(),
    setSavedContent: vi.fn(),
    setEncoding: vi.fn(),
    setErrorMessage: vi.fn(),
    setLineEnding: vi.fn(),
    setStatus: vi.fn(),
  })
}

describe('workspace save queue hot path', () => {
  it('preserves a recovered draft when the disk baseline changed', () => {
    const file = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      content: 'disk',
      revision: 'disk-revision',
      documentVersion: 0,
    })
    const state = initialSaveQueueState(file, {
      baselineRevision: 'old-revision',
      baseVersion: 8,
      content: 'recovered draft',
      batches: [],
      conflicted: false,
    })

    expect(state).toMatchObject({
      recoveredOnSameBaseline: false,
      content: 'recovered draft',
      status: 'conflict',
      batches: [],
      lastVersion: 0,
    })
  })

  it('rebases same-baseline recovery into one replacement batch for a new session', () => {
    const file = fromPartial<WorkspaceTextFileReadResult>({
      path: 'src/file.ts',
      content: 'saved prefix',
      revision: 'revision-2',
      documentVersion: 0,
    })
    const state = initialSaveQueueState(file, {
      baselineRevision: 'revision-2',
      baseVersion: 9,
      content: 'saved prefix and pending suffix',
      batches: [{ version: 10, changes: [] }],
      conflicted: false,
    })

    expect(state.batches).toEqual([
      {
        version: 1,
        changes: [
          {
            rangeOffset: 0,
            rangeLength: 'saved prefix'.length,
            text: 'saved prefix and pending suffix',
          },
        ],
      },
    ])
  })

  it('does not delete a conflicted journal when no edit batches are pending', () => {
    window.localStorage.clear()
    const context = fromPartial<WorkspaceSaveQueueContext>({
      projectPath: '/project',
      file: { path: 'src/file.ts' },
      conflict: { current: true },
      latestContent: { current: 'disk' },
      latestSnapshot: { current: null },
      mounted: { current: true },
      pending: { current: [] },
      persistedVersion: { current: 0 },
      revision: { current: 'old' },
      savedContent: { current: 'disk' },
      setContent: vi.fn(),
      setErrorMessage: vi.fn(),
    })

    persistPendingJournal(context)

    expect(window.localStorage.length).toBe(1)
    expect(window.localStorage.key(0)).toContain('src%2Ffile.ts')
  })

  it('records editor deltas without reading or copying the full model on every edit', () => {
    const context = contextFixture()
    const readSource = vi.fn(() => 'after')
    recordWorkspaceDocumentChange(
      context,
      [{ rangeOffset: 0, rangeLength: 6, text: 'after' }],
      readSource,
    )

    expect(readSource).not.toHaveBeenCalled()
    expect(context.pending.current).toEqual([
      { version: 1, changes: [{ rangeOffset: 0, rangeLength: 6, text: 'after' }] },
    ])
    expect(context.setStatus).toHaveBeenCalledWith('dirty')
  })

  it('captures one full snapshot only at a save, preview, or recovery boundary', () => {
    const context = contextFixture()
    const readSource = vi.fn(() => 'after')
    context.latestSnapshot.current = readSource

    expect(captureWorkspaceDocumentSnapshot(context)).toBe('after')
    expect(readSource).toHaveBeenCalledOnce()
    expect(context.latestContent.current).toBe('after')
    expect(context.setContent).toHaveBeenCalledWith('after')
  })

  it('compacts an oversized edit backlog into one full-document save batch', () => {
    const context = contextFixture()
    context.persistedVersion.current = 4
    context.nextVersion.current = 1_006
    context.pending.current = Array.from({ length: 1_001 }, (_, index) => ({
      version: index + 5,
      changes: [{ rangeOffset: index, rangeLength: 0, text: 'x' }],
    }))

    expect(takeWorkspaceEditBatchesForSave(context, 'after paste')).toEqual([
      {
        version: 5,
        changes: [{ rangeOffset: 0, rangeLength: 6, text: 'after paste' }],
      },
    ])
    expect(context.pending.current).toEqual([])
    expect(context.nextVersion.current).toBe(6)
  })

  it('compacts a batch that exceeds the IPC per-batch change limit', () => {
    const context = contextFixture()
    context.pending.current = [
      {
        version: 1,
        changes: Array.from(
          { length: WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT + 1 },
          () => ({ rangeOffset: 0, rangeLength: 0, text: 'x' }),
        ),
      },
    ]

    expect(takeWorkspaceEditBatchesForSave(context, 'after')).toEqual([
      {
        version: 1,
        changes: [{ rangeOffset: 0, rangeLength: 6, text: 'after' }],
      },
    ])
  })

  it('compacts queued inserts that exceed the IPC aggregate text limit', () => {
    const context = contextFixture()
    const chunk = 'x'.repeat(WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT / 2 + 1)
    context.pending.current = [
      {
        version: 1,
        changes: [
          { rangeOffset: 0, rangeLength: 0, text: chunk },
          { rangeOffset: 0, rangeLength: 0, text: chunk },
        ],
      },
    ]

    expect(takeWorkspaceEditBatchesForSave(context, 'after')).toEqual([
      {
        version: 1,
        changes: [{ rangeOffset: 0, rangeLength: 6, text: 'after' }],
      },
    ])
  })

  it('rejects a coordinated flush while the file has an unresolved conflict', async () => {
    const context = contextFixture()
    context.conflict.current = true

    await expect(flushWorkspaceEdits(context)).rejects.toThrow(
      'Resolve the file conflict before continuing.',
    )
    expect(applyWorkspaceDocumentEdits).not.toHaveBeenCalled()
  })

  it('preserves pending edits and rejects when persistence reports a conflict', async () => {
    const context = contextFixture()
    context.latestContent.current = 'after'
    context.pending.current = [
      { version: 1, changes: [{ rangeOffset: 0, rangeLength: 6, text: 'after' }] },
    ]
    applyWorkspaceDocumentEdits.mockResolvedValueOnce({
      status: 'conflict',
      message: 'The disk revision changed.',
    })

    await expect(flushWorkspaceEdits(context)).rejects.toThrow('The disk revision changed.')
    expect(context.pending.current).toHaveLength(1)
    expect(context.conflict.current).toBe(true)
    expect(context.setStatus).toHaveBeenCalledWith('conflict')
  })
})
