import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh']

const cases: { variable: string; command: string; expected?: string }[] = [
  {
    variable: 'OW_MULTILINE_PAREN_CASE_ARM',
    command: String.raw`code='export OW_MULTILINE_PAREN_CASE_ARM=loaded; \exec /usr/bin/true'; case x in
  (x) \eval "$code";;
esac`,
  },
  {
    variable: 'OW_DYNAMIC_MULTILINE_CASE_ARM',
    command: String.raw`code='export OW_DYNAMIC_MULTILINE_CASE_ARM=loaded; \exec /usr/bin/true'; wrapper='case x in
  (x) \eval "$code";;
esac'; eval "$wrapper"`,
  },
  {
    variable: 'OW_REDIRECTED_EVAL',
    command: String.raw`code='export OW_REDIRECTED_EVAL=loaded; \exec /usr/bin/true'; >/dev/null \eval "$code"`,
  },
  {
    variable: 'OW_DYNAMIC_REDIRECTION',
    command: String.raw`code='export OW_DYNAMIC_REDIRECTION=loaded; \exec /usr/bin/true'; wrapper='2>&1 \eval "$code"'; eval "$wrapper"`,
  },
  {
    variable: 'OW_PARAMETER_LITERAL',
    command: `VALUE=prefix; code='export OW_PARAMETER_LITERAL=$(printf "%s %s" \${VALUE} \\eval); \\exec /usr/bin/true'; eval "$code"`,
    expected: 'prefix eval',
  },
  {
    variable: 'OW_BRACE_GROUP',
    command: String.raw`code='export OW_BRACE_GROUP=loaded; \exec /usr/bin/true'; wrapper='{ \eval "$code"; }'; eval "$wrapper"`,
  },
]

describe.skipIf(process.platform === 'win32')('evaluated setup command boundaries', () => {
  it.for(shells)(
    'captures exports across case arms and redirections in %s',
    async (shell, context) => {
      if (!existsSync(shell)) context.skip()
      const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-eval-boundaries-'))
      try {
        const execute = createPreparationExecutor(
          createActionProcessRunner('test'),
          directory,
          'test',
        )
        for (const { variable, command, expected } of cases) {
          const result = await execute({
            workspace: {
              workspaceId: 'eval-boundaries',
              projectPath: directory,
              workspacePath: directory,
            },
            environment: { SHELL: shell },
            captureEnvironment: true,
            onOutput: () => {},
            invocation: { type: 'command', command, directory: '.' },
          })
          expect(result).toMatchObject({
            exitCode: 0,
            environment: { [variable]: expected ?? 'loaded' },
          })
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
