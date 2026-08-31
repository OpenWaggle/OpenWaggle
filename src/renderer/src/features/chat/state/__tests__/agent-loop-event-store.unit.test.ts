import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentLoopEventStore } from '../agent-loop-event-store'

const SESSION_ID = SessionId('session-1')

describe('agent loop event store', () => {
  beforeEach(() => {
    useAgentLoopEventStore.setState({ sessionsById: new Map() })
  })

  it('retains pending interactions until their resolution arrives', () => {
    const store = useAgentLoopEventStore.getState()
    store.applyEvent(SESSION_ID, {
      type: 'agent_interaction_request',
      timestamp: 1,
      interaction: {
        interactionId: 'confirm-1',
        sessionId: SESSION_ID,
        runId: 'run-1',
        kind: 'confirm',
        source: 'pi-ui',
        createdAt: 1,
        title: 'Continue?',
        message: 'Allow extension action?',
        purpose: 'user-input',
      },
    })

    expect(
      useAgentLoopEventStore.getState().sessionsById.get(SESSION_ID)?.interactions,
    ).toHaveLength(1)

    store.applyEvent(SESSION_ID, {
      type: 'agent_interaction_resolved',
      timestamp: 2,
      runId: 'run-1',
      interactionId: 'confirm-1',
      kind: 'confirm',
      status: 'resolved',
      response: { kind: 'confirm', accepted: true },
    })

    const session = useAgentLoopEventStore.getState().sessionsById.get(SESSION_ID)
    expect(session?.interactions).toEqual([])
    expect(session?.interactionEvents).toHaveLength(2)
  })

  it('bounds custom history and retained session state', () => {
    const store = useAgentLoopEventStore.getState()
    for (let index = 0; index < 25; index += 1) {
      store.applyEvent(SESSION_ID, {
        type: 'custom',
        name: `custom-${String(index)}`,
        timestamp: index,
      })
    }
    expect(
      useAgentLoopEventStore.getState().sessionsById.get(SESSION_ID)?.customMessages,
    ).toHaveLength(20)

    for (let index = 0; index < 55; index += 1) {
      const sessionId = SessionId(`session-${String(index + 2)}`)
      store.applyEvent(sessionId, {
        type: 'custom',
        name: 'bounded',
        timestamp: index,
      })
    }

    const sessions = useAgentLoopEventStore.getState().sessionsById
    expect(sessions.size).toBe(50)
    expect(sessions.has(SESSION_ID)).toBe(false)
  })

  it('removes a dismissed notification from workspace-lifetime history', () => {
    const store = useAgentLoopEventStore.getState()
    store.applyEvent(SESSION_ID, {
      type: 'agent_interaction_request',
      timestamp: 1,
      interaction: {
        interactionId: 'notice-1',
        sessionId: SESSION_ID,
        runId: 'run-1',
        kind: 'notify',
        source: 'pi-ui',
        createdAt: 1,
        message: 'Persistent notice',
        level: 'error',
      },
    })

    store.dismissNotification(SESSION_ID, 'notice-1')

    expect(
      useAgentLoopEventStore.getState().sessionsById.get(SESSION_ID)?.interactionEvents,
    ).toEqual([])
  })
})
