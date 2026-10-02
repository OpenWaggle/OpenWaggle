import { SessionId } from '@shared/types/brand'
import type { SessionFollowUpSource } from '@shared/types/session-control-queue'
import { render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { useSessionStore } from '@/features/sessions/state'
import { QueuedMessages } from '../QueuedMessages'

const SESSION = SessionId('session-a')

const queueMock = vi.hoisted(() => {
  const items: SessionFollowUpQueueItem[] = []
  return {
    snapshot: { state: 'running', revision: 0, activeRunId: 'run-1', items, waitingOnEdit: false },
  }
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: vi.fn(),
    withdraw: vi.fn(),
    setPaused: vi.fn(),
  }),
}))

function queue(item: Partial<SessionFollowUpQueueItem>) {
  queueMock.snapshot.items = [
    {
      id: 'follow-up-1',
      text: 'queued',
      attachmentCount: 0,
      createdAt: 1,
      deliveryState: 'pending',
      attachments: [],
      editable: false,
      ...item,
    },
  ]
}

function renderQueue() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming={false} onToast={vi.fn()} />,
  )
}

describe('QueuedMessages sources and intent badges', () => {
  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState())
    queueMock.snapshot.items = []
  })

  it('shows a queued Waggle invocation but no thinking level or access, which are Session settings', () => {
    queue({
      text: 'cross-check this',
      wagglePresetName: 'Release review',
      waggleSource: 'user',
      source: { callerId: 'gui:local-user' },
    })
    renderQueue()

    expect(screen.getByText('Waggle · Release review')).toBeVisible()
    expect(screen.queryByText('YOLO access')).not.toBeInTheDocument()
    expect(screen.queryByText('Ask for approval')).not.toBeInTheDocument()
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument()
  })

  it('labels no source for a message sent from the desktop composer', () => {
    queue({ text: 'mine', source: { callerId: 'gui:local-user' } })
    renderQueue()

    expect(screen.getByText('mine')).toBeVisible()
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument()
  })

  it.each([
    [
      'an agent Session by its title',
      { callerId: 'session-agent:session-release:run-1', sessionId: 'session-release' },
      'From Release prep',
      'Queued by session-agent:session-release:run-1\nSession: Release prep (session-release)',
    ],
    [
      'an agent Session missing from the catalog',
      { callerId: 'session-agent:session-gone:run-1', sessionId: 'session-gone' },
      'From another Session',
      'Queued by session-agent:session-gone:run-1\nSession: session-gone',
    ],
    [
      'a local CLI user',
      { callerId: 'local-user:machine' },
      'From CLI',
      'Queued by local-user:machine',
    ],
    [
      'a named CLI profile',
      { callerId: 'profile:profile-ci', profileName: 'ci-bot' },
      'From CLI profile: ci-bot',
      'Queued by profile:profile-ci\nCLI profile: ci-bot',
    ],
    [
      'a CLI profile without a known name',
      { callerId: 'profile:profile-ci' },
      'From CLI profile',
      'Queued by profile:profile-ci',
    ],
    ['MCP', { callerId: 'transient-mcp:client-1' }, 'From MCP', 'Queued by transient-mcp:client-1'],
  ] as const satisfies readonly (readonly [string, SessionFollowUpSource, string, string])[])(
    'names %s and shows the full source on hover',
    (_name, source, label, detail) => {
      useSessionStore.setState({
        sessions: [fromPartial({ id: SessionId('session-release'), title: 'Release prep' })],
      })
      queue({ text: 'from elsewhere', source })
      renderQueue()

      expect(screen.getByText(label)).toBeVisible()
      expect(screen.getByText(label)).toHaveAttribute('title', detail)
    },
  )
})
