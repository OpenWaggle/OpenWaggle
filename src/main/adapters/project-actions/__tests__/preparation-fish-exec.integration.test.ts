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
