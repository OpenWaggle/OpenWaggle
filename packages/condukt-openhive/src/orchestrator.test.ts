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
