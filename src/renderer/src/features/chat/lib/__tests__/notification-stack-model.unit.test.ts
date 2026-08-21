import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  capAgentInteractionEvents,
  DECISION_EVENT_BUDGET,
  NOTIFY_EVENT_BUDGET,
  notificationLifetimeMs,
  orderNotifications,
} from '../notification-stack-model'
import type { AgentInteractionEvent } from '../types-chat-row'

const SESSION_ID = SessionId('session-1')

function notifyRequest(id: string): AgentInteractionEvent {
  return {
    type: 'agent_interaction_request',
    runId: 'run-1',
    interaction: {
      interactionId: id,
      sessionId: SESSION_ID,
      runId: 'run-1',
      kind: 'notify',
      source: 'pi-ui',
      createdAt: 1,
      message: id,
      level: 'info',
    },
    timestamp: 1,
  }
}

function confirmRequest(id: string): AgentInteractionEvent {
  return {
    type: 'agent_interaction_request',
    runId: 'run-1',
    interaction: {
      interactionId: id,
      sessionId: SESSION_ID,
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: 1,
      title: 'Allow?',
      message: 'Allow it?',
      purpose: 'authorization',
    },
    timestamp: 1,
  }
}

function confirmResolved(id: string): AgentInteractionEvent {
  return {
    type: 'agent_interaction_resolved',
    runId: 'run-1',
    interactionId: id,
    kind: 'confirm',
    status: 'resolved',
    timestamp: 2,
  }
}

describe('notification lifetimes', () => {
  it('expires information and warnings but keeps errors until dismissed', () => {
    expect(notificationLifetimeMs('info')).toBe(5000)
    expect(notificationLifetimeMs('warning')).toBe(5000)
    expect(notificationLifetimeMs('error')).toBeNull()
  })
})

describe('orderNotifications', () => {
  it('puts the most severe notice first regardless of arrival time', () => {
    // The regression this guards: ordering by time alone let three later informational notices push
    // an active error out of the visible slots, and an error never expires on its own.
    const ordered = orderNotifications([
      { level: 'info', timestamp: 40 },
      { level: 'info', timestamp: 30 },
      { level: 'error', timestamp: 10 },
      { level: 'info', timestamp: 20 },
    ])

    expect(ordered[0]).toEqual({ level: 'error', timestamp: 10 })
  })

  it('ranks warning above information', () => {
    const ordered = orderNotifications([
      { level: 'info', timestamp: 50 },
      { level: 'warning', timestamp: 10 },
    ])

    expect(ordered.map((entry) => entry.level)).toEqual(['warning', 'info'])
  })

  it('breaks ties within a severity by newest first', () => {
    const ordered = orderNotifications([
      { level: 'info', timestamp: 10 },
      { level: 'info', timestamp: 30 },
      { level: 'info', timestamp: 20 },
    ])

    expect(ordered.map((entry) => entry.timestamp)).toEqual([30, 20, 10])
  })
})

describe('capAgentInteractionEvents', () => {
  it('keeps a decision pair no matter how many notifications arrive after it', () => {
    // The regression this guards: one shared window let a burst of informational notices evict the
    // request and resolution behind them, so an Ask-mode transcript row either vanished or stayed
    // stuck on "Waiting" after the decision had been made.
    const events: AgentInteractionEvent[] = [
      confirmRequest('decision-1'),
      confirmResolved('decision-1'),
      ...Array.from({ length: NOTIFY_EVENT_BUDGET * 2 }, (_, index) =>
        notifyRequest(`notify-${String(index)}`),
      ),
    ]

    const capped = capAgentInteractionEvents(events)

    expect(capped).toContain(events[0])
    expect(capped).toContain(events[1])
  })

  it('trims the oldest notifications past their own budget', () => {
    const events = Array.from({ length: NOTIFY_EVENT_BUDGET + 5 }, (_, index) =>
      notifyRequest(`notify-${String(index)}`),
    )

    const capped = capAgentInteractionEvents(events)

    expect(capped).toHaveLength(NOTIFY_EVENT_BUDGET)
    expect(capped).not.toContain(events[0])
    expect(capped).toContain(events.at(-1))
  })

  it('trims the oldest decisions past their own budget', () => {
    const events = Array.from({ length: DECISION_EVENT_BUDGET + 3 }, (_, index) =>
      confirmRequest(`decision-${String(index)}`),
    )

    const capped = capAgentInteractionEvents(events)

    expect(capped).toHaveLength(DECISION_EVENT_BUDGET)
    expect(capped).not.toContain(events[0])
  })

  it('preserves order, so a request still precedes its resolution', () => {
    const events = [confirmRequest('decision-1'), confirmResolved('decision-1')]

    expect(capAgentInteractionEvents(events)).toEqual(events)
  })
})
