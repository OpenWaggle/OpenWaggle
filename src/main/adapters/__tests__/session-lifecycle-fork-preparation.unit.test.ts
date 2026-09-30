import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentKernelServiceShape } from '../../ports/agent-kernel-service'
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
          modelId: 'provider/model',
        })
      }).pipe(Effect.provide(layer)),
    )

    // The source was itself a copy, so its owner is the first Session, not the source.
    expect(JSON.parse(prepared.result.sessionSnapshot.nodes[0]?.metadataJson ?? '{}')).toEqual({
      visualizationSessionId: 'first-session',
    })
  })
})
