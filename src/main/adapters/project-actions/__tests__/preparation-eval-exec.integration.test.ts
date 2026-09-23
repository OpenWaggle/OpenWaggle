import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
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
    } finally {
      await execute.shutdown()
    }
  })
})
