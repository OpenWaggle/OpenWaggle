import { describe, expect, it } from 'vitest'
import type { OrchestrationRunRow, OrchestrationRunTaskRow } from '../run-repository-mapper'
import {
  buildCoreRunFromRows,
  buildCoreTaskFromRow,
  buildSharedRunFromRows,
  parseAttempts,
  parseJsonObject,
  parseJsonString,
  parseJsonValue,
  parseOutputMap,
  parseRetryPolicy,
  parseTaskOrder,
} from '../run-repository-mapper'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunRow(overrides: Partial<OrchestrationRunRow> = {}): OrchestrationRunRow {
  return {
    run_id: 'run-1',
    conversation_id: 'conv-1',
    status: 'running',
    started_at: '2026-01-01T00:00:00Z',
    finished_at: null,
    max_parallel_tasks: null,
    task_order_json: '["t1","t2"]',
    outputs_json: '{}',
    fallback_used: 0,
    fallback_reason: null,
    updated_at: 1000,
    ...overrides,
  }
}

function makeTaskRow(overrides: Partial<OrchestrationRunTaskRow> = {}): OrchestrationRunTaskRow {
  return {
    run_id: 'run-1',
    task_id: 't1',
    kind: 'agent',
    status: 'queued',
    depends_on_json: '[]',
    title: null,
    input_json: null,
    output_json: null,
    started_at: null,
    finished_at: null,
    error_code: null,
    error: null,
    retry_json: null,
    attempts_json: null,
    timeout_ms: null,
    metadata_json: null,
    created_order: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseJsonString
// ---------------------------------------------------------------------------

describe('parseJsonString', () => {
  it('parses valid JSON', () => {
    expect(parseJsonString('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('returns null for invalid JSON', () => {
    expect(parseJsonString('not json')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseJsonString(null)).toBeNull()
  })

  it('parses JSON arrays', () => {
    expect(parseJsonString('[1,2,3]')).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// parseTaskOrder
// ---------------------------------------------------------------------------

describe('parseTaskOrder', () => {
  it('parses valid string array', () => {
    const result = parseTaskOrder('["task-1","task-2","task-3"]')
    expect(result).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseTaskOrder('not-json')).toEqual([])
  })

  it('returns empty array for non-string-array JSON', () => {
    expect(parseTaskOrder('[1,2,3]')).toEqual([])
  })

  it('returns empty array for object JSON', () => {
    expect(parseTaskOrder('{"key":"value"}')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// parseOutputMap
// ---------------------------------------------------------------------------

describe('parseOutputMap', () => {
  it('parses valid object', () => {
    const result = parseOutputMap('{"t1":"result1","t2":"result2"}')
    expect(result).toEqual({ t1: 'result1', t2: 'result2' })
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseOutputMap('invalid')).toEqual({})
  })

  it('returns empty object for array JSON', () => {
    expect(parseOutputMap('[1,2,3]')).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// parseJsonValue
// ---------------------------------------------------------------------------

describe('parseJsonValue', () => {
  it('parses valid JSON value', () => {
    expect(parseJsonValue('"hello"')).toBe('hello')
  })

  it('parses JSON number', () => {
    expect(parseJsonValue('42')).toBe(42)
  })

  it('parses JSON object', () => {
    expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns null for null input (null is a valid JSON value)', () => {
    expect(parseJsonValue(null)).toBeNull()
  })

  it('returns undefined for invalid JSON string', () => {
    // parseJsonString returns null for invalid JSON, then null passes schema
    // validation as a valid JsonValue, so the result is null not undefined
    expect(parseJsonValue('not-json')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseJsonObject
// ---------------------------------------------------------------------------

describe('parseJsonObject', () => {
  it('parses valid JSON object', () => {
    expect(parseJsonObject('{"key":"val"}')).toEqual({ key: 'val' })
  })

  it('returns undefined for null input', () => {
    expect(parseJsonObject(null)).toBeUndefined()
  })

  it('returns undefined for array JSON', () => {
    expect(parseJsonObject('[1,2]')).toBeUndefined()
  })

  it('returns undefined for invalid JSON', () => {
    expect(parseJsonObject('{broken')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// parseRetryPolicy
// ---------------------------------------------------------------------------

describe('parseRetryPolicy', () => {
  it('parses valid retry policy', () => {
    const result = parseRetryPolicy('{"retries":3,"backoffMs":1000,"jitterMs":200}')
    expect(result).toEqual({ retries: 3, backoffMs: 1000, jitterMs: 200 })
  })

  it('returns default policy for null input', () => {
    expect(parseRetryPolicy(null)).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })

  it('returns default policy for invalid JSON', () => {
    expect(parseRetryPolicy('bad')).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })

  it('returns default policy for non-object JSON', () => {
    expect(parseRetryPolicy('"string"')).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })
})

// ---------------------------------------------------------------------------
// parseAttempts
// ---------------------------------------------------------------------------

describe('parseAttempts', () => {
  it('parses valid attempts array', () => {
    const attempts = [
      {
        attempt: 1,
        status: 'ok',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:01:00Z',
        durationMs: 60000,
      },
    ]
    const result = parseAttempts(JSON.stringify(attempts))
    expect(result).toHaveLength(1)
    expect(result[0]?.attempt).toBe(1)
    expect(result[0]?.status).toBe('ok')
  })

  it('returns empty array for null input', () => {
    expect(parseAttempts(null)).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseAttempts('bad-json')).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseAttempts('{"not":"array"}')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildCoreTaskFromRow
// ---------------------------------------------------------------------------

describe('buildCoreTaskFromRow', () => {
  it('converts a full task row to domain record', () => {
    const row = makeTaskRow({
      task_id: 'task-abc',
      kind: 'agent',
      status: 'completed',
      depends_on_json: '["dep-1"]',
      input_json: '{"title":"Build feature X"}',
      output_json: '{"result":"done"}',
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T01:00:00Z',
      error_code: null,
      error: null,
      retry_json: '{"retries":2,"backoffMs":500,"jitterMs":100}',
      attempts_json: JSON.stringify([
        {
          attempt: 1,
          status: 'ok',
          startedAt: '2026-01-01T00:00:00Z',
          finishedAt: '2026-01-01T01:00:00Z',
          durationMs: 3600000,
        },
      ]),
      timeout_ms: 60000,
      metadata_json: '{"customKey":"customValue"}',
      created_order: 5,
    })

    const task = buildCoreTaskFromRow(row)

    expect(task.id).toBe('task-abc')
    expect(task.kind).toBe('agent')
    expect(task.status).toBe('completed')
    expect(task.dependsOn).toEqual(['dep-1'])
    expect(task.input).toEqual({ title: 'Build feature X' })
    expect(task.output).toEqual({ result: 'done' })
    expect(task.startedAt).toBe('2026-01-01T00:00:00Z')
    expect(task.finishedAt).toBe('2026-01-01T01:00:00Z')
    expect(task.retry).toEqual({ retries: 2, backoffMs: 500, jitterMs: 100 })
    expect(task.timeoutMs).toBe(60000)
    expect(task.attempts).toHaveLength(1)
    expect(task.metadata).toEqual({ customKey: 'customValue' })
    expect(task.createdOrder).toBe(5)
  })

  it('handles null optional fields gracefully', () => {
    const row = makeTaskRow()
    const task = buildCoreTaskFromRow(row)

    // parseJsonValue(null) returns null (null is valid JsonValue), not undefined
    expect(task.input).toBeNull()
    expect(task.output).toBeNull()
    expect(task.startedAt).toBeUndefined()
    expect(task.finishedAt).toBeUndefined()
    expect(task.errorCode).toBeUndefined()
    expect(task.error).toBeUndefined()
    expect(task.timeoutMs).toBeUndefined()
    expect(task.metadata).toBeUndefined()
    expect(task.retry).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
    expect(task.attempts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildSharedRunFromRows
// ---------------------------------------------------------------------------

describe('buildSharedRunFromRows', () => {
  it('converts run row + task rows to shared OrchestrationRunRecord', () => {
    const runRow = makeRunRow({
      run_id: 'run-abc',
      conversation_id: 'conv-xyz',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T01:00:00Z',
      max_parallel_tasks: 3,
      task_order_json: '["t1","t2"]',
      outputs_json: '{"t1":"output1"}',
      fallback_used: 1,
      fallback_reason: 'model unavailable',
      updated_at: 2000,
    })

    const taskRows = [
      makeTaskRow({ task_id: 't1', status: 'completed', created_order: 0 }),
      makeTaskRow({
        task_id: 't2',
        status: 'completed',
        depends_on_json: '["t1"]',
        created_order: 1,
      }),
    ]

    const record = buildSharedRunFromRows(runRow, taskRows)

    expect(record.runId).toBe('run-abc')
    expect(record.conversationId).toBe('conv-xyz')
    expect(record.status).toBe('completed')
    expect(record.startedAt).toBe('2026-01-01T00:00:00Z')
    expect(record.finishedAt).toBe('2026-01-01T01:00:00Z')
    expect(record.maxParallelTasks).toBe(3)
    expect(record.taskOrder).toHaveLength(2)
    expect(record.tasks.t1).toBeDefined()
    expect(record.tasks.t2).toBeDefined()
    expect(record.outputs).toEqual({ t1: 'output1' })
    expect(record.fallbackUsed).toBe(true)
    expect(record.fallbackReason).toBe('model unavailable')
    expect(record.updatedAt).toBe(2000)
  })

  it('handles empty task rows', () => {
    const runRow = makeRunRow()
    const record = buildSharedRunFromRows(runRow, [])

    expect(Object.keys(record.tasks)).toHaveLength(0)
    expect(record.fallbackUsed).toBe(false)
  })

  it('maps null optional fields to undefined', () => {
    const runRow = makeRunRow({
      finished_at: null,
      max_parallel_tasks: null,
      fallback_reason: null,
    })
    const record = buildSharedRunFromRows(runRow, [])

    expect(record.finishedAt).toBeUndefined()
    expect(record.maxParallelTasks).toBeUndefined()
    expect(record.fallbackReason).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildCoreRunFromRows
// ---------------------------------------------------------------------------

describe('buildCoreRunFromRows', () => {
  it('converts run row + task rows to CoreRunRecord with summary', () => {
    const runRow = makeRunRow({
      run_id: 'core-run-1',
      task_order_json: '["t1","t2","t3"]',
      outputs_json: '{}',
    })

    const taskRows = [
      makeTaskRow({ task_id: 't1', status: 'completed', created_order: 0 }),
      makeTaskRow({ task_id: 't2', status: 'failed', created_order: 1 }),
      makeTaskRow({ task_id: 't3', status: 'queued', created_order: 2 }),
    ]

    const record = buildCoreRunFromRows(runRow, taskRows)

    expect(record.runId).toBe('core-run-1')
    expect(record.status).toBe('running')
    expect(record.taskOrder).toEqual(['t1', 't2', 't3'])
    expect(Object.keys(record.tasks)).toHaveLength(3)
    expect(record.summary.total).toBe(3)
    expect(record.summary.completed).toBe(1)
    expect(record.summary.failed).toBe(1)
    expect(record.summary.queued).toBe(1)
    expect(record.summary.running).toBe(0)
    expect(record.summary.cancelled).toBe(0)
    expect(record.summary.retrying).toBe(0)
  })

  it('handles empty task rows', () => {
    const runRow = makeRunRow({ task_order_json: '[]' })
    const record = buildCoreRunFromRows(runRow, [])

    expect(Object.keys(record.tasks)).toHaveLength(0)
    expect(record.summary.total).toBe(0)
  })
})
