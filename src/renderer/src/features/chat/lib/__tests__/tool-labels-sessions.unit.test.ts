import type { JsonObject } from '@shared/types/json'
import { describe, expect, it } from 'vitest'
import { parseToolArgs } from '../tool-args'
import {
  isHiddenSessionsToolCall,
  type SessionsToolTarget,
  sessionsLabel,
  showsOnlyHiddenSessionsToolCalls,
} from '../tool-labels-sessions'

const REVIEWER: SessionsToolTarget = {
  title: 'Review tool icons',
  agentName: 'reviewer',
  isWorker: true,
}

function done(args: JsonObject, target: SessionsToolTarget | null = null) {
  return sessionsLabel(args, target).done
}

describe('sessionsLabel', () => {
  it('names the Worker an action targets by its current title and Agent definition', () => {
    expect(done({ action: 'message', sessionId: 'w1' }, REVIEWER)).toBe(
      'Messaged Worker (reviewer) · Review tool icons',
    )
    expect(done({ action: 'steer', sessionId: 'w1' }, { ...REVIEWER, agentName: null })).toBe(
      'Steered Worker · Review tool icons',
    )
    expect(sessionsLabel({ action: 'interrupt', sessionId: 'w1' }, REVIEWER).running).toBe(
      'Interrupting Worker (reviewer) · Review tool icons...',
    )
  })

  it('names a Session outside the Hive as a session', () => {
    expect(
      done(
        { action: 'follow_up', sessionId: 's1' },
        { title: 'Audit deps', agentName: null, isWorker: false },
      ),
    ).toBe('Sent a follow-up to session · Audit deps')
  })

  it('falls back to a bare Worker when the Hive does not know the target', () => {
    expect(done({ action: 'message', sessionId: 'w1' })).toBe('Messaged Worker')
    // A fork's source is often the caller itself, which need not be a Worker.
    expect(done({ action: 'fork' })).toBe('Forked session')
  })

  it('names a spawn by what it asked for until the Hive knows the Worker', () => {
    expect(done({ action: 'spawn', objective: 'Review icons\nmore', agent: 'reviewer' })).toBe(
      'Spawned Worker (reviewer) · Review icons',
    )
    expect(done({ action: 'spawn', objective: 'Old objective' }, REVIEWER)).toBe(
      'Spawned Worker (reviewer) · Review tool icons',
    )
    expect(done({ action: 'launch', objective: 'Audit deps' })).toBe(
      'Launched session · Audit deps',
    )
  })

  it('cuts a long objective to its first line', () => {
    const objective = `\n${'Review the tool icons '.repeat(6)}\nSecond paragraph`
    const label = done({ action: 'spawn', objective })
    expect(label).not.toContain('Second paragraph')
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual('Spawned Worker · '.length + 80)
  })

  it('names reports to the Queen or the parent', () => {
    expect(done({ action: 'report', target: { type: 'queen' } })).toBe('Reported to the Queen')
    expect(done({ action: 'report', target: { type: 'upstream' } })).toBe('Reported to its parent')
    expect(done({ action: 'report', target: { type: 'session', sessionId: 'w1' } }, REVIEWER)).toBe(
      'Reported to Worker (reviewer) · Review tool icons',
    )
    expect(done({ action: 'report', target: { type: 'session', sessionId: 'gone' } })).toBe(
      'Reported to Worker',
    )
    expect(done({ action: 'report', target: { type: 'worker_reference', reference: 'r' } })).toBe(
      'Reported to Worker',
    )
    expect(done({ action: 'report', target: { type: 'sessions', sessionIds: ['a', 'b'] } })).toBe(
      'Reported to 2 Workers',
    )
  })

  it('labels untargeted actions by what they did', () => {
    expect(done({ action: 'list' })).toBe('Listed sessions')
    expect(done({ action: 'search', query: 'auth' })).toBe('Searched sessions · auth')
    expect(done({ action: 'delegation_accept' })).toBe("Accepted a Worker's work")
    expect(done({ action: 'delegation_claim' })).toBe('Updated a delegation')
    expect(done({ action: 'agent_definitions_search', query: 'review' })).toBe(
      'Searched agents · review',
    )
  })

  it('labels every follow-up queue, request and export action', () => {
    expect(done({ action: 'queue_pause', sessionId: 'w1' })).toBe('Paused follow-ups of Worker')
    expect(done({ action: 'approval_respond', sessionId: 'w1' })).toBe(
      'Answered an approval for Worker',
    )
    expect(done({ action: 'authorization_set', sessionId: 'w1' })).toBe('Set access for Worker')
    expect(done({ action: 'exports_wait', sessionId: 'w1' })).toBe('Waited on an export of Worker')
  })

  it('counts the Workers a wait is for', () => {
    expect(sessionsLabel({ action: 'wait', sessionIds: ['a'] }, null).running).toBe(
      'Waiting on 1 Worker...',
    )
    expect(done({ action: 'wait', sessionIds: ['a', 'b'] })).toBe('Waited on 2 Workers')
  })

  it('keeps an unknown action visible and words a requested call', () => {
    expect(done({ action: 'teleport' })).toBe('Hive action · teleport')
    expect(sessionsLabel({ action: 'message', sessionId: 'w1' }, REVIEWER).requested).toBe(
      'Requested: messaging Worker (reviewer) · Review tool icons',
    )
  })
})

describe('isHiddenSessionsToolCall', () => {
  it('hides only sessions-tool waits', () => {
    expect(isHiddenSessionsToolCall('sessions', { action: 'wait' })).toBe(true)
    expect(isHiddenSessionsToolCall('sessions', { action: 'spawn' })).toBe(false)
    expect(isHiddenSessionsToolCall('wait', { action: 'wait' })).toBe(false)
  })

  it('hides a call whose action has not streamed in, so a wait never flashes a row', () => {
    expect(isHiddenSessionsToolCall('sessions', {}, 'input-streaming')).toBe(true)
    expect(isHiddenSessionsToolCall('sessions', {}, 'input-complete')).toBe(false)
  })
})

describe('showsOnlyHiddenSessionsToolCalls', () => {
  const wait = { type: 'tool-call', name: 'sessions', arguments: '{"action":"wait"}' }

  it('is true for a message of hidden waits and their results only', () => {
    expect(
      showsOnlyHiddenSessionsToolCalls(
        [{ type: 'text', content: ' ' }, wait, { type: 'tool-result' }],
        parseToolArgs,
      ),
    ).toBe(true)
  })

  it('is false once anything else would show', () => {
    expect(
      showsOnlyHiddenSessionsToolCalls(
        [{ type: 'text', content: 'Waiting.' }, wait],
        parseToolArgs,
      ),
    ).toBe(false)
    expect(
      showsOnlyHiddenSessionsToolCalls(
        [wait, { type: 'tool-call', name: 'read', arguments: '{}' }],
        parseToolArgs,
      ),
    ).toBe(false)
    expect(showsOnlyHiddenSessionsToolCalls([{ type: 'text', content: '' }], parseToolArgs)).toBe(
      false,
    )
  })
})
