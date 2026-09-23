import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })
  it('keeps inherited variables unset in subsequent actions and cleanup', async () => {
    vi.stubEnv('HTTPS_PROXY', 'https://inherited.invalid')
    const runner = createActionProcessRunner('test')
    const execute = createPreparationExecutor(runner, directory, 'test')
    const workspace = { workspaceId: 'unset', projectPath: directory, workspacePath: directory }
    try {
      const prepared = await execute({
        workspace,
        invocation: {
          type: 'command',
          command: 'unset HTTPS_PROXY; export OW_READY=yes',
          directory: '.',
        },
        environment: { SHELL: '/bin/bash' },
        captureEnvironment: true,
        onOutput: () => {},
      })
      expect(prepared.exitCode).toBe(0)
      expect(prepared.environment.HTTPS_PROXY).toBeNull()
      const command = `test -z "\${HTTPS_PROXY+x}" && test "$OW_READY" = yes`
      const action = await runner.start({
        invocation: { type: 'command', command, cwd: directory },
        environment: prepared.environment,
        onOutput: () => {},
      })
      try {
        expect((await action.closed).exitCode).toBe(0)
      } finally {
        await action.stop()
      }
      const cleanup = await execute({
        workspace,
        invocation: { type: 'command', command, directory: '.' },
        environment: prepared.environment,
        captureEnvironment: false,
        onOutput: () => {},
      })
      expect(cleanup.exitCode).toBe(0)
    } finally {
      await execute.shutdown()
    }
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

  it.for(['/bin/bash', '/bin/zsh'])(
    'captures exports after a sourced %s script installs EXIT cleanup and setup exits explicitly',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        `export OW_SOURCED_VALUE=loaded\ntrap ${shell.endsWith('zsh') ? '-- ' : ''}'printf cleaned > cleanup-marker' EXIT\n`,
      )
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: { workspaceId: 'trap', projectPath: directory, workspacePath: directory },
          invocation: {
            type: 'command',
            command: 'source ./setup-env; export OW_TRAP_EXPORT=yes; exit 0',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_SOURCED_VALUE: 'loaded', OW_TRAP_EXPORT: 'yes' },
        })
        expect(existsSync(join(directory, 'cleanup-marker'))).toBe(true)
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(['/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh'])(
    'captures an explicitly exiting %s setup after its sourced script registers EXIT cleanup',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        "export OW_SOURCED_VALUE=loaded\ntrap 'printf cleaned > cleanup-marker' EXIT\n",
      )
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: { workspaceId: 'trap', projectPath: directory, workspacePath: directory },
          invocation: {
            type: 'command',
            command: '. ./setup-env; export OW_TRAP_EXPORT=yes; exit 0',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_SOURCED_VALUE: 'loaded', OW_TRAP_EXPORT: 'yes' },
        })
        expect(existsSync(join(directory, 'cleanup-marker'))).toBe(true)
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
        command:
          "export OW_PREPARATION_VALUE='a value with spaces'; export OW_MULTILINE='first\nsecond'; exit 0",
        directory: '.',
      },
    })
    expect(succeeded).toMatchObject({
      exitCode: 0,
      environment: { OW_PREPARATION_VALUE: 'a value with spaces', OW_MULTILINE: 'first\nsecond' },
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
