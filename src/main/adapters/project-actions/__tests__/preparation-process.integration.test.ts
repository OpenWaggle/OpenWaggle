import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSessionHostChildEnv } from '../../../env'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shellCases = [
  {
    shell: '/bin/bash',
    command: `source ./setup-env; values=(bash value); export OW_SELECTED_SHELL=\${values[0]}; exit 0`,
    value: 'bash',
  },
  {
    shell: '/bin/zsh',
    command: `source ./setup-env; values=(zsh value); export OW_SELECTED_SHELL=\${values[1]}; exit 0`,
    value: 'zsh',
  },
  {
    shell: getSessionHostChildEnv().OPENWAGGLE_QA_FISH ?? '/usr/bin/fish',
    command: 'set -gx OW_SELECTED_SHELL fish; exit 0',
    value: 'fish',
  },
]

describe.skipIf(process.platform === 'win32')('real preparation environment capture', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it.for(shellCases)(
    'captures setup through the configured $value shell',
    async ({ shell, command, value }, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(join(directory, 'setup-env'), 'export OW_SOURCED_VALUE=loaded\n')
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const input = {
          workspace: { workspaceId: 'shell', projectPath: directory, workspacePath: directory },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        }
        const result = await execute({
          ...input,
          invocation: { type: 'command', command, directory: '.' },
        })
        expect(result).toMatchObject({ exitCode: 0, environment: { OW_SELECTED_SHELL: value } })
        if (value !== 'fish') expect(result.environment.OW_SOURCED_VALUE).toBe('loaded')
        const failed = await execute({
          ...input,
          invocation: { type: 'command', command: 'exit 9', directory: '.' },
        })
        expect(failed).toEqual({ exitCode: 9, environment: input.environment })
      } finally {
        await execute.shutdown()
      }
    },
  )
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
