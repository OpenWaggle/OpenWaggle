import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import {
  captureSuccessfulRunResources,
  SESSION_TOOL_CAPTURE_LIMIT,
} from '../session-resource-capture'
import {
  assistantToolResultMessage,
  capturedResource,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

describe('production Session Resource tool projection', () => {
  it('reconstructs semantic tool and file resources from an existing projected transcript', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [
          assistantToolResultMessage(false, {
            name: 'read',
            args: { path: 'src/session-summary.ts' },
          }),
        ],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { sessionWorkingPath: '/worktree' })),
      ),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKey: 'tool:read',
          kind: 'tool',
          occurrence: expect.objectContaining({
            id: 'session-1:assistant-tool-message:read:tool:tool-call-1',
          }),
        }),
        expect.objectContaining({
          canonicalKey: 'file:/worktree/src/session-summary.ts',
          kind: 'file',
          occurrence: expect.objectContaining({
            id: 'session-1:assistant-tool-message:read:file:tool-call-1',
          }),
        }),
      ]),
    )
  })

  it('preserves tool provenance for historical resource links during backfill', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [
          assistantToolResultMessage(false, {
            name: 'lookup_documentation',
            result: {
              content: [
                {
                  type: 'resource_link',
                  uri: 'https://docs.example/historical',
                  title: 'Historical docs',
                },
              ],
            },
          }),
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(
      upserts.find((resource) => resource.canonicalKey === 'url:https://docs.example/historical'),
    ).toMatchObject({
      occurrence: {
        actor: 'tool',
        activity: 'read',
        label: 'lookup_documentation',
      },
    })
  })

  it('reconstructs a completed child from a partially failed MCP orchestration', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [
          assistantToolResultMessage(true, {
            name: 'mcp_run',
            details: {
              kind: 'orchestration',
              result: [
                {
                  id: 'issue',
                  handle: 'opaque-issue',
                  status: 'completed',
                  provenance: {
                    handle: 'opaque-issue',
                    serverInstanceId: 'github-1',
                    serverLabel: 'GitHub',
                    toolName: 'get_issue',
                  },
                  result: { operation: 'call', text: 'Found issue.' },
                },
              ],
            },
          }),
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'tool:github-1:get_issue',
        occurrence: expect.objectContaining({
          id: 'session-1:assistant-tool-message:read:tool:tool-call-1:child:0:issue',
          actor: 'tool',
          activity: 'read',
          label: 'get_issue · GitHub',
        }),
      }),
    )
  })

  it('bounds completed tool projection work for one successful run', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const messages = toolMessages('assistant-tool', 'tool')

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-bounded-tools',
        payload: { text: '', thinkingLevel: 'medium', attachments: [] },
        messages,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts.filter((resource) => resource.kind === 'tool')).toHaveLength(
      SESSION_TOOL_CAPTURE_LIMIT,
    )
  })

  it('resumes a bounded historical tool backfill without duplicating captured occurrences', async () => {
    const messages = toolMessages('assistant-backfill-tool', 'backfill-tool')
    const firstUpserts: UpsertSessionResourceInput[] = []

    const firstPass = await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(sessionResourceTestLayer(firstUpserts)),
      ),
    )
    const secondUpserts: UpsertSessionResourceInput[] = []
    const secondPass = await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(secondUpserts, {
            listedResources: firstUpserts.map(capturedResource),
          }),
        ),
      ),
    )

    expect(firstPass.fullyProjected).toBe(false)
    expect(firstUpserts).toHaveLength(SESSION_TOOL_CAPTURE_LIMIT)
    expect(secondUpserts).toHaveLength(8)
    expect(secondPass.fullyProjected).toBe(true)
  })
})

function toolMessages(messagePrefix: string, toolPrefix: string): Message[] {
  return Array.from({ length: SESSION_TOOL_CAPTURE_LIMIT + 8 }, (_, index) => ({
    ...assistantToolResultMessage(),
    id: MessageId(`${messagePrefix}-${String(index)}`),
    parts: [
      {
        type: 'tool-result' as const,
        toolResult: {
          id: ToolCallId(`${toolPrefix}-${String(index)}`),
          name: 'grep',
          args: { pattern: String(index) },
          result: '',
          isError: false,
          duration: 1,
        },
      },
    ],
  }))
}
