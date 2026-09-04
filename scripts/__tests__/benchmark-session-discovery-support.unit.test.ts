import { describe, expect, it } from 'vitest'
import {
  benchmarkTranscriptTerminalCursor,
  validateSessionDiscoveryBenchmarkPreflight,
} from '../benchmark-session-discovery-preflight'

const PAGE_SIZE = 50
const SPARSE_PATH = '/benchmark/project-0999'
const SNAPSHOT_HEAD = 'skew-node-00009999'
const HIGH_WATER_MARK = 10_099

function summaries(count: number, projectPath = '/benchmark/project-0000') {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `session-${String(index).padStart(6, '0')}`,
    projectPath,
  }))
}

function listResult(sessions: ReturnType<typeof summaries>, nextCursor?: string) {
  return {
    outcome: {
      operation: 'list',
      sessions,
      ...(nextCursor ? { nextCursor } : {}),
    },
  }
}

function transcriptHead() {
  return {
    outcome: {
      operation: 'items',
      sessionId: 'session-000000',
      highWaterMark: HIGH_WATER_MARK,
      snapshotHeadNodeId: SNAPSHOT_HEAD,
      items: Array.from({ length: PAGE_SIZE }, (_, index) => ({
        nodeId: `node-${String(index * 100_000).padStart(8, '0')}`,
        parentNodeId:
          index === 0 ? null : `node-${String((index - 1) * 100_000).padStart(8, '0')}`,
        createdOrder: index,
        content: { text: `commonterm transcript head ${String(index)}` },
      })),
    },
  }
}

function transcriptTerminal(content = 'commonterm skewed long session terminal marker-00009999') {
  return {
    outcome: {
      operation: 'items',
      sessionId: 'session-000000',
      highWaterMark: HIGH_WATER_MARK,
      snapshotHeadNodeId: SNAPSHOT_HEAD,
      items: [
        {
          nodeId: SNAPSHOT_HEAD,
          parentNodeId: 'skew-node-00009998',
          createdOrder: HIGH_WATER_MARK,
          content: { text: content },
        },
      ],
    },
  }
}

function validPreflight() {
  return {
    list: listResult(summaries(PAGE_SIZE), 'next-page'),
    sparseWorkingPathList: listResult(summaries(12, SPARSE_PATH)),
    missingWorkingPathList: listResult([]),
    rareLexical: [
      {
        session_id: 'session-000100',
        matched_fields: 'current-preview',
        snippet: 'rare benchmarktoken final result',
      },
    ],
    commonLexical: [
      {
        session_id: 'session-000000',
        matched_fields: 'initial-objective,current-preview',
        snippet: 'commonterm implement project',
      },
    ],
    rareFullTranscriptLexical: [
      {
        session_id: 'session-000100',
        matched_fields: 'transcript',
        transcript_node_id: 'node-00000100',
        transcript_created_order: 1,
      },
    ],
    commonFullTranscriptLexical: [
      {
        session_id: 'session-000000',
        matched_fields: 'transcript',
        transcript_node_id: 'node-00000000',
        transcript_created_order: 0,
      },
    ],
    transcriptHead: transcriptHead(),
    transcriptTerminal: transcriptTerminal(),
    sparseWorkingPath: SPARSE_PATH,
  }
}

describe('Session discovery benchmark preflight', () => {
  it('accepts results that prove each timed query reached its fixture evidence', () => {
    expect(() => validateSessionDiscoveryBenchmarkPreflight(validPreflight())).not.toThrow()
    expect(benchmarkTranscriptTerminalCursor(transcriptHead())).toEqual({
      afterCreatedOrder: HIGH_WATER_MARK - 1,
      snapshotHeadNodeId: SNAPSHOT_HEAD,
    })
  })

  it.each([
    ['an error response', { ...validPreflight(), list: { outcome: { error: 'failed' } } }],
    ['a short catalog page', { ...validPreflight(), list: listResult(summaries(49)) }],
    [
      'the wrong sparse path',
      { ...validPreflight(), sparseWorkingPathList: listResult(summaries(1, '/wrong')) },
    ],
    [
      'full-transcript rows without attributable evidence',
      {
        ...validPreflight(),
        rareFullTranscriptLexical: [
          {
            session_id: 'session-000100',
            matched_fields: 'transcript',
            transcript_node_id: null,
            transcript_created_order: null,
          },
        ],
      },
    ],
    [
      'a non-empty missing-path result',
      { ...validPreflight(), missingWorkingPathList: listResult(summaries(1)) },
    ],
    ['empty rare lexical rows', { ...validPreflight(), rareLexical: [] }],
    [
      'common lexical rows without evidence',
      {
        ...validPreflight(),
        commonLexical: [
          { session_id: 'session-1', matched_fields: 'title', snippet: 'unrelated' },
        ],
      },
    ],
    [
      'a transcript without its head',
      {
        ...validPreflight(),
        transcriptHead: {
          ...transcriptHead(),
          outcome: { ...transcriptHead().outcome, items: [] },
        },
      },
    ],
    [
      'a transcript without its terminal marker',
      { ...validPreflight(), transcriptTerminal: transcriptTerminal('ordinary completion') },
    ],
  ])('rejects %s before timing', (_label, input) => {
    expect(() => validateSessionDiscoveryBenchmarkPreflight(input)).toThrow(
      'Session discovery benchmark preflight failed',
    )
  })
})
