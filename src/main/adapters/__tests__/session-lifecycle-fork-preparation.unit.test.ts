import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentKernelServiceShape,
  ForkAgentKernelSessionInput,
} from '../../ports/agent-kernel-service'
import { prepareLifecycleFork } from '../session-lifecycle-fork-preparation'
import { makeSessionLifecycleTestLayer } from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-fork-preparation-'))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function assistantWithVisualization(id: string, metadataJson: string) {
  return {
    id,
    parentId: null,
    piEntryType: 'message',
    kind: 'assistant_message' as const,
    role: 'assistant' as const,
    timestampMs: 1,
    contentJson: JSON.stringify({
      parts: [
        {
          type: 'text',
          text: `visualize${JSON.stringify({ path: '/app-data/visualizations/owner/map.html' })}`,
        },
      ],
    }),
    metadataJson,
    pathDepth: 0,
    createdOrder: 0,
  }
}

describe('prepareLifecycleFork', () => {
  it('keeps copied inline visualizations pointing at the Session that rendered them', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'fork.sqlite'))
    const kernel = fromPartial<AgentKernelServiceShape>({
      forkSession: () =>
        Effect.succeed({
          cancelled: false,
          piSessionId: 'pi-fork',
          piSessionFile: '/sessions/fork.jsonl',
          sessionSnapshot: {
            activeNodeId: 'fork-node',
            nodes: [assistantWithVisualization('fork-node', '{}')],
          },
          // The fork node was re-keyed from the source node.
          sourceNodeIdByNodeId: new Map([['fork-node', 'source-node']]),
        }),
    })

    const prepared = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const source = assistantWithVisualization(
          'source-node',
          JSON.stringify({ visualizationSessionId: 'first-session' }),
        )
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, path_depth, created_order
          ) VALUES (
            ${source.id}, ${'session-parent'}, ${null}, ${source.piEntryType}, ${source.kind},
            ${source.role}, ${1}, ${source.contentJson}, ${source.metadataJson}, ${null}, ${0},
            ${0}
          )
        `
        return yield* prepareLifecycleFork({
          sql,
          kernel,
          command: { operation: 'fork', sourceSessionId: 'session-parent', targetNodeId: 'x' },
          callerId: 'gui:local-user',
          modelId: 'provider/model',
          attemptId: 'attempt-1',
          onForkFile: () => undefined,
        })
      }).pipe(Effect.provide(layer)),
    )

    // The source was itself a copy, so its owner is the first Session, not the source.
    expect(JSON.parse(prepared.result.sessionSnapshot.nodes[0]?.metadataJson ?? '{}')).toEqual({
      visualizationSessionId: 'first-session',
    })
  })

  it("records the fork's file under its preparation attempt before Pi's fork is written", async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'record.sqlite'))
    const forkFile = '/sessions/2026-01-01T00-00-00-000Z_fork.jsonl'
    const told: string[] = []

    const recordedAtWrite = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_lifecycle_preparation_attempts (
            attempt_id, session_id, pi_session_file, created_at, updated_at
          ) VALUES (${'attempt-1'}, ${'session-new'}, ${null}, ${1}, ${1})
        `
        const recorded = () =>
          sql<{ readonly pi_session_file: string | null }>`
            SELECT pi_session_file FROM session_lifecycle_preparation_attempts
            WHERE attempt_id = ${'attempt-1'}
          `.pipe(
            Effect.map((rows) => rows[0]?.pi_session_file ?? null),
            Effect.orDie,
          )
        let atWrite: string | null = null
        const kernel = fromPartial<AgentKernelServiceShape>({
          forkSession: (input: ForkAgentKernelSessionInput) =>
            Effect.gen(function* () {
              yield* input.beforeWritingFork?.(forkFile) ?? Effect.void
              // Where the adapter writes the file.
              atWrite = yield* recorded()
              return {
                cancelled: false,
                piSessionId: 'pi-fork',
                piSessionFile: forkFile,
                sessionSnapshot: { activeNodeId: null, nodes: [] },
                sourceNodeIdByNodeId: new Map(),
              }
            }),
        })
        yield* prepareLifecycleFork({
          sql,
          kernel,
          command: { operation: 'fork', sourceSessionId: 'session-parent', targetNodeId: 'x' },
          callerId: 'gui:local-user',
          modelId: 'provider/model',
          attemptId: 'attempt-1',
          onForkFile: (file) => told.push(file),
        })
        return atWrite
      }).pipe(Effect.provide(layer)),
    )

    expect(recordedAtWrite).toBe(forkFile)
    expect(told).toEqual([forkFile])
  })

  it.each<[string, string, 'before' | 'at' | undefined, 'fork' | 'clone']>([
    ['a fork, from the GUI', 'gui:local-user', 'before', 'fork'],
    ['a clone, from the GUI', 'gui:local-user', 'at', 'clone'],
    ['a fork, from the CLI with --position at', 'local-user:machine', 'at', 'fork'],
    ['a fork, from the Sessions tool with position at', 'session-agent:session-a', 'at', 'fork'],
    [
      'a fork, from the Sessions tool with no position',
      'session-agent:session-a',
      undefined,
      'fork',
    ],
  ])('tells the kernel it is %s', async (_case, callerId, position, copy) => {
    const layer = makeSessionLifecycleTestLayer(
      path.join(temporaryRoot, `copy-${String(position)}-${copy}.sqlite`),
    )
    const received: ForkAgentKernelSessionInput[] = []
    const kernel = fromPartial<AgentKernelServiceShape>({
      forkSession: (input: ForkAgentKernelSessionInput) => {
        received.push(input)
        return Effect.fail(new Error('stop after the kernel was asked'))
      },
    })

    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareLifecycleFork({
          sql,
          kernel,
          command: {
            operation: 'fork',
            sourceSessionId: 'session-parent',
            targetNodeId: 'x',
            ...(position ? { position } : {}),
          },
          callerId,
          modelId: 'provider/model',
          attemptId: 'attempt-1',
          onForkFile: () => undefined,
        }).pipe(Effect.either)
      }).pipe(Effect.provide(layer)),
    )

    expect(received.map((input) => input.copy)).toEqual([copy])
  })
})
