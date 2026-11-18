import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'
import { preparationCaptureInvocation } from '../preparation-shell-capture'

const shells = [
  { shell: '/bin/bash', source: 'source' },
  { shell: '/bin/zsh', source: 'source' },
  { shell: '/bin/sh', source: '.' },
  { shell: '/bin/dash', source: '.' },
  { shell: '/bin/ksh', source: '.' },
  { shell: '/bin/mksh', source: '.' },
]
const prefixedShells = shells.flatMap(({ shell, source }) =>
  shell === '/bin/bash' || shell === '/bin/zsh'
    ? [
        { shell, source, prefix: 'command' },
        { shell, source, prefix: 'builtin' },
      ]
    : [{ shell, source, prefix: 'command' }],
)
const resetCases = [
  { shell: '/bin/bash', reset: 'trap EXIT' },
  { shell: '/bin/bash', reset: 'trap 0' },
  { shell: '/bin/bash', reset: 'command trap EXIT' },
  { shell: '/bin/bash', reset: 'builtin trap 0' },
  { shell: '/bin/zsh', reset: 'trap EXIT' },
  { shell: '/bin/zsh', reset: 'trap 0' },
  { shell: '/bin/zsh', reset: 'command trap EXIT' },
  { shell: '/bin/zsh', reset: 'builtin trap 0' },
  { shell: '/bin/sh', reset: 'trap 0' },
  { shell: '/bin/dash', reset: 'command trap 0' },
]
const saveQueries = ['/bin/bash', '/bin/zsh'].flatMap((shell) =>
  [
    'trap -p EXIT',
    'trap -p',
    'trap',
    'trap --',
    'command trap -p EXIT',
    'builtin trap -p EXIT',
  ].map((query) => ({
    shell,
    query,
  })),
)

describe.skipIf(process.platform === 'win32')('real setup EXIT trap capture', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-trap-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.for(prefixedShells)(
    'captures exports after $prefix trap registration in $shell',
    async ({ shell, prefix, source }, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        `export OW_BEFORE_TRAP=yes\n${prefix} trap 'printf cleaned > cleanup-marker' EXIT\n`,
      )
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'prefixed-trap',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: `${source} ./setup-env; export OW_AFTER_TRAP=yes; exit 0`,
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({
          exitCode: 0,
          environment: { OW_BEFORE_TRAP: 'yes', OW_AFTER_TRAP: 'yes' },
        })
        expect(existsSync(join(directory, 'cleanup-marker'))).toBe(true)
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(resetCases)(
    'retains environment capture after $reset in $shell',
    async ({ shell, reset }, context) => {
      if (!existsSync(shell)) context.skip()
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'trap-reset',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: `trap 'printf unexpected > user-cleanup' EXIT; ${reset}; export OW_AFTER_RESET=yes; exit 0`,
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result).toMatchObject({ exitCode: 0, environment: { OW_AFTER_RESET: 'yes' } })
        expect(existsSync(join(directory, 'user-cleanup'))).toBe(false)
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(saveQueries)(
    'restores the logical EXIT trap saved with $query by a sourced script in $shell',
    async ({ shell, query }, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        [
          "trap 'printf saved > cleanup-marker' EXIT",
          `saved=$(${query})`,
          "trap 'printf replaced > cleanup-marker' EXIT",
          'eval "$saved"',
        ].join('\n'),
      )
      const destination = join(directory, 'environment.nul')
      const capture = await preparationCaptureInvocation(
        {
          type: 'command',
          command: 'source ./setup-env; export OW_AFTER_RESTORE=yes; exit 0',
          cwd: directory,
        },
        destination,
        shell,
        {},
      )
      if (capture.invocation.type !== 'executable') throw new Error('Expected a shell invocation')

      const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
        cwd: capture.invocation.cwd,
        encoding: 'utf8',
        timeout: 5_000,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(await readFile(join(directory, 'cleanup-marker'), 'utf8')).toBe('saved')
      expect(await readFile(destination, 'utf8')).toContain('OW_AFTER_RESTORE=yes\0')
    },
  )

  it.for(['/bin/bash', '/bin/zsh'])(
    'does not expose the private EXIT trap before or after a user reset in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const destination = join(directory, 'environment.nul')
      const capture = await preparationCaptureInvocation(
        {
          type: 'command',
          command:
            'if [ -n "$(trap -p EXIT)" ]; then exit 33; fi; trap "printf unexpected > cleanup-marker" EXIT; trap - EXIT; if [ -n "$(trap -p EXIT)" ]; then exit 34; fi; export OW_AFTER_RESET=yes; exit 0',
          cwd: directory,
        },
        destination,
        shell,
        {},
      )
      if (capture.invocation.type !== 'executable') throw new Error('Expected a shell invocation')

      const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
        cwd: capture.invocation.cwd,
        encoding: 'utf8',
        timeout: 5_000,
      })
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(join(directory, 'cleanup-marker'))).toBe(false)
      expect(await readFile(destination, 'utf8')).toContain('OW_AFTER_RESET=yes\0')
    },
  )

  it.for(shells)(
    'preserves failed setup status for a sourced EXIT trap in $shell',
    async ({ shell, source }, context) => {
      if (!existsSync(shell)) context.skip()
      await writeFile(
        join(directory, 'setup-env'),
        'trap \'ow_observed_status=$?; printf "%s" "$ow_observed_status" > observed-exit; if [ "$ow_observed_status" -ne 0 ]; then printf rollback > rollback-marker; fi\' EXIT\n',
      )
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        const result = await execute({
          workspace: {
            workspaceId: 'trap-status',
            projectPath: directory,
            workspacePath: directory,
          },
          invocation: {
            type: 'command',
            command: `${source} ./setup-env; set -e; exit 9`,
            directory: '.',
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
        })
        expect(result.exitCode).toBe(9)
        expect(await readFile(join(directory, 'observed-exit'), 'utf8')).toBe('9')
        expect(await readFile(join(directory, 'rollback-marker'), 'utf8')).toBe('rollback')
      } finally {
        await execute.shutdown()
      }
    },
  )

  it.for(['/bin/bash', '/bin/sh'])(
    'passes the setup status to EXIT cleanup when the environment dump fails in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const capture = await preparationCaptureInvocation(
        {
          type: 'command',
          command: 'trap \'printf "%s" "$?" > observed-exit\' EXIT; exit 0',
          cwd: directory,
        },
        directory,
        shell,
        {},
      )
      if (capture.invocation.type !== 'executable') throw new Error('Expected a shell invocation')
      const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
        cwd: capture.invocation.cwd,
        encoding: 'utf8',
      })
      expect(result.status).not.toBe(0)
      expect(await readFile(join(directory, 'observed-exit'), 'utf8')).toBe('0')
    },
  )
})
