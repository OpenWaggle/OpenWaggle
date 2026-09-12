import { SessionId, SessionNodeId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { BranchSummaryPrompt } from '@/features/composer/components'
import { useUIStore } from '@/shell/ui-store'
import { renderViewer, resetViewerEnvironment } from './session-resource-viewer.test-harness'

describe('SessionResourceViewer Escape ordering', () => {
  beforeEach(resetViewerEnvironment)
  afterEach(() => useBranchSummaryStore.getState().clearPrompt())

  it('closes the foreground image before cancelling the background branch prompt', async () => {
    const cancel = vi.fn(() => useBranchSummaryStore.getState().clearPrompt())
    render(
      <BranchSummaryPrompt
        onCancel={cancel}
        onNoSummary={vi.fn()}
        onSummarize={vi.fn()}
        onCustomSummary={vi.fn()}
      />,
    )
    renderViewer('session-1')
    act(() => {
      useBranchSummaryStore.getState().openPrompt({
        sessionId: SessionId('session-1'),
        sourceNodeId: SessionNodeId('source-node'),
        restoreSelection: { branchId: null, nodeId: null },
        previousComposerText: 'Previous draft',
        draftComposerText: 'New branch draft',
      })
    })
    expect(screen.getByText('Branch summary')).toBeVisible()
    act(() => useUIStore.getState().openResourceViewer('session-1', 'image-1'))
    const dialog = await screen.findByRole('dialog', { name: 'Image viewer: first.png' })

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(useUIStore.getState().resourceViewer).toBeNull())
    expect(cancel).not.toHaveBeenCalled()
    expect(useBranchSummaryStore.getState().prompt?.draftComposerText).toBe('New branch draft')
    expect(screen.getByText('Branch summary')).toBeVisible()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(useBranchSummaryStore.getState().prompt).toBeNull()
  })
})
