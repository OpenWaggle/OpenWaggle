import { SessionId } from '@shared/types/brand'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangedFilesCard } from '../ChangedFilesCard'

const mockGetTurnDiffFiles = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { getTurnDiffFiles: mockGetTurnDiffFiles },
}))

vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: vi.fn() }),
}))

function turn(overrides: Partial<TurnCheckpointSummary> = {}): TurnCheckpointSummary {
  return {
    turnId: 'turn-1',
    turnIndex: 0,
    createdAt: 1000,
    startedAt: 0,
    insertions: 60,
    deletions: 12,
    anchorNodeId: 'anchor-1',
    ...overrides,
  }
}

beforeEach(() => {
  mockGetTurnDiffFiles.mockResolvedValue([{ path: 'src/a.ts', additions: 9, deletions: 1 }])
})

function renderCard(overrides: Partial<Parameters<typeof ChangedFilesCard>[0]> = {}) {
  const onOpenTurnDiff = vi.fn()
  render(
    <ChangedFilesCard
      sessionId={SessionId('session-1')}
      turn={turn()}
      isLatestTurn
      anchorMessageId="anchor-1"
      onOpenTurnDiff={onOpenTurnDiff}
      {...overrides}
    />,
  )
  return onOpenTurnDiff
}

describe('ChangedFilesCard', () => {
  it('auto-expands the latest small turn to show every file row', async () => {
    mockGetTurnDiffFiles.mockResolvedValue([
      { path: 'src/a.ts', additions: 30, deletions: 6 },
      { path: 'docs/readme.md', additions: 30, deletions: 6 },
    ])
    renderCard()

    await waitFor(() => expect(screen.getByTestId('changed-files-card')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^a\.ts/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^readme\.md/ })).toBeInTheDocument()
  })

  it('collapses big latest turns to the scope preview with a Show all button', async () => {
    mockGetTurnDiffFiles.mockResolvedValue([
      { path: 'src/a.ts', additions: 90, deletions: 40 },
      { path: 'src/b.ts', additions: 90, deletions: 40 },
      { path: 'src/c.ts', additions: 90, deletions: 40 },
      { path: 'docs/readme.md', additions: 90, deletions: 40 },
    ])
    renderCard({ isLatestTurn: true })

    await waitFor(() => expect(screen.getByTestId('changed-files-card')).toBeInTheDocument())
    expect(screen.getByText('Show all 4 files')).toBeInTheDocument()
    // Preview chips are visible, full rows are not.
    expect(screen.getByTitle('src/a.ts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'src/c.ts' })).not.toBeInTheDocument()
  })

  it('renders older turns collapsed to the header only', async () => {
    mockGetTurnDiffFiles.mockResolvedValue([
      { path: 'src/a.ts', additions: 30, deletions: 6 },
      { path: 'docs/readme.md', additions: 30, deletions: 6 },
    ])
    renderCard({ isLatestTurn: false })

    await waitFor(() => expect(screen.getByTestId('changed-files-card')).toBeInTheDocument())
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
    expect(screen.queryByTitle('src/a.ts')).not.toBeInTheDocument()
  })

  it('renders nothing when the turn has no files', async () => {
    mockGetTurnDiffFiles.mockResolvedValue([])
    renderCard()

    await waitFor(() => expect(mockGetTurnDiffFiles).toHaveBeenCalled())
    expect(screen.queryByTestId('changed-files-card')).not.toBeInTheDocument()
  })

  it('opens the turn diff focused on the clicked file', async () => {
    mockGetTurnDiffFiles.mockResolvedValue([{ path: 'src/a.ts', additions: 3, deletions: 1 }])
    const onOpenTurnDiff = renderCard()

    const fileRow = await screen.findByRole('button', { name: /^a\.ts/ })
    fireEvent.click(fileRow)

    expect(onOpenTurnDiff).toHaveBeenCalledWith('anchor-1', 'src/a.ts')
  })

  it('renders nothing and recovers when the summary fetch fails', async () => {
    mockGetTurnDiffFiles.mockRejectedValue(new Error('db closed'))
    renderCard()

    await waitFor(() => expect(mockGetTurnDiffFiles).toHaveBeenCalled())
    expect(screen.queryByTestId('changed-files-card')).not.toBeInTheDocument()
  })
})
