import { expect, test } from 'vitest'
import { runOpenWaggleOrchestration } from '../orchestrator'
import type { OrchestrationEvent, OrchestrationProgressPayload } from '../types'

test('falls back to single-task when planner output is empty in auto-fallback mode', async () => {
  const result = await runOpenWaggleOrchestration({
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
  })

  // Single-task fallback executes the user prompt as a general task
  expect(result.usedFallback).toBe(false)
  expect(result.text).toBe('executed: hello world')
})

test('runs planner -> orchestration -> synthesizer', async () => {
  const result = await runOpenWaggleOrchestration({
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
              dependsOn: [],
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
        return { text: `done:${input.task.id}` }
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
  expect(result.run?.outputs.research).toEqual({ text: 'done:research' })
})

test('does not synthesize when orchestration run fails', async () => {
  let synthesizerCalls = 0

  const result = await runOpenWaggleOrchestration({
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
  const result = await runOpenWaggleOrchestration({
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
  })

  // Single-task fallback ran instead of fully falling back to classic
  expect(result.usedFallback).toBe(false)
  expect(result.text).toBe('fallback: do something')
})

test('concatenates task outputs when synthesizer fails', async () => {
  const result = await runOpenWaggleOrchestration({
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

  const result = await runOpenWaggleOrchestration({
    runId: 'run-retry',
    userPrompt: 'retry test',
    planner: {
      async plan() {
        return {
          tasks: [{ id: 'flaky', kind: 'general', title: 'Flaky', prompt: 'May fail' }],
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

test('threads reportProgress to executor', async () => {
  const progressPayloads: OrchestrationProgressPayload[] = []

  await runOpenWaggleOrchestration({
    runId: 'run-progress',
    userPrompt: 'test',
    planner: {
      async plan() {
        return { tasks: [{ id: 'a', kind: 'general', title: 'A', prompt: 'do A' }] }
      },
    },
    executor: {
      async execute(input) {
        input.reportProgress?.({ type: 'tool_start', toolName: 'readFile', toolCallId: 'tc-1' })
        input.reportProgress?.({ type: 'tool_end', toolName: 'readFile', toolCallId: 'tc-1' })
        return { text: 'done' }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'ok'
      },
    },
    onEvent: async (event: OrchestrationEvent) => {
      if (event.type === 'task_progress') progressPayloads.push(event.payload)
    },
  })

  expect(progressPayloads).toHaveLength(2)
  expect(progressPayloads[0]).toEqual({
    type: 'tool_start',
    toolName: 'readFile',
    toolCallId: 'tc-1',
  })
})

test('emits synthesis fallback concatenation when synthesizer fails', async () => {
  const result = await runOpenWaggleOrchestration({
    runId: 'run-synth-fallback',
    userPrompt: 'check fallback',
    planner: {
      async plan() {
        return {
          tasks: [{ id: 'x', kind: 'general', title: 'X', prompt: 'Do X' }],
        }
      },
    },
    executor: {
      async execute() {
        return { text: 'output-x' }
      },
    },
    synthesizer: {
      async synthesize() {
        throw new Error('synthesis crashed')
      },
    },
  })

  // Should have concatenated outputs instead of empty string
  expect(result.text).toBe('output-x')
  expect(result.runStatus).toBe('completed')
})

test('concatenates task outputs when synthesizer returns empty string', async () => {
  const result = await runOpenWaggleOrchestration({
    runId: 'run-synth-empty',
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
        return ''
      },
    },
  })

  expect(result.usedFallback).toBe(false)
  expect(result.runStatus).toBe('completed')
  // Empty synthesis should fall back to concatenated task outputs
  expect(result.text).toBe('result-a\n\nresult-b')
})

test('rejects plans exceeding max task count', async () => {
  const result = await runOpenWaggleOrchestration({
    runId: 'run-max-tasks',
    userPrompt: 'big plan',
    planner: {
      async plan() {
        return {
          tasks: Array.from({ length: 15 }, (_, i) => ({
            id: `task-${i}`,
            kind: 'general',
            title: `Task ${i}`,
            prompt: `Do ${i}`,
          })),
        }
      },
    },
    executor: {
      async execute(input) {
        return { text: `done-${input.task.id}` }
      },
    },
    synthesizer: {
      async synthesize() {
        return 'synthesized'
      },
    },
  })

  // Plan should have been truncated to MAX_PLAN_TASKS (10)
  expect(result.runStatus).toBe('completed')
  const taskCount = result.run?.taskOrder.length ?? 0
  expect(taskCount).toBeLessThanOrEqual(10)
})
