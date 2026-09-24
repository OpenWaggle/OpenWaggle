import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh']

describe.skipIf(process.platform === 'win32')('setup commands using evaluated exec', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-eval-exec-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.for(shells)('captures exports before and inside eval in %s', async (shell, context) => {
    if (!existsSync(shell)) context.skip()
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const input = {
      workspace: { workspaceId: 'eval-exec', projectPath: directory, workspacePath: directory },
      environment: { SHELL: shell },
      captureEnvironment: true,
      onOutput: () => {},
    }
    try {
      const before = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`export OW_EVAL_BEFORE=loaded; eval '\exec /usr/bin/true'`,
          directory: '.',
        },
      })
      expect(before).toMatchObject({ exitCode: 0, environment: { OW_EVAL_BEFORE: 'loaded' } })

      const inside = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`eval 'export OW_EVAL_INSIDE=loaded; \exec /usr/bin/true'`,
          directory: '.',
        },
      })
      expect(inside).toMatchObject({ exitCode: 0, environment: { OW_EVAL_INSIDE: 'loaded' } })

      const dynamic = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='export OW_EVAL_DYNAMIC=loaded; \exec /usr/bin/true'; eval "$code"`,
          directory: '.',
        },
      })
      expect(dynamic).toMatchObject({ exitCode: 0, environment: { OW_EVAL_DYNAMIC: 'loaded' } })

      const escapedEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='export OW_ESCAPED_EVAL=loaded; \exec /usr/bin/true'; \eval "$code"`,
          directory: '.',
        },
      })
      expect(escapedEval).toMatchObject({
        exitCode: 0,
        environment: { OW_ESCAPED_EVAL: 'loaded' },
      })

      const argument = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='export OW_ESCAPED_ARGUMENT=loaded; export OW_ESCAPED_LITERAL=$(printf '%s' \eval)'; eval "$code"`,
          directory: '.',
        },
      })
      expect(argument).toMatchObject({
        exitCode: 0,
        environment: { OW_ESCAPED_ARGUMENT: 'loaded', OW_ESCAPED_LITERAL: 'eval' },
      })

      const conditionalEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='if true; then \eval "export OW_CONDITIONAL_EVAL=loaded; \exec /usr/bin/true"; fi'; eval "$code"`,
          directory: '.',
        },
      })
      expect(conditionalEval).toMatchObject({
        exitCode: 0,
        environment: { OW_CONDITIONAL_EVAL: 'loaded' },
      })

      const nestedEscapedEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='export OW_NESTED_ESCAPED_EVAL=loaded; \exec /usr/bin/true'; wrapper='\eval "$code"'; eval "$wrapper"`,
          directory: '.',
        },
      })
      expect(nestedEscapedEval).toMatchObject({
        exitCode: 0,
        environment: { OW_NESTED_ESCAPED_EVAL: 'loaded' },
      })

      if (['/bin/bash', '/bin/sh', '/bin/dash'].includes(shell)) {
        const escapedPrefixedEval = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_ESCAPED_PREFIXED_EVAL=loaded; \exec /usr/bin/true'; command \eval "$code"`,
            directory: '.',
          },
        })
        expect(escapedPrefixedEval).toMatchObject({
          exitCode: 0,
          environment: { OW_ESCAPED_PREFIXED_EVAL: 'loaded' },
        })

        const prefixedEval = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_EVAL_COMMAND_PREFIX=loaded; \exec /usr/bin/true'; command eval "$code"`,
            directory: '.',
          },
        })
        expect(prefixedEval).toMatchObject({
          exitCode: 0,
          environment: { OW_EVAL_COMMAND_PREFIX: 'loaded' },
        })

        const commandPrefix = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_EVAL_COMMAND=loaded; \command exec /usr/bin/true'; eval "$code"`,
            directory: '.',
          },
        })
        expect(commandPrefix).toMatchObject({
          exitCode: 0,
          environment: { OW_EVAL_COMMAND: 'loaded' },
        })
      }
      if (['/bin/bash', '/bin/zsh'].includes(shell)) {
        const escapedBuiltinEval = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_ESCAPED_BUILTIN_EVAL=loaded; \exec /usr/bin/true'; builtin \eval "$code"`,
            directory: '.',
          },
        })
        expect(escapedBuiltinEval).toMatchObject({
          exitCode: 0,
          environment: { OW_ESCAPED_BUILTIN_EVAL: 'loaded' },
        })

        const prefixedEval = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_EVAL_PREFIXED=loaded; \exec /usr/bin/true'; builtin eval "$code"`,
            directory: '.',
          },
        })
        expect(prefixedEval).toMatchObject({
          exitCode: 0,
          environment: { OW_EVAL_PREFIXED: 'loaded' },
        })

        const builtinPrefix = await execute({
          ...input,
          invocation: {
            type: 'command',
            command: String.raw`code='export OW_EVAL_BUILTIN=loaded; \builtin exec /usr/bin/true'; eval "$code"`,
            directory: '.',
          },
        })
        expect(builtinPrefix).toMatchObject({
          exitCode: 0,
          environment: { OW_EVAL_BUILTIN: 'loaded' },
        })
      }

      const literal = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='printf "%s" "\exec" > literal.txt; export OW_EVAL_LITERAL=loaded'; eval "$code"`,
          directory: '.',
        },
      })
      expect(literal).toMatchObject({ exitCode: 0, environment: { OW_EVAL_LITERAL: 'loaded' } })
      expect(await readFile(join(directory, 'literal.txt'), 'utf8')).toBe(String.raw`\exec`)

      const heredoc = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`code='cat > heredoc.txt <<EOF
\exec
EOF
export OW_EVAL_HEREDOC=loaded'; eval "$code"`,
          directory: '.',
        },
      })
      expect(heredoc).toMatchObject({ exitCode: 0, environment: { OW_EVAL_HEREDOC: 'loaded' } })
      expect(await readFile(join(directory, 'heredoc.txt'), 'utf8')).toBe(`${String.raw`\exec`}\n`)

      const missingRewriter = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: String.raw`PATH=''; code='export OW_EVAL_MISSING=loaded; \exec /usr/bin/true'; eval "$code"`,
          directory: '.',
        },
      })
      expect(missingRewriter.exitCode).not.toBe(0)
      expect(missingRewriter.environment).not.toHaveProperty('OW_EVAL_MISSING')
    } finally {
      await execute.shutdown()
    }
  })
})
