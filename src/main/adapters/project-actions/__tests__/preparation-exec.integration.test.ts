import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh']

describe.skipIf(process.platform === 'win32')('setup commands using exec', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-exec-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.for(shells)(
    'captures exports before direct, evaluated, and sourced exec in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        'export OW_SOURCED_EXEC=loaded\nexec /usr/bin/true\n',
      )
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      const input = {
        workspace: { workspaceId: 'exec', projectPath: directory, workspacePath: directory },
        environment: { SHELL: shell },
        captureEnvironment: true,
        onOutput: () => {},
      }
      try {
        const direct = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: 'export OW_DIRECT_EXEC=loaded; exec /usr/bin/true',
            directory: '.',
          },
        })
        expect(direct).toMatchObject({ exitCode: 0, environment: { OW_DIRECT_EXEC: 'loaded' } })

        const evaluated = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`export OW_EVAL_ESCAPED=loaded; eval '\exec /usr/bin/true'`,
            directory: '.',
          },
        })
        expect(evaluated).toMatchObject({ exitCode: 0, environment: { OW_EVAL_ESCAPED: 'loaded' } })

        const sourced = await execute({
          ...input,
          invocation: { type: 'command', command: '. ./setup-env', directory: '.' },
        })
        expect(sourced).toMatchObject({ exitCode: 0, environment: { OW_SOURCED_EXEC: 'loaded' } })

        const output: string[] = []
        const assigned = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: 'OW_EXEC_TEMP=passed exec /usr/bin/printenv OW_EXEC_TEMP',
            directory: '.',
          },
          onOutput: (chunk) => output.push(chunk),
        })
        expect(assigned.exitCode).toBe(0)
        expect(output.join('')).toContain('passed')
        expect(assigned.environment.OW_EXEC_TEMP).toBeUndefined()

        const failed = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: 'export OW_FAILED_EXEC=discarded; exec /usr/bin/false',
            directory: '.',
          },
        })
        expect(failed).toEqual({ exitCode: 1, environment: input.environment })
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(shells)(
    'preserves redirect-only exec and captures later exports in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: { workspaceId: 'redirect', projectPath: directory, workspacePath: directory },
          invocation: {
            type: 'command',
            command: 'exec > redirect-marker; export OW_AFTER_REDIRECT=loaded; printf redirected',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_AFTER_REDIRECT: 'loaded' },
        })
        expect(await readFile(join(directory, 'redirect-marker'), 'utf8')).toBe('redirected')
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(['/bin/bash', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh'])(
    'captures exports before command exec in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'command-exec',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: 'export OW_COMMAND_EXEC=loaded; command exec /usr/bin/true',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({ exitCode: 0, environment: { OW_COMMAND_EXEC: 'loaded' } })

        const output: string[] = []
        const assigned = await execute({
          workspace: {
            workspaceId: 'command-exec-assignment',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: 'OW_COMMAND_TEMP=passed command exec /usr/bin/printenv OW_COMMAND_TEMP',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: (chunk) => output.push(chunk),
        })
        expect(assigned.exitCode).toBe(0)
        expect(output.join('')).toContain('passed')
        expect(assigned.environment.OW_COMMAND_TEMP).toBeUndefined()
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(['/bin/bash', '/bin/zsh'])(
    'captures exports before builtin exec in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'builtin-exec',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: 'export OW_BUILTIN_EXEC=loaded; builtin exec /usr/bin/true',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({ exitCode: 0, environment: { OW_BUILTIN_EXEC: 'loaded' } })
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(shells)('captures exports before escaped exec in %s', async (shell, context) => {
    if (!existsSync(shell)) context.skip()
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    try {
      const result = await execute({
        workspace: { workspaceId: 'escaped', projectPath: directory, workspacePath: directory },
        invocation: {
          type: 'command',
          command: 'export OW_ESCAPED_EXEC=loaded; \\exec /usr/bin/true',
          directory: '.',
        },
        environment: { SHELL: shell },
        captureEnvironment: true,
        onOutput: () => {},
      })
      expect(result).toMatchObject({ exitCode: 0, environment: { OW_ESCAPED_EXEC: 'loaded' } })
    } finally {
      await execute.shutdown()
    }
  })

  it.for(['/bin/bash', '/bin/sh', '/bin/dash'])(
    'captures exports before escaped command exec in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'escaped-command',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: 'export OW_ESCAPED_COMMAND=loaded; \\command exec /usr/bin/true',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_ESCAPED_COMMAND: 'loaded' },
        })
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(['/bin/bash', '/bin/zsh'])(
    'captures exports before escaped builtin exec in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'escaped-builtin',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: 'export OW_ESCAPED_BUILTIN=loaded; \\builtin exec /usr/bin/true',
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_ESCAPED_BUILTIN: 'loaded' },
        })
      } finally {
        await execute.shutdown()
      }
    },
  )
})
