import { expect, test } from 'vitest'

import {
  createOrchestrationEngine,
  MemoryRunStore,
  ORCHESTRATION_ERROR_TASK_TIMEOUT,
  type OrchestrationEvent,
  type OrchestrationRunRecord,
  type OrchestrationTaskOutputValue,
  type WorkerAdapter,
} from '../index'

test('executes dependency graph and allows dynamic spawn', async () => {
  const worker: WorkerAdapter = {
    async executeTask(task, context): Promise<{ output?: OrchestrationTaskOutputValue }> {
      if (task.kind === 'root') {
        await context.spawn({ id: 'spawned', kind: 'echo', input: { value: 'child' } })
        return { output: { root: true } }
      }
      if (task.kind === 'echo') {
        return { output: task.input }
      }
      if (task.kind === 'join') {
        return {
          output: {
            fromA: context.dependencyOutputs.a,
            fromB: context.dependencyOutputs.b,
          },
        }
      }
      throw new Error(`unexpected kind ${task.kind}`)
    },
  }

  const store = new MemoryRunStore()
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store })

  const summary = await engine.run({
    runId: 'run-spawn',
    tasks: [
      { id: 'a', kind: 'echo', input: { v: 'A' } },
      { id: 'b', kind: 'root' },
      { id: 'join', kind: 'join', dependsOn: ['a', 'b'] },
    ],
  })

  expect(summary.status).toBe('completed')
  expect(summary.outputs.join).toEqual({
    fromA: { v: 'A' },
    fromB: { root: true },
  })

  const run = await store.getRun('run-spawn')
  expect(run?.tasks.spawned?.status).toBe('completed')
})

test('retries task execution failures with backoff', async () => {
  let attempts = 0
  const delays: number[] = []

  const worker: WorkerAdapter = {
    async executeTask(task) {
      if (task.kind !== 'flaky') {
        return { output: null }
      }
      attempts += 1
      if (attempts < 3) {
        throw new Error('transient')
      }
      return { output: { ok: true } }
    },
  }

  const engine = createOrchestrationEngine({
    workerAdapter: worker,
    random: () => 0,
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
  })

  const summary = await engine.run({
    runId: 'run-retry',
    tasks: [
      {
        id: 'task',
        kind: 'flaky',
        retry: { retries: 2, backoffMs: 10, jitterMs: 0 },
      },
    ],
  })

  expect(summary.status).toBe('completed')
  expect(summary.outputs.task).toEqual({ ok: true })
  expect(delays).toEqual([10, 20])
})

test('marks timed out tasks as failed with timeout code', async () => {
  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('timeout triggered')
    },
  }

  const store = new MemoryRunStore()
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store })

  const summary = await engine.run({
    runId: 'run-timeout',
    tasks: [{ id: 'slow', kind: 'slow', timeoutMs: 10 }],
  })

  expect(summary.status).toBe('failed')
  expect(summary.failedTaskIds).toEqual(['slow'])

  const run = await store.getRun('run-timeout')
  expect(run?.tasks.slow?.errorCode).toBe(ORCHESTRATION_ERROR_TASK_TIMEOUT)
})

test('fails task cleanly when task_started emission throws', async () => {
  const worker: WorkerAdapter = {
    async executeTask() {
      return { output: 'ok' }
    },
  }

  const store = new MemoryRunStore()
  const engine = createOrchestrationEngine({
    workerAdapter: worker,
    runStore: store,
    onEvent: async (event) => {
      if (event.type === 'task_started' && event.taskId === 'review') {
        throw new Error('emit failed')
      }
    },
  })

  const summary = await engine.run({
    runId: 'run-event-failure',
    tasks: [
      { id: 'read', kind: 'analysis' },
      { id: 'review', kind: 'analysis', dependsOn: ['read'] },
    ],
  })

  expect(summary.status).toBe('failed')
  expect(summary.failedTaskIds).toEqual(['review'])

  const run = await store.getRun('run-event-failure')
  expect(run?.tasks.review?.status).toBe('failed')
  expect(run?.tasks.review?.attempts).toHaveLength(1)
  expect(run?.tasks.review?.attempts[0]?.error).toContain('emit failed')
})

