import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { beforeEach, describe, expect, it } from 'vitest'
import { trackExtensionStatus, useExtensionStatusStore } from '../extension-status-store'

const SESSION_ID = SessionId('session-1')

function status(key: string, text?: string, runId = 'run-1'): AgentTransportEvent {
  return {
    type: 'extension_status',
    runId,
    slot: { kind: 'status', key },
    ...(text !== undefined ? { text } : {}),
    timestamp: 1,
  }
}

function workingMessage(text?: string): AgentTransportEvent {
  return {
    type: 'extension_status',
    runId: 'run-1',
    slot: { kind: 'working-message' },
    ...(text !== undefined ? { text } : {}),
    timestamp: 1,
  }
}

const current = () => useExtensionStatusStore.getState().bySessionId.get(SESSION_ID)

describe('extension status store', () => {
  beforeEach(() => {
    useExtensionStatusStore.setState({ bySessionId: new Map() })
  })

  it('keeps one line per status key, in the order keys were first set', () => {
    trackExtensionStatus(SESSION_ID, status('lint', 'Linting'))
    trackExtensionStatus(SESSION_ID, status('tests', 'Testing'))
    trackExtensionStatus(SESSION_ID, status('lint', 'Lint passed'))

    expect(current()?.statuses).toEqual([
      { key: 'lint', text: 'Lint passed' },
      { key: 'tests', text: 'Testing' },
    ])
  })

  it('clears a status without text, and forgets the Session when nothing is left', () => {
    trackExtensionStatus(SESSION_ID, status('club-hooks', 'TypeScript hooks'))
    trackExtensionStatus(SESSION_ID, workingMessage('Running checks'))
    trackExtensionStatus(SESSION_ID, status('club-hooks'))

    expect(current()).toEqual({ runId: 'run-1', statuses: [], workingMessage: 'Running checks' })

    trackExtensionStatus(SESSION_ID, workingMessage())
    expect(current()).toBeUndefined()
  })

  // Pi runs a fresh session per Run, so a status nobody cleared must not outlive its Run.
  it('drops a Run statuses when it settles or another Run starts', () => {
    trackExtensionStatus(SESSION_ID, status('club-hooks', 'busy'))
    trackExtensionStatus(SESSION_ID, { type: 'agent_start', runId: 'run-1', timestamp: 2 })
    expect(current()?.statuses).toHaveLength(1)

    trackExtensionStatus(SESSION_ID, { type: 'agent_start', runId: 'run-2', timestamp: 3 })
    expect(current()).toBeUndefined()

    trackExtensionStatus(SESSION_ID, status('club-hooks', 'busy', 'run-2'))
    useExtensionStatusStore.getState().clearRun(SESSION_ID, 'run-1')
    expect(current()?.runId).toBe('run-2')
    useExtensionStatusStore.getState().clearRun(SESSION_ID, 'run-2')
    expect(current()).toBeUndefined()
  })

  it('replaces statuses an earlier Run left when the next Run sets its own', () => {
    trackExtensionStatus(SESSION_ID, status('a', 'old'))
    trackExtensionStatus(SESSION_ID, status('b', 'new', 'run-2'))

    expect(current()).toEqual({ runId: 'run-2', statuses: [{ key: 'b', text: 'new' }] })
  })
})
