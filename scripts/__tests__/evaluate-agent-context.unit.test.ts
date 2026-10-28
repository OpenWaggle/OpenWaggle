import { describe, expect, it } from 'vitest'
import { compareWithBaseline, summarizeEvalRuns } from '../evaluate-agent-context-summary'
import { AGENT_CONTEXT_TASKS } from '../evaluate-agent-context-tasks'
import { summarizeSessionFile } from '../evaluate-agent-context-transcript'
import { EMPTY_OUTCOME, type EvalTaskGroup, outcomeWith } from '../evaluate-agent-context-types'

/**
 * The deterministic part of `pnpm evaluate:agent-context` (decision 7 of the v1 performance
 * plan): every grader accepts its reference outcome and rejects an empty one, transcripts are read
 * the way Pi writes them, and the acceptance rule compares a candidate with its baseline.
 */
const GROUPS: readonly EvalTaskGroup[] = [
  'core-coding',
  'deferred-first-party-tools',
  'mcp-codemode',
  'hive',
  'skills',
  'truncated-output',
  'compaction-recall',
  'browser-preview',
]

function run(taskId: string, group: EvalTaskGroup, pass: boolean, tokens: number) {
  return { taskId, group, pass, totalTokens: tokens, modelCalls: 1, toolSearchCalls: 0, usage: { costUsd: tokens / 1_000_000 } }
}

describe('agent-context evaluation tasks', () => {
  it('covers every group with about 25 uniquely named tasks', () => {
    const ids = AGENT_CONTEXT_TASKS.map((task) => task.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(26)
    expect(new Set(AGENT_CONTEXT_TASKS.map((task) => task.group))).toEqual(new Set(GROUPS))
  })

  it.each(AGENT_CONTEXT_TASKS.map((task) => [task.id, task] as const))('%s passes its reference and fails an empty Run', (_id, task) => {
    expect(task.grade(outcomeWith(task.reference))).toMatchObject({ pass: true })
    expect(task.grade(EMPTY_OUTCOME)).toMatchObject({ pass: false })
  })
})

describe('agent-context evaluation transcripts', () => {
  it('reads tool calls, codemode tool references, usage, compactions and the final text', () => {
    const lines = [
      { type: 'custom', customType: 'openwaggle-run-identity', data: { hiveRole: 'Independent' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', name: 'codemode', arguments: { code: 'await tools.mcp__inventory__lookup_sku({ sku: "A" })' } },
            { type: 'toolCall', name: 'bash', arguments: { command: 'ls' } },
          ],
          usage: { input: 2, output: 10, cacheRead: 0, cacheWrite: 500, cost: { total: 0.01 } },
        },
      },
      { type: 'compaction', summary: '...' },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Done: 17' }], usage: { input: 1, output: 3, cacheRead: 500, cacheWrite: 0, cost: { total: 0.001 } } } },
    ]
    const summary = summarizeSessionFile('root.jsonl', lines.map((line) => JSON.stringify(line)).join('\n'))
    expect(summary).toMatchObject({ isRoot: true, finalText: 'Done: 17', modelCalls: 2, compactions: 1 })
    expect(summary.toolNames).toEqual(['codemode', 'codemode:mcp__inventory__lookup_sku', 'bash'])
    expect(summary.usage).toMatchObject({ input: 3, output: 13, cacheRead: 500, cacheWrite: 500 })
    expect(summary.usage.costUsd).toBeCloseTo(0.011)
  })

  it('marks a Worker transcript as not the root Session', () => {
    const identity = { type: 'custom', customType: 'openwaggle-run-identity', data: { text: '"parentSessionTitle": "Queen"' } }
    expect(summarizeSessionFile('worker.jsonl', JSON.stringify(identity)).isRoot).toBe(false)
  })
})

describe('agent-context evaluation acceptance', () => {
  const baseline = summarizeEvalRuns([
    ...Array.from({ length: 5 }, (_, index) => run('a', 'core-coding', index < 5, 1_000)),
    ...Array.from({ length: 5 }, (_, index) => run('b', 'hive', index < 4, 2_000)),
  ])

  it('accepts one lost pass on a task when its group total holds and tokens drop', () => {
    const candidate = summarizeEvalRuns([
      ...Array.from({ length: 5 }, (_, index) => run('a', 'core-coding', index < 5, 600)),
      ...Array.from({ length: 5 }, (_, index) => run('b', 'hive', index < 4, 900)),
    ])
    expect(compareWithBaseline(baseline, candidate)).toMatchObject({ accepted: true })
  })

  it('rejects a lower group total, a task losing two passes, or more tokens', () => {
    const fewerPasses = summarizeEvalRuns([
      ...Array.from({ length: 5 }, (_, index) => run('a', 'core-coding', index < 3, 600)),
      ...Array.from({ length: 5 }, (_, index) => run('b', 'hive', index < 4, 900)),
    ])
    expect(compareWithBaseline(baseline, fewerPasses)).toMatchObject({
      accepted: false,
      taskRegressions: [{ taskId: 'a', before: 5, after: 3 }],
      groupRegressions: [{ group: 'core-coding', before: 5, after: 3 }],
    })
    const moreTokens = summarizeEvalRuns([
      ...Array.from({ length: 5 }, () => run('a', 'core-coding', true, 1_500)),
      ...Array.from({ length: 5 }, (_, index) => run('b', 'hive', index < 4, 2_000)),
    ])
    expect(compareWithBaseline(baseline, moreTokens)).toMatchObject({ accepted: false, tokens: { down: false } })
  })
})
