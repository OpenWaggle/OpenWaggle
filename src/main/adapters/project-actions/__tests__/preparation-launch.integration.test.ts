import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionProcess, ActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe('preparation launch cancellation', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-launch-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('settles cancellation before a stalled launch and stops a late process', async () => {
    const launch = Promise.withResolvers<ActionProcess>()
    const stop = vi.fn(async () => {})
    const runner: ActionProcessRunner = {
      validate: vi.fn(async () => {}),
      start: vi.fn(() => launch.promise),
    }
    const execute = createPreparationExecutor(runner, directory, 'test')
    const controller = new AbortController()
    const pending = execute({
      workspace: { workspaceId: 'stalled', projectPath: directory, workspacePath: directory },
      invocation: { type: 'command', command: 'echo ready', directory: '.' },
      environment: {},
      captureEnvironment: false,
      signal: controller.signal,
      onOutput: () => {},
    })
    const settled = vi.fn()
    void pending.catch(settled)
    try {
      await vi.waitFor(() => expect(runner.start).toHaveBeenCalledOnce())
      controller.abort(new Error('Stopped before native launch'))
      await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
      expect(stop).not.toHaveBeenCalled()
      launch.resolve({ pid: 43, closed: Promise.resolve({ exitCode: null }), stop })
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
    } finally {
      launch.resolve({ pid: 43, closed: Promise.resolve({ exitCode: null }), stop })
      await execute.shutdown()
    }
  })

  it('does not wait for an unresolved launch during Host shutdown', async () => {
    const launch = Promise.withResolvers<ActionProcess>()
    const stop = vi.fn(async () => {})
    const runner: ActionProcessRunner = {
      validate: vi.fn(async () => {}),
      start: vi.fn(() => launch.promise),
    }
    const execute = createPreparationExecutor(runner, directory, 'test')
    const pending = execute({
      workspace: { workspaceId: 'shutdown', projectPath: directory, workspacePath: directory },
      invocation: { type: 'command', command: 'echo ready', directory: '.' },
      environment: {},
      captureEnvironment: false,
      onOutput: () => {},
    })
    const settled = vi.fn()
    void pending.catch(settled)
    try {
      await vi.waitFor(() => expect(runner.start).toHaveBeenCalledOnce())
      const shutdown = execute.shutdown()
      await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
      await shutdown
      launch.resolve({ pid: 44, closed: Promise.resolve({ exitCode: null }), stop })
      await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
    } finally {
      launch.resolve({ pid: 44, closed: Promise.resolve({ exitCode: null }), stop })
      await execute.shutdown()
    }
  })
})
