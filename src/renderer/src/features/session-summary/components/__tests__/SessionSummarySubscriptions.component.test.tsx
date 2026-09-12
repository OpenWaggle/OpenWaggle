import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionSummarySubscriptions } from '../SessionSummarySubscriptions'

const listMcpEventSubscriptions = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { listMcpEventSubscriptions },
}))

describe('SessionSummarySubscriptions', () => {
  beforeEach(() => {
    listMcpEventSubscriptions.mockReset()
  })

  it('shows only subscriptions owned by the opened session context', async () => {
    listMcpEventSubscriptions.mockResolvedValue([
      {
        serverInstanceId: 'github',
        serverLabel: 'GitHub',
        active: true,
        mode: 'modern-listen',
        resourceUris: [],
        detail: 'Watching pull request updates',
      },
      {
        serverInstanceId: 'notion',
        serverLabel: 'Notion',
        active: false,
        mode: 'inactive',
        resourceUris: [],
        detail: 'Inactive',
      },
    ])

    renderWithQueryClient(
      <SessionSummarySubscriptions
        sessionId={SessionId('session-1')}
        projectPath="/project"
        visible
        expanded
        onExpandedChange={vi.fn()}
      />,
    )

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Watching pull request updates')).toBeInTheDocument()
    expect(screen.queryByText('Notion')).toBeNull()
    expect(listMcpEventSubscriptions).toHaveBeenCalledWith({
      projectPath: '/project',
      sessionId: 'session-1',
    })
  })

  it('offers an in-place retry without hiding the rest of the summary', async () => {
    listMcpEventSubscriptions
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue([
        {
          serverInstanceId: 'github',
          serverLabel: 'GitHub',
          active: true,
          mode: 'legacy-notifications',
          resourceUris: [],
          detail: 'Receiving notifications',
        },
      ])

    renderWithQueryClient(
      <SessionSummarySubscriptions
        sessionId={SessionId('session-1')}
        projectPath="/project"
        visible
        expanded
        onExpandedChange={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Retry subscriptions' }))
    await waitFor(() => expect(screen.getByText('GitHub')).toBeInTheDocument())
  })
})
