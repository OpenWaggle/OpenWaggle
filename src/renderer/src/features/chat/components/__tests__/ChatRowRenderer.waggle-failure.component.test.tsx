import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildChatRows } from '../../hooks/useBuildChatRows'
import { applyAgentTransportEvent } from '../../lib/chat-stream-state'
import type { ChatRow } from '../../lib/types-chat-row'

vi.mock('@/features/waggle/components/TurnDivider', () => ({
  TurnDivider: ({ agentLabel }: { agentLabel: string }) => <div>Turn: {agentLabel}</div>,
}))

vi.mock('../MessageBubble', () => ({
  MessageBubble: ({ message }: { message: UIMessage }) => <div>{message.id}</div>,
}))

vi.mock('../ChatErrorDisplay', () => ({
  ChatErrorDisplay: ({ error, dismissedError }: { error: Error; dismissedError: string | null }) =>
    dismissedError === error.message ? null : <div role="status">{error.message}</div>,
}))

import { ChatRowRenderer } from '../ChatRowRenderer'

const ERROR = '401 Unauthorized: Incorrect API key provided'
const CRITIC: WaggleMessageMetadata = {
  agentIndex: 1,
  agentLabel: 'Critic',
  agentColor: 'amber',
  turnNumber: 1,
}
const USER: UIMessage = { id: 'user-1', role: 'user', parts: [{ type: 'text', content: 'Q' }] }

function liveMessages() {
  const events: AgentTransportEvent[] = [
    { type: 'message_start', messageId: 'critic-1', role: 'assistant', timestamp: 2 },
    {
      type: 'message_end',
      messageId: 'critic-1',
      role: 'assistant',
      timestamp: 3,
      errorMessage: ERROR,
    },
  ]
  return events.reduce<readonly UIMessage[]>(applyAgentTransportEvent, [USER])
}

function refreshedMessages(): readonly UIMessage[] {
  return [USER, { id: 'critic-1', role: 'assistant', parts: [], metadata: { error: ERROR } }]
}

function rowKey(row: ChatRow) {
  if (row.type === 'message') return row.message.id
  return 'id' in row ? String(row.id) : row.type
}

function renderTranscript(
  messages: readonly UIMessage[],
  runError: { readonly dismissed: boolean },
) {
  const rows = buildChatRows({
    messages: [...messages],
    isLoading: false,
    error: new Error(ERROR),
    lastUserMessage: 'Q',
    dismissedError: runError.dismissed ? ERROR : null,
    sessionId: 'session-1',
    waggleMetadataLookup: { 'critic-1': CRITIC },
    phase: { current: null, completed: [], totalElapsedMs: 0 },
  })
  return render(
    <div>
      {rows.map((row) => (
        <ChatRowRenderer
          key={rowKey(row)}
          row={row}
          sessionId={SessionId('session-1')}
          onDismissError={vi.fn()}
        />
      ))}
    </div>,
  )
}

describe.each([
  ['live', liveMessages],
  ['refreshed', refreshedMessages],
])('a Waggle turn that ended the Run with an error (%s)', (_mode, messages) => {
  it('shows the error once, in the Run error row', () => {
    renderTranscript(messages(), { dismissed: false })

    expect(screen.getByRole('status')).toHaveTextContent(ERROR)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the error on the failed turn once the Run error is dismissed', () => {
    renderTranscript(messages(), { dismissed: true })

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(`This turn failed: ${ERROR}`)
  })
})
