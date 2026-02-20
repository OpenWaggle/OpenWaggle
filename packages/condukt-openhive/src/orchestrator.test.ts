import { expect, test } from 'vitest'

import { runOpenHiveOrchestration } from './orchestrator'

test('falls back to single-task when planner output is empty in auto-fallback mode', async () => {
  const result = await runOpenHiveOrchestration({
    userPrompt: 'hello world',
    planner: {
      async plan() {
        return { tasks: [] }
      },
    },
    executor: {
      async execute(input) {
        return { text: `executed: ${input.task.prompt}` }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'never'
      },
    },
    mode: 'auto-fallback',
  })

  // Single-task fallback executes the user prompt as a general task
  expect(result.usedFallback).toBe(false)
  expect(result.text).toBe('executed: hello world')
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

test('falls back to single-task when planner throws in auto-fallback mode', async () => {
  const result = await runOpenHiveOrchestration({
    userPrompt: 'do something',
    planner: {
      async plan() {
        throw new Error('LLM rate limit exceeded')
      },
    },
    executor: {
      async execute(input) {
        return { text: `fallback: ${input.task.prompt}` }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'never'
      },
    },
    mode: 'auto-fallback',
  })

  // Single-task fallback ran instead of fully falling back to classic
  expect(result.usedFallback).toBe(false)
  expect(result.text).toBe('fallback: do something')
})

test('concatenates task outputs when synthesizer fails', async () => {
  const result = await runOpenHiveOrchestration({
    runId: 'run-synth-fail',
    userPrompt: 'multi task',
    planner: {
      async plan() {
        return {
          tasks: [
            { id: 'a', kind: 'general', title: 'A', prompt: 'Do A' },
            { id: 'b', kind: 'general', title: 'B', prompt: 'Do B' },
          ],
        }
      },
    },
    executor: {
      async execute(input) {
        return { text: `result-${input.task.id}` }
      },
    },
    synthesizer: {
      async synthesize() {
        throw new Error('synthesis LLM failed')
      },
    },
  })

  expect(result.usedFallback).toBe(false)
  expect(result.runStatus).toBe('completed')
  expect(result.text).toBe('result-a\n\nresult-b')
})

test('applies default retry policy to tasks', async () => {
  let executionCount = 0

  const result = await runOpenHiveOrchestration({
    runId: 'run-retry',
    userPrompt: 'retry test',
    planner: {
      async plan() {
        return {
          tasks: [
            { id: 'flaky', kind: 'general', title: 'Flaky', prompt: 'May fail' },
          ],
        }
      },
    },
    executor: {
      async execute() {
        executionCount += 1
        if (executionCount === 1) {
          throw new Error('transient failure')
        }
        return { text: 'success on retry' }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'synthesized'
      },
    },
  })

  expect(result.usedFallback).toBe(false)
  expect(result.runStatus).toBe('completed')
  expect(executionCount).toBe(2)
})
