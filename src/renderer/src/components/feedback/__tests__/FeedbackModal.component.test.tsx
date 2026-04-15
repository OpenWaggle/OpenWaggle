import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores/ui-store'

// Mock IPC
const mockCheckGhCli = vi.fn()
const mockCollectDiagnostics = vi.fn()
const mockSubmitFeedback = vi.fn()
const mockGenerateFeedbackMarkdown = vi.fn()
const mockCopyToClipboard = vi.fn()
const mockOpenExternal = vi.fn()

vi.mock('@/lib/ipc', () => ({
  api: {
    checkGhCli: (...args: unknown[]) => mockCheckGhCli(...args),
    collectDiagnostics: (...args: unknown[]) => mockCollectDiagnostics(...args),
    submitFeedback: (...args: unknown[]) => mockSubmitFeedback(...args),
    generateFeedbackMarkdown: (...args: unknown[]) => mockGenerateFeedbackMarkdown(...args),
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}))

vi.mock('@/stores/preferences-store', () => ({
  usePreferencesStore: (selector: (state: { settings: { selectedModel: string } }) => unknown) =>
    selector({ settings: { selectedModel: 'claude-sonnet-4-20250514' } }),
}))

import { FeedbackModal } from '../FeedbackModal'

describe('FeedbackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckGhCli.mockResolvedValue({ available: true, authenticated: true })
    mockCollectDiagnostics.mockResolvedValue({
      os: 'macOS 24.3.0',
      appVersion: '0.1.0',
      electronVersion: '33.0.0',
      nodeVersion: '24.0.0',
      arch: 'arm64',
    })
    mockSubmitFeedback.mockResolvedValue({
      success: true,
      issueUrl: 'https://github.com/openwaggle/openwaggle/issues/1',
    })
    mockGenerateFeedbackMarkdown.mockResolvedValue('## Description\n\nTest')
    mockOpenExternal.mockResolvedValue(undefined)

    // Open the feedback modal
    act(() => {
      useUIStore.getState().openFeedbackModal()
    })
  })

  it('renders the modal with title and form fields', () => {
    render(<FeedbackModal />)

    expect(screen.getByText('Report Issue')).toBeDefined()
    expect(screen.getByPlaceholderText('Brief summary of the issue')).toBeDefined()
    expect(screen.getByPlaceholderText(/Steps to reproduce/)).toBeDefined()
  })

  it('renders category buttons', () => {
    render(<FeedbackModal />)

    expect(screen.getByText('Bug')).toBeDefined()
    expect(screen.getByText('Feature')).toBeDefined()
    expect(screen.getByText('Question')).toBeDefined()
  })

  it('renders attachment toggle checkboxes', () => {
    render(<FeedbackModal />)

    expect(screen.getByText('System info (OS, versions)')).toBeDefined()
    expect(screen.getByText('Recent logs (last 100 lines)')).toBeDefined()
    expect(screen.getByText('Last error context')).toBeDefined()
    expect(screen.getByText('Last user message')).toBeDefined()
    expect(screen.getByText('Model & provider info')).toBeDefined()
  })

  it('renders footer buttons', () => {
    render(<FeedbackModal />)

    expect(screen.getByText('Cancel')).toBeDefined()
    expect(screen.getByText('Copy & Open GitHub')).toBeDefined()
    expect(screen.getByText('Submit Issue')).toBeDefined()
  })

  it('disables Submit Issue when title is empty', () => {
    render(<FeedbackModal />)

    const submitBtn = screen.getByText('Submit Issue')
    expect(submitBtn.closest('button')?.disabled).toBe(true)
  })

  it('closes modal on escape key', () => {
    render(<FeedbackModal />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useUIStore.getState().feedbackModalOpen).toBe(false)
  })

  it('closes modal on cancel button', () => {
    // Re-open
    act(() => {
      useUIStore.getState().openFeedbackModal()
    })

    render(<FeedbackModal />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(useUIStore.getState().feedbackModalOpen).toBe(false)
  })

  it('pre-fills from error context', () => {
    act(() => {
      useUIStore.getState().openFeedbackModal({
        code: 'rate-limited',
        message: 'Too many requests to provider',
        userMessage: 'Rate limited by provider',
        suggestion: 'Wait a moment and try again.',
        retryable: true,
      })
    })

    render(<FeedbackModal />)

    const titleInput = screen.getByPlaceholderText('Brief summary of the issue') as HTMLInputElement
    expect(titleInput.value).toBe('Rate limited by provider')
  })
})
