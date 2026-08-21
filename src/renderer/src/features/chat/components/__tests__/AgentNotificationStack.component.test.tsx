import type { AgentLoopNotifyLevel } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentInteractionEvent } from '../../lib/types-chat-row'
import { AgentNotificationStack } from '../AgentNotificationStack'

const SESSION_ID = SessionId('session-1')

function notice(input: {
  readonly id: string
  readonly level: AgentLoopNotifyLevel
  readonly message?: string
  readonly timestamp?: number
}): AgentInteractionEvent {
  return {
    type: 'agent_interaction_request',
    interaction: {
      interactionId: input.id,
      sessionId: SESSION_ID,
      runId: 'run-1',
      kind: 'notify',
      source: 'pi-ui',
      createdAt: 1,
      message: input.message ?? input.id,
      level: input.level,
    },
    timestamp: input.timestamp ?? 1,
  }
}

function focusWindow(focused: boolean) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(focused ? 'visible' : 'hidden')
}

describe('AgentNotificationStack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    focusWindow(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders a notification with its severity label and message', () => {
    render(
      <AgentNotificationStack
        events={[notice({ id: 'n1', level: 'info', message: 'Ponytail loaded: full' })]}
      />,
    )

    expect(screen.getByText('Notification')).toBeInTheDocument()
    expect(screen.getByText('Ponytail loaded: full')).toBeInTheDocument()
  })

  it('lets an informational notice go after five seconds of focused time', () => {
    render(<AgentNotificationStack events={[notice({ id: 'n1', level: 'info' })]} />)

    expect(screen.getByText('Notification')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByText('Notification')).not.toBeInTheDocument()
  })

  it('keeps an error until it is dismissed', () => {
    render(<AgentNotificationStack events={[notice({ id: 'e1', level: 'error' })]} />)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('Error notification')).toBeInTheDocument()
  })

  it('does not run the clock while the window is unfocused', () => {
    // A notice must not expire unwatched. T3 Code counts visible, focused time only, and this is
    // the behaviour that makes an auto-dismissing error banner safe.
    focusWindow(false)
    render(<AgentNotificationStack events={[notice({ id: 'n1', level: 'info' })]} />)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByText('Notification')).toBeInTheDocument()
  })

  it('resumes the clock when the window regains focus', () => {
    focusWindow(false)
    render(<AgentNotificationStack events={[notice({ id: 'n1', level: 'info' })]} />)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    focusWindow(true)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByText('Notification')).not.toBeInTheDocument()
  })

  it('does not restart one notice’s clock when another arrives', () => {
    // The regression this guards: timers keyed to the array meant every new event restarted every
    // visible clock, so informational notices never expired during a busy run.
    const { rerender } = render(
      <AgentNotificationStack events={[notice({ id: 'n1', level: 'info' })]} />,
    )

    act(() => {
      vi.advanceTimersByTime(4000)
    })

    rerender(
      <AgentNotificationStack
        events={[notice({ id: 'n1', level: 'info' }), notice({ id: 'n2', level: 'info' })]}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(1100)
    })

    expect(screen.queryByText(/^n1$/)).not.toBeInTheDocument()
    expect(screen.getByText(/^n2$/)).toBeInTheDocument()
  })

  it('expires a notice queued behind the visible slots instead of surfacing it later', () => {
    // Overflowed notices used to have no clock at all, so they appeared seconds later once the
    // visible ones went, which is the opposite of ephemeral.
    render(
      <AgentNotificationStack
        events={[
          notice({ id: 'n1', level: 'info', timestamp: 4 }),
          notice({ id: 'n2', level: 'info', timestamp: 3 }),
          notice({ id: 'n3', level: 'info', timestamp: 2 }),
          notice({ id: 'n4', level: 'info', timestamp: 1 }),
        ]}
      />,
    )

    expect(screen.queryByText(/^n4$/)).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByText(/^n4$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^n1$/)).not.toBeInTheDocument()
  })

  it('fronts an error even when informational notices arrived later', () => {
    render(
      <AgentNotificationStack
        events={[
          notice({ id: 'e1', level: 'error', timestamp: 1 }),
          notice({ id: 'n1', level: 'info', timestamp: 2 }),
          notice({ id: 'n2', level: 'info', timestamp: 3 }),
          notice({ id: 'n3', level: 'info', timestamp: 4 }),
        ]}
      />,
    )

    const rendered = screen.getAllByText(/notification|Notification/i)
    expect(rendered[0]).toHaveTextContent('Error notification')
  })

  it('announces politely rather than interrupting', () => {
    render(<AgentNotificationStack events={[notice({ id: 'n1', level: 'info' })]} />)

    expect(screen.getByLabelText('Agent notifications')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders nothing when there are no notifications', () => {
    render(<AgentNotificationStack events={[]} />)

    expect(screen.queryByLabelText('Agent notifications')).not.toBeInTheDocument()
  })
})