test('supports run cancellation', async () => {
  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('aborted')
    },
  }

  const store = new MemoryRunStore()
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store })

  const runPromise = engine.run({
    runId: 'run-cancel',
    tasks: [{ id: 'long', kind: 'long' }],
  })

  await engine.cancel('run-cancel', 'user-cancel')
  const summary = await runPromise

  expect(summary.status).toBe('cancelled')
  expect(summary.cancelledTaskIds).toContain('long')
})

test('waits for in-flight task cleanup before resolving cancelled run', async () => {
  let cleanedUp = false

  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          cleanedUp = true
          resolve()
        }, 10)
      })
      throw new Error('aborted')
    },
  }

  const store = new MemoryRunStore()
  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store })
  const runPromise = engine.run({
    runId: 'run-cancel-cleanup',
    tasks: [{ id: 'long', kind: 'long' }],
  })

  let started = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await store.getRun('run-cancel-cleanup')
    if (run?.tasks.long?.status === 'running') {
      started = true
      break
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
  expect(started).toBe(true)

  await engine.cancel('run-cancel-cleanup', 'user-cancel')
  const summary = await runPromise

  expect(summary.status).toBe('cancelled')
  expect(cleanedUp).toBe(true)
})

test('resumes from persisted non-terminal checkpoint', async () => {
  const worker: WorkerAdapter = {
    async executeTask(task, context): Promise<{ output?: OrchestrationTaskOutputValue }> {
      if (task.kind === 'combine') {
        const left = context.dependencyOutputs.left
        const value = left && typeof left === 'object' && 'value' in left ? String(left.value) : ''
        return { output: { merged: `${value}-done` } }
      }
      return { output: { value: String(task.input ?? '') } }
    },
  }

  const store = new MemoryRunStore()

  const checkpoint: OrchestrationRunRecord = {
    runId: 'run-resume',
    status: 'running',
    startedAt: new Date().toISOString(),
    tasks: {
      left: {
        id: 'left',
        kind: 'echo',
        dependsOn: [],
        input: 'left',
        output: { value: 'left' },
        status: 'completed',
        retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: [],
        createdOrder: 0,
      },
      right: {
        id: 'right',
        kind: 'combine',
        dependsOn: ['left'],
        status: 'queued',
        retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: [],
        createdOrder: 1,
      },
    },
    taskOrder: ['left', 'right'],
    outputs: { left: { value: 'left' } },
    summary: {
      total: 2,
      completed: 1,
      failed: 0,
      cancelled: 0,
      queued: 1,
      running: 0,
      retrying: 0,
    },
  }

  await store.saveRun(checkpoint)

  const engine = createOrchestrationEngine({ workerAdapter: worker, runStore: store })
  const summary = await engine.resume('run-resume')

  expect(summary.status).toBe('completed')
  expect(summary.outputs.right).toEqual({ merged: 'left-done' })
})

test('emits task_progress events via reportProgress callback', async () => {
  const events: OrchestrationEvent[] = []
  const worker: WorkerAdapter = {
    async executeTask(_task, context) {
      context.reportProgress({ step: 'reading', file: 'README.md' })
      return { output: 'done' }
    },
  }
  const engine = createOrchestrationEngine({
    workerAdapter: worker,
    onEvent: async (event) => {
      events.push(event)
    },
  })
  await engine.run({
    runId: 'run-progress',
    tasks: [{ id: 't1', kind: 'work' }],
  })

  const progressEvents = events.filter((e) => e.type === 'task_progress')
  expect(progressEvents).toHaveLength(1)
  expect(progressEvents[0].type === 'task_progress' && progressEvents[0].payload).toEqual({
    step: 'reading',
    file: 'README.md',
  })
})

test('respects maxParallelTasks limit', async () => {
  let maxConcurrent = 0
  let current = 0
  const worker: WorkerAdapter = {
    async executeTask() {
      current += 1
      maxConcurrent = Math.max(maxConcurrent, current)
      await new Promise((r) => setTimeout(r, 20))
      current -= 1
      return { output: 'ok' }
    },
  }
  const engine = createOrchestrationEngine({ workerAdapter: worker })
  await engine.run({
    runId: 'run-parallel',
    maxParallelTasks: 2,
    tasks: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, kind: 'work' })),
  })

  expect(maxConcurrent).toBeLessThanOrEqual(2)
})
