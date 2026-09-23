import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { getSessionHostChildEnv } from '../../../env'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const fish = getSessionHostChildEnv().OPENWAGGLE_QA_FISH ?? '/usr/bin/fish'

it.skipIf(process.platform === 'win32')(
  'captures Fish exports before direct exec',
  async (context) => {
    if (!existsSync(fish)) context.skip()
    const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-fish-exec-'))
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const input = {
      workspace: { workspaceId: 'fish-exec', projectPath: directory, workspacePath: directory },
      environment: { SHELL: fish },
      captureEnvironment: true,
      onOutput: () => {},
    }
    try {
      const direct = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: 'set -gx OW_FISH_DIRECT_EXEC loaded; exec /usr/bin/true',
          directory: '.',
        },
      })
      expect(direct).toMatchObject({ exitCode: 0, environment: { OW_FISH_DIRECT_EXEC: 'loaded' } })

      const local = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: 'set -lx OW_FISH_LOCAL_EXEC loaded; exec /usr/bin/true',
          directory: '.',
        },
      })
      expect(local).toMatchObject({ exitCode: 0, environment: { OW_FISH_LOCAL_EXEC: 'loaded' } })

      const evaluated = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: "eval 'set -gx OW_FISH_EVAL_EXEC loaded; exec /usr/bin/true'",
          directory: '.',
        },
      })
      expect(evaluated).toMatchObject({ exitCode: 0, environment: { OW_FISH_EVAL_EXEC: 'loaded' } })

      const localEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: "eval 'set -lx OW_FISH_EVAL_LOCAL loaded'; /usr/bin/true",
          directory: '.',
        },
      })
      expect(localEval).toMatchObject({
        exitCode: 0,
        environment: { OW_FISH_EVAL_LOCAL: 'loaded' },
      })

      const nestedEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: 'eval \'eval "set -lx OW_FISH_NESTED_LOCAL loaded"\'; /usr/bin/true',
          directory: '.',
        },
      })
      expect(nestedEval).toMatchObject({
        exitCode: 0,
        environment: { OW_FISH_NESTED_LOCAL: 'loaded' },
      })

      const dynamic = await execute({
        ...input,
        invocation: {
          type: 'command',
          command:
            "set -l code 'set -gx OW_FISH_DYNAMIC_EXEC loaded; exec /usr/bin/true'; eval $code",
          directory: '.',
        },
      })
      expect(dynamic).toMatchObject({
        exitCode: 0,
        environment: { OW_FISH_DYNAMIC_EXEC: 'loaded' },
      })

      const inherited = await execute({
        ...input,
        invocation: {
          type: 'command',
          command:
            "set -lx OW_FISH_INHERITED_EXEC before; eval 'set OW_FISH_INHERITED_EXEC loaded; exec /usr/bin/true'",
          directory: '.',
        },
      })
      expect(inherited).toMatchObject({
        exitCode: 0,
        environment: { OW_FISH_INHERITED_EXEC: 'loaded' },
      })

      const builtin = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: "builtin eval 'set -gx OW_FISH_BUILTIN_EVAL loaded; exec /usr/bin/true'",
          directory: '.',
        },
      })
      expect(builtin).toMatchObject({
        exitCode: 0,
        environment: { OW_FISH_BUILTIN_EVAL: 'loaded' },
      })

      const failedEval = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: "eval 'set -gx OW_FISH_FAILED_EVAL discarded; exec /usr/bin/false'",
          directory: '.',
        },
      })
      expect(failedEval).toEqual({ exitCode: 1, environment: input.environment })

      const failed = await execute({
        ...input,
        invocation: {
          type: 'command',
          command: 'set -gx OW_FISH_FAILED_EXEC discarded; exec /usr/bin/false',
          directory: '.',
        },
      })
      expect(failed).toEqual({ exitCode: 1, environment: input.environment })
    } finally {
      await execute.shutdown()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
