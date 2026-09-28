import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions tool', () => {
  it('keeps durable Follow-up distinct from active-Run Steering', () => {
    expect(
      buildSessionsToolPayload(
        { action: 'follow_up', sessionId: 'session-worker', text: 'Run QA next.' },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({ request: { command: { operation: 'follow-up' } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'steer',
          sessionId: 'session-worker',
          expectedRunId: 'run-worker',
          text: 'Check the socket path first.',
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        command: { operation: 'steer', expectedRunId: 'run-worker' },
      },
    })
  })

  it('builds explicit start, replace, and queued Follow-up promotion controls', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'start',
          sessionId: 'session-idle',
          text: 'Start now.',
          authorization: 'yolo',
          interactionTimeoutMs: 2500,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'start',
          runAuthorizationOverride: 'yolo',
          interactionTimeoutMs: 2500,
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'replace',
          sessionId: 'session-worker',
          expectedRunId: 'run-worker',
          text: 'Restart with this direction.',
          authorization: 'ask-for-approval',
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'replace',
          expectedRunId: 'run-worker',
          runAuthorizationOverride: 'ask-for-approval',
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'promote',
          sessionId: 'session-worker',
          expectedRunId: 'run-worker',
          followUpId: 'follow-up-1',
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'promote',
          expectedRunId: 'run-worker',
          followUpId: 'follow-up-1',
        },
      },
    })
  })

  it('builds semantic discovery requests with explicit freshness', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'search',
          query: 'database cutover recovery',
          catalogScope: 'all',
          mode: 'semantic',
          requireFresh: true,
          waitTimeoutMs: 2500,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'search',
          mode: 'semantic',
          requireFresh: true,
          waitTimeoutMs: 2500,
        },
      },
    })
  })

  it('authors an upstream report from the current Session and Run', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'report',
          target: { type: 'upstream' },
          text: 'The review is ready.',
          requestReply: true,
        },
        { sessionId: 'session-worker', runId: 'run-worker' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'report',
          sessionId: 'session-worker',
          sourceRunId: 'run-worker',
          target: { type: 'upstream' },
          input: { text: 'The review is ready.', requestReply: true },
        },
      },
    })
  })

  it('discovers and reads durable Delegation contracts without loading Worker transcripts', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegations_list',
          catalogScope: 'current',
          parentSessionId: 'queen',
          states: ['ready_for_review'],
        },
        { sessionId: 'queen', runId: 'run-queen', workingDirectory: '/repo/worktree' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'delegations-list',
          workingPath: '/repo/worktree',
          parentSessionId: 'queen',
          states: ['ready_for_review'],
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        { action: 'delegations_read', delegationId: 'delegation-1' },
        { sessionId: 'queen', runId: 'run-queen' },
      ),
    ).toMatchObject({
      request: { query: { operation: 'delegations-read', delegationId: 'delegation-1' } },
    })
  })

  it('builds a bounded first-match wait rather than a persistent subscription', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'wait',
          sessionIds: ['worker-1', 'worker-2'],
          condition: 'idle',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'wait',
          targets: [
            { sessionId: 'worker-1', condition: 'idle' },
            { sessionId: 'worker-2', condition: 'idle' },
          ],
        },
      },
    })
  })

  it('lists parked requests and keeps authorization approval explicit', () => {
    expect(
      buildSessionsToolPayload(
        { action: 'requests_list', sessionId: 'session-worker' },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: { query: { operation: 'requests-list', sessionId: 'session-worker' } },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'approval_respond',
          sessionId: 'session-worker',
          runId: 'run-worker',
          interactionId: 'approval-1',
          response: { kind: 'confirm', accepted: true, scope: 'once' },
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'approval-respond',
          interactionId: 'approval-1',
          response: { accepted: true },
        },
      },
    })
  })

  it('creates and waits for a durable export inside the calling workspace', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'export_create',
          sessionId: 'session-worker',
          destinationPath: 'exports/worker.zip',
          format: 'bundle',
          resources: ['reports/qa.md'],
        },
        {
          sessionId: 'session-queen',
          runId: 'run-current',
          workingDirectory: '/project/worktree',
        },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'export-create',
          destinationPath: '/project/worktree/exports/worker.zip',
          resources: [{ kind: 'workspace-file', path: 'reports/qa.md' }],
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'exports_wait',
          sessionId: 'session-worker',
          exportOperationId: 'export-1',
          timeoutMs: 30_000,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'exports-wait',
          sessionId: 'session-worker',
          exportOperationId: 'export-1',
        },
      },
    })
  })

  it('rejects durable export destinations outside the calling workspace', () => {
    expect(() =>
      buildSessionsToolPayload(
        {
          action: 'export_create',
          sessionId: 'session-worker',
          destinationPath: '../escaped.jsonl',
        },
        {
          sessionId: 'session-queen',
          runId: 'run-current',
          workingDirectory: '/project/worktree',
        },
      ),
    ).toThrow('must stay inside this workspace')
  })
})
