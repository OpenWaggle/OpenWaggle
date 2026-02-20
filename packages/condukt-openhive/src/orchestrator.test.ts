import { expect, test } from 'vitest'

import { runOpenHiveOrchestration } from './orchestrator'

test('falls back when planner output is invalid in auto-fallback mode', async () => {
  const result = await runOpenHiveOrchestration({
    userPrompt: 'hello world',
    planner: {
      async plan() {
        return { tasks: [] }
      },
    },
    executor: {
      async execute() {
        return { ok: true }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'never'
      },
    },
    mode: 'auto-fallback',
  })

  expect(result.usedFallback).toBe(true)
  expect(result.text).toBe('hello world')
})

test('runs planner -> orchestration -> synthesizer', async () => {
  const result = await runOpenHiveOrchestration({
    runId: 'run-1',
    userPrompt: 'Do work',
    planner: {
      async plan() {
        return {
          tasks: [
            {
              id: 'research',
              kind: 'analysis',
              title: 'Research',
              prompt: 'Find things',
            },
            {
              id: 'write',
              kind: 'synthesis',
              title: 'Write',
              prompt: 'Compose',
              dependsOn: ['research'],
            },
          ],
        }
      },
    },
    executor: {
      async execute(input) {
        return {
          taskId: input.task.id,
          includeConversationSummary: input.includeConversationSummary,
        }
      },
    },
    synthesizer: {
      async synthesize(input) {
        return `completed:${input.run.summary.completed}`
      },
    },
  })

  expect(result.usedFallback).toBe(false)
  expect(result.runStatus).toBe('completed')
  expect(result.text).toBe('completed:2')
  expect(result.run?.outputs.research).toEqual({
    taskId: 'research',
    includeConversationSummary: true,
  })
})

test('does not synthesize when orchestration run fails', async () => {
  let synthesizerCalls = 0

  const result = await runOpenHiveOrchestration({
    runId: 'run-fail',
    userPrompt: 'Do failing work',
    planner: {
      async plan() {
        return {
          tasks: [
            {
              id: 'broken-task',
              kind: 'analysis',
              title: 'Broken',
              prompt: 'This fails',
            },
          ],
        }
      },
    },
    executor: {
      async execute() {
        throw new Error('executor failed')
      },
    },
    synthesizer: {
      async synthesize() {
        synthesizerCalls += 1
        return 'should-not-run'
      },
    },
  })

  expect(result.usedFallback).toBe(false)
  expect(result.runStatus).toBe('failed')
  expect(result.text).toBe('')
  expect(synthesizerCalls).toBe(0)
})
