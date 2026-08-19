import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDiffSectionState } from '@/features/chat/model'
import { useUIStore } from '@/shell/ui-store'
import { ChatDiffPane } from '../ChatDiffPane'

/**
 * A stand-in panel that reports the token it was given, so the difference between passing the
 * refresh key as data and remounting on it is visible.
 *
 * The fix under test is one attribute: `refreshToken=` rather than `key=`. Every existing stub
 * ignored both, so restoring the remount left the suite green while each refresh again destroyed the
 * scroll position, the navigator's collapsed folders and a commit message being typed - and refreshes
 * fire on every turn end, every working-tree broadcast and every window focus.
 */
vi.mock('@/features/diff-panel/components', () => ({
  DiffPanel: ({ refreshToken }: { readonly refreshToken?: number }) => (
    <div data-testid="diff-panel">token {String(refreshToken)}</div>
  ),
}))

function diffSection(): ChatDiffSectionState {
  return {
    workingPath: WorkingPath('/repo'),
    repositoryPath: RepositoryPath('/repo'),
    sessionId: SessionId('session-a'),
    onSendMessage: async () => {},
  }
}

describe('ChatDiffPane refresh', () => {
  beforeEach(() => {
    useUIStore.setState({ diffRefreshKey: 1 })
  })

  it('passes the refresh key as data rather than remounting the panel', () => {
    const { container, rerender } = render(
      <ChatDiffPane section={diffSection()} onClose={vi.fn()} />,
    )
    const firstNode = container.querySelector('[data-testid="diff-panel"]')
    expect(screen.getByTestId('diff-panel')).toHaveTextContent('token 1')

    useUIStore.setState({ diffRefreshKey: 2 })
    rerender(<ChatDiffPane section={diffSection()} onClose={vi.fn()} />)

    // The same DOM node survived the refresh, and the new token reached the panel as a prop.
    expect(container.querySelector('[data-testid="diff-panel"]')).toBe(firstNode)
    expect(screen.getByTestId('diff-panel')).toHaveTextContent('token 2')
  })
})
