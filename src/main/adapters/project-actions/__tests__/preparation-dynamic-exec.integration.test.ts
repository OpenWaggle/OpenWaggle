import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

const shells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/bin/dash', '/bin/ksh', '/bin/mksh']

it.for(shells)(
  'rejects an unverified Setup export after dynamic exec in %s',
  async (shell, context) => {
    if (!existsSync(shell)) context.skip()
    const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-dynamic-exec-'))
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    try {
      await expect(
        execute({
          workspace: {
            workspaceId: 'dynamic-exec',
            projectPath: directory,
            workspacePath: directory,
          },
          environment: { SHELL: shell },
          captureEnvironment: true,
          onOutput: () => {},
          invocation: {
            type: 'command',
            command: 'runner=exec; export OW_DYNAMIC_EXEC=loaded; "$runner" /usr/bin/true',
            directory: '.',
          },
        }),
      ).rejects.toThrow(/verified environment export/)
    } finally {
      await execute.shutdown()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
