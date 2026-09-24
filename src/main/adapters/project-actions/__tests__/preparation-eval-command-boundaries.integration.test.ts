import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh']
const arithmeticShells = ['/bin/bash', '/bin/zsh', '/bin/ksh', '/bin/mksh']

const cases: {
  variable: string
  command: string
  expected?: string
  supportedShells?: string[]
}[] = [
  {
    variable: 'OW_QUOTED_NEWLINE',
    command: `printf '%s' "foo\nbar"; export OW_QUOTED_NEWLINE=loaded; ex\\ec /usr/bin/true`,
  },
  {
    variable: 'OW_DYNAMIC_QUOTED_NEWLINE',
    command: `code='printf "%s" "foo\nbar"; export OW_DYNAMIC_QUOTED_NEWLINE=loaded; ex\\ec /usr/bin/true'; eval "$code"`,
  },
  ...(["'EOF'", '"EOF"', String.raw`\EOF`] as const).map((delimiter) => ({
    variable: 'OW_HEREDOC_LITERAL',
    command: `code=$(cat <<'SCRIPT'\ncat <<${delimiter} > literal.txt\nex\\ec\nEOF\nSCRIPT\n); eval "$code"; export OW_HEREDOC_LITERAL=$(cat literal.txt); \\exec /usr/bin/true`,
    expected: String.raw`ex\ec`,
  })),
  ...(["'END.JSON'", '"END.JSON"', String.raw`\END.JSON`] as const).map((delimiter) => ({
    variable: 'OW_PUNCTUATED_HEREDOC',
    command: `code=$(cat <<'SCRIPT'\ncat <<${delimiter} > literal.txt\nex\\ec literal\nEND.JSON\nSCRIPT\n); eval "$code"; export OW_PUNCTUATED_HEREDOC=$(cat literal.txt); \\exec /usr/bin/true`,
    expected: String.raw`ex\ec literal`,
  })),
  {
    variable: 'OW_MULTIPLE_PUNCTUATED_HEREDOCS',
    command: `code=$(cat <<'SCRIPT'\ncat <<'ONE.JSON' > ignored.txt; cat <<'TWO.JSON' > literal.txt\nex\\ec ignored\nONE.JSON\nex\\ec literal\nTWO.JSON\nSCRIPT\n); eval "$code"; export OW_MULTIPLE_PUNCTUATED_HEREDOCS=$(cat literal.txt); \\exec /usr/bin/true`,
    expected: String.raw`ex\ec literal`,
  },
  {
    variable: 'OW_ARITHMETIC_SHIFT',
    command: String.raw`export OW_ARITHMETIC_SHIFT=loaded; : $((1 << 2))
ex\ec /usr/bin/true`,
  },
  {
    variable: 'OW_DYNAMIC_ARITHMETIC_SHIFT',
    command: String.raw`code='export OW_DYNAMIC_ARITHMETIC_SHIFT=loaded; : $((1 << 2))
ex\ec /usr/bin/true'; eval "$code"`,
  },
  {
    variable: 'OW_ARITHMETIC_COMMAND_SHIFT',
    supportedShells: arithmeticShells,
    command: String.raw`export OW_ARITHMETIC_COMMAND_SHIFT=loaded; ((1 << 2))
ex\ec /usr/bin/true`,
  },
  {
    variable: 'OW_DYNAMIC_ARITHMETIC_COMMAND_SHIFT',
    supportedShells: arithmeticShells,
    command: String.raw`code='export OW_DYNAMIC_ARITHMETIC_COMMAND_SHIFT=loaded; ((1 << 2))
ex\ec /usr/bin/true'; eval "$code"`,
  },
  {
    variable: 'OW_INLINE_FUNCTION_EVAL',
    command: String.raw`code='export OW_INLINE_FUNCTION_EVAL=loaded; \exec /usr/bin/true'; f() { \eval "$code"; }; f`,
  },
  {
    variable: 'OW_DYNAMIC_INLINE_FUNCTION_EVAL',
    command: String.raw`code='export OW_DYNAMIC_INLINE_FUNCTION_EVAL=loaded; \exec /usr/bin/true'; wrapper='f() { \eval "$code"; }; f'; eval "$wrapper"`,
  },
  {
    variable: 'OW_FUNCTION_KEYWORD_EVAL',
    supportedShells: arithmeticShells,
    command: String.raw`code='export OW_FUNCTION_KEYWORD_EVAL=loaded; \exec /usr/bin/true'; function g { \eval "$code"; }; g`,
  },
  {
    variable: 'OW_DYNAMIC_FUNCTION_KEYWORD_EVAL',
    supportedShells: arithmeticShells,
    command: String.raw`code='export OW_DYNAMIC_FUNCTION_KEYWORD_EVAL=loaded; \exec /usr/bin/true'; wrapper='function g { \eval "$code"; }; g'; eval "$wrapper"`,
  },
  {
    variable: 'OW_QUOTED_EVAL',
    command: String.raw`code='export OW_QUOTED_EVAL=loaded; \exec /usr/bin/true'; e"va"l "$code"`,
  },
  {
    variable: 'OW_COMMAND_DASH_DASH_EVAL',
    command: String.raw`code='export OW_COMMAND_DASH_DASH_EVAL=loaded; \exec /usr/bin/true'; command -- \eval "$code"`,
  },
  {
    variable: 'OW_DYNAMIC_COMMAND_DASH_DASH_EVAL',
    command: String.raw`code='export OW_DYNAMIC_COMMAND_DASH_DASH_EVAL=loaded; \exec /usr/bin/true'; wrapper='command -- \eval "$code"'; eval "$wrapper"`,
  },
  {
    variable: 'OW_COMMAND_DEFAULT_PATH_EVAL',
    command: String.raw`code='export OW_COMMAND_DEFAULT_PATH_EVAL=loaded; \exec /usr/bin/true'; command -p \eval "$code"`,
  },
  {
    variable: 'OW_COMMAND_OPTIONS_COMBINED_EVAL',
    command: String.raw`code='export OW_COMMAND_OPTIONS_COMBINED_EVAL=loaded; \exec /usr/bin/true'; command -p -- \eval "$code"`,
  },
  {
    variable: 'OW_DYNAMIC_COMMAND_OPTIONS_COMBINED_EVAL',
    command: String.raw`code='export OW_DYNAMIC_COMMAND_OPTIONS_COMBINED_EVAL=loaded; \exec /usr/bin/true'; wrapper='command -p -- \eval "$code"'; eval "$wrapper"`,
  },
  {
    variable: 'OW_DYNAMIC_QUOTED_EVAL',
    command: String.raw`code='export OW_DYNAMIC_QUOTED_EVAL=loaded; \exec /usr/bin/true'; wrapper='e"va"l "$code"'; eval "$wrapper"`,
  },
  {
    variable: 'OW_PARTIAL_EXEC',
    command: String.raw`export OW_PARTIAL_EXEC=loaded; ex\ec /usr/bin/true`,
  },
  {
    variable: 'OW_DYNAMIC_PARTIAL_EXEC',
    command: String.raw`code='export OW_DYNAMIC_PARTIAL_EXEC=loaded; ex\ec /usr/bin/true'; eval "$code"`,
  },
  {
    variable: 'OW_QUOTED_EXEC',
    command: 'export OW_QUOTED_EXEC=loaded; ex"e"c /usr/bin/true',
  },
  {
    variable: 'OW_DYNAMIC_QUOTED_EXEC',
    command: 'code=\'export OW_DYNAMIC_QUOTED_EXEC=loaded; ex"e"c /usr/bin/true\'; eval "$code"',
  },
  {
    variable: 'OW_PARTIAL_EXEC_ARGUMENT',
    command: String.raw`code='export OW_PARTIAL_EXEC_ARGUMENT=$(printf "%s" ex\ec); \exec /usr/bin/true'; eval "$code"`,
    expected: 'exec',
  },
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
  {
    variable: 'OW_CONTINUED_EVAL',
    command: `code='export OW_CONTINUED_EVAL=loaded; \\exec /usr/bin/true'; \\
  \\eval "$code"`,
  },
  {
    variable: 'OW_DYNAMIC_CONTINUED_EVAL',
    command: `code='export OW_DYNAMIC_CONTINUED_EVAL=loaded; \\exec /usr/bin/true'; wrapper='\\
  \\eval "$code"'; eval "$wrapper"`,
  },
  {
    variable: 'OW_CONTINUED_ARGUMENT',
    command: `code='export OW_CONTINUED_ARGUMENT=$(printf "%s" \\
  \\eval); \\exec /usr/bin/true'; eval "$code"`,
    expected: 'eval',
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
        for (const { variable, command, expected, supportedShells } of cases) {
          if (supportedShells && !supportedShells.includes(shell)) continue
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

  it.skipIf(!existsSync('/bin/bash'))('captures an escaped eval after Bash time -p', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-time-prefix-'))
    try {
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      const result = await execute({
        workspace: {
          workspaceId: 'time-prefix',
          projectPath: directory,
          workspacePath: directory,
        },
        environment: { SHELL: '/bin/bash' },
        captureEnvironment: true,
        onOutput: () => {},
        invocation: {
          type: 'command',
          command: String.raw`code='export OW_TIME_PREFIX_EVAL=loaded; \exec /usr/bin/true'; time -p \eval "$code"`,
          directory: '.',
        },
      })
      expect(result).toMatchObject({
        exitCode: 0,
        environment: { OW_TIME_PREFIX_EVAL: 'loaded' },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
