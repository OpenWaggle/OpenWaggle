import { SessionId, SessionNodeId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { BranchSummaryPrompt } from '../BranchSummaryPrompt'

const SESSION_ID = SessionId('session-1')
const SOURCE_NODE_ID = SessionNodeId('node-1')

function openPrompt(): void {
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    sourceNodeId: SOURCE_NODE_ID,
    restoreSelection: { branchId: null, nodeId: null },
    previousComposerText: 'existing prompt',
    draftComposerText: 'branch prompt',
  })
}

function renderPrompt() {
  const onNoSummary = vi.fn()
  const onSummarize = vi.fn()
  const onCustomSummary = vi.fn()
  const onCancel = vi.fn()

  render(
    <BranchSummaryPrompt
      onNoSummary={onNoSummary}
      onSummarize={onSummarize}
      onCustomSummary={onCustomSummary}
      onCancel={onCancel}
    />,
  )

  return { onNoSummary, onSummarize, onCustomSummary, onCancel }
}

describe('BranchSummaryPrompt', () => {
  beforeEach(() => {
    useBranchSummaryStore.setState(useBranchSummaryStore.getInitialState())
  })

  it('renders no controls when no branch summary prompt is active', () => {
    renderPrompt()

    expect(screen.queryByText('Branch summary')).not.toBeInTheDocument()
  })

  it('offers no-summary, summarize, custom, and cancel choices', () => {
    openPrompt()
    const handlers = renderPrompt()

    fireEvent.click(screen.getByRole('button', { name: 'No summary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handlers.onNoSummary).toHaveBeenCalledOnce()
    expect(handlers.onSummarize).toHaveBeenCalledOnce()
    expect(handlers.onCustomSummary).toHaveBeenCalledOnce()
    expect(handlers.onCancel).toHaveBeenCalledOnce()
  })

  it('explains that custom instructions use the composer input', () => {
    openPrompt()
    useBranchSummaryStore.getState().startCustomPrompt('branch prompt')

    renderPrompt()

    expect(
      screen.getByText(/write custom summary instructions in the composer/i),
    ).toBeInTheDocument()
  })
})
