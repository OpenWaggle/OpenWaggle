import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalBanner } from '../ApprovalBanner'
import type { ApprovalResponseAction } from '../pending-tool-interactions'

function renderBanner(
  overrides: {
    toolName?: string
    toolArgs?: string
    onApprovalResponse?: (
      pendingApproval: unknown,
      response: ApprovalResponseAction,
    ) => Promise<void>
  } = {},
) {
  const onApprovalResponse = overrides.onApprovalResponse ?? vi.fn(async () => {})
  render(
    <ApprovalBanner
      toolCallId="tc-1"
      toolName={overrides.toolName ?? 'runCommand'}
      toolArgs={overrides.toolArgs ?? '{"command":"pnpm test"}'}
      approvalId="ap-1"
      onApprovalResponse={onApprovalResponse}
    />,
  )
  return { onApprovalResponse }
}

describe('ApprovalBanner', () => {
  describe('button rendering', () => {
    it('renders 3 buttons for trustable tools', () => {
      renderBanner({ toolName: 'runCommand' })
      expect(screen.getByText('Deny')).toBeInTheDocument()
      expect(screen.getByText('Approve')).toBeInTheDocument()
      expect(screen.getByText('Always approve')).toBeInTheDocument()
    })

    it('renders 2 buttons for non-trustable tools', () => {
      renderBanner({ toolName: 'readFile', toolArgs: '{"path":"foo.txt"}' })
      expect(screen.getByText('Deny')).toBeInTheDocument()
      expect(screen.getByText('Approve')).toBeInTheDocument()
      expect(screen.queryByText('Always approve')).not.toBeInTheDocument()
    })

    it('renders 3 buttons for writeFile', () => {
      renderBanner({ toolName: 'writeFile', toolArgs: '{"path":"out.txt"}' })
      expect(screen.getByText('Always approve')).toBeInTheDocument()
    })

    it('renders 3 buttons for editFile', () => {
      renderBanner({ toolName: 'editFile', toolArgs: '{"path":"src/a.ts"}' })
      expect(screen.getByText('Always approve')).toBeInTheDocument()
    })

    it('renders 3 buttons for webFetch', () => {
      renderBanner({ toolName: 'webFetch', toolArgs: '{"url":"https://example.com/api"}' })
      expect(screen.getByText('Always approve')).toBeInTheDocument()
    })
  })

  describe('action dispatch', () => {
    it('fires deny action', () => {
      const { onApprovalResponse } = renderBanner()
      fireEvent.click(screen.getByText('Deny'))
      expect(onApprovalResponse).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-1', approvalId: 'ap-1' }),
        { kind: 'deny' },
      )
    })

    it('fires approve-once action', () => {
      const { onApprovalResponse } = renderBanner()
      fireEvent.click(screen.getByText('Approve'))
      expect(onApprovalResponse).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-1' }),
        { kind: 'approve-once' },
      )
    })

    it('fires approve-and-trust action', () => {
      const { onApprovalResponse } = renderBanner()
      fireEvent.click(screen.getByText('Always approve'))
      expect(onApprovalResponse).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-1' }),
        { kind: 'approve-and-trust' },
      )
    })
  })

  describe('trust pattern display', () => {
    it('shows derived command pattern for runCommand', () => {
      renderBanner({ toolName: 'runCommand', toolArgs: '{"command":"pnpm test:unit"}' })
      expect(screen.getByText('pnpm test:unit*')).toBeInTheDocument()
    })

    it('shows derived URL pattern for webFetch', () => {
      renderBanner({
        toolName: 'webFetch',
        toolArgs: '{"url":"https://api.example.com/v1/data"}',
      })
      expect(screen.getByText('https://api.example.com/v1/*')).toBeInTheDocument()
    })

    it('shows generic label for writeFile', () => {
      renderBanner({ toolName: 'writeFile', toolArgs: '{"path":"out.txt"}' })
      expect(screen.getByText('All Write File operations')).toBeInTheDocument()
    })

    it('does not show trust pattern hint for non-trustable tools', () => {
      renderBanner({ toolName: 'readFile', toolArgs: '{"path":"foo.txt"}' })
      expect(screen.queryByText(/will remember/)).not.toBeInTheDocument()
    })
  })

  describe('detail display', () => {
    it('shows command in detail block', () => {
      renderBanner({ toolName: 'runCommand', toolArgs: '{"command":"pnpm test"}' })
      expect(screen.getByText('pnpm test')).toBeInTheDocument()
    })

    it('shows file path in detail block', () => {
      renderBanner({ toolName: 'writeFile', toolArgs: '{"path":"src/main.ts"}' })
      expect(screen.getByText('src/main.ts')).toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('disables all buttons while loading', () => {
      const onApprovalResponse = vi.fn(() => new Promise<void>(() => {}))
      renderBanner({ onApprovalResponse })

      fireEvent.click(screen.getByText('Approve'))

      expect(screen.getByText('Deny').closest('button')).toBeDisabled()
      expect(screen.getByText('Approve').closest('button')).toBeDisabled()
      expect(screen.getByText('Always approve').closest('button')).toBeDisabled()
    })
  })
})
