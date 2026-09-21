import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe.skipIf(process.platform === 'win32')('real preparation environment capture', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('captures successful shell exports, including an explicit exit, without publishing failed exports', async () => {
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const input = {
      workspace: { workspaceId: 'test', projectPath: directory, workspacePath: directory },
      environment: {},
      captureEnvironment: true,
      onOutput: () => {},
    }
    const succeeded = await execute({
      ...input,
      invocation: {
        type: 'command',
        command: "export OW_PREPARATION_VALUE='a value with spaces'; exit 0",
        directory: '.',
      },
    })
    expect(succeeded).toMatchObject({
      exitCode: 0,
      environment: { OW_PREPARATION_VALUE: 'a value with spaces' },
    })
    const failed = await execute({
      ...input,
      invocation: {
        type: 'command',
        command: 'export OW_FAILED_VALUE=bad; exit 9',
        directory: '.',
      },
    })
    expect(failed).toEqual({ exitCode: 9, environment: {} })
  })

  it('cancels a real preparation process before publishing its exported environment', async () => {
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const pending = execute({
      workspace: { workspaceId: 'cancel', projectPath: directory, workspacePath: directory },
      invocation: {
        type: 'command',
        command: 'export PARTIAL_SETUP=no; printf setup-started; sleep 30',
        directory: '.',
      },
      environment: {},
      captureEnvironment: true,
      signal: controller.signal,
      onOutput: (output) => {
        if (output.includes('setup-started')) started.resolve()
      },
    })
    const stopped = expect(pending).rejects.toThrow('Stopped by user')
    try {
      await started.promise
      controller.abort(new Error('Stopped by user'))
      await stopped
    } finally {
      await execute.shutdown()
    }
  })
})
