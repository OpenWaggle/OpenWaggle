import type { Message } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import type { SessionResourceKind } from '@shared/types/session-resource'
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
import {
  failedOrchestrationMessages,
  toolMessages,
} from './session-resource-tool-backfill.fixtures'

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
            locator: '/worktree/src/session-summary.ts',
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

  it('advances past bounded failed orchestrations whose completed children were persisted', async () => {
    const messages = failedOrchestrationMessages()
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

  it('retries assistant metadata after tool, site, file, or web-search persistence fails', async () => {
    const scenarios = [
      {
        kind: 'tool',
        message: assistantToolResultMessage(false, { name: 'grep' }),
      },
      {
        kind: 'file',
        message: assistantToolResultMessage(false, {
          name: 'read',
          args: { path: 'src/session-summary.ts' },
        }),
      },
      {
        kind: 'web-search',
        message: assistantToolResultMessage(false, {
          name: 'web',
          args: { search_query: [{ q: 'OpenWaggle Session Summary' }] },
        }),
      },
      {
        kind: 'site',
        message: assistantToolResultMessage(false, {
          name: 'publish_site',
          result: {
            content: [
              {
                type: 'site',
                url: 'https://preview.example/session-summary',
                title: 'Session Summary preview',
                activity: 'created',
              },
            ],
          },
        }),
      },
    ] satisfies ReadonlyArray<{
      readonly kind: SessionResourceKind
      readonly message: Message
    }>

    for (const scenario of scenarios) {
      const failedPassUpserts: UpsertSessionResourceInput[] = []
      const failedPass = await Effect.runPromise(
        captureProjectedSessionResources({
          sessionId: SessionId('session-1'),
          messages: [scenario.message],
        }).pipe(
          Effect.provide(
            sessionResourceTestLayer(failedPassUpserts, {
              sessionWorkingPath: '/worktree',
              upsertFailsForKinds: [scenario.kind],
            }),
          ),
        ),
      )

      expect(failedPass, scenario.kind).toEqual({ progressed: false, fullyProjected: false })

      const persistedBeforeFailure = failedPassUpserts
        .filter((resource) => resource.kind !== scenario.kind)
        .map(capturedResource)
      const retryUpserts: UpsertSessionResourceInput[] = []
      const retry = await Effect.runPromise(
        captureProjectedSessionResources({
          sessionId: SessionId('session-1'),
          messages: [scenario.message],
        }).pipe(
          Effect.provide(
            sessionResourceTestLayer(retryUpserts, {
              listedResources: persistedBeforeFailure,
              sessionWorkingPath: '/worktree',
            }),
          ),
        ),
      )

      expect(retry.fullyProjected, scenario.kind).toBe(true)
      expect(
        retryUpserts.some((resource) => resource.kind === scenario.kind),
        scenario.kind,
      ).toBe(true)
    }
  })
})
