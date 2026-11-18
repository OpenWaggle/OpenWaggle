import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe.skipIf(process.platform === 'win32')('Bash Setup builtin -- capture', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-builtin-option-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each([
    ['direct', String.raw`export OW_BUILTIN_OPTION=direct; builtin -- \exec /usr/bin/true`],
    [
      'dynamic',
      String.raw`code='export OW_BUILTIN_OPTION=dynamic; builtin -- \exec /usr/bin/true'; eval "$code"`,
    ],
    [
      'eval',
      String.raw`code='export OW_BUILTIN_OPTION=eval; \exec /usr/bin/true'; builtin -- \eval "$code"`,
    ],
  ])('captures %s builtin -- execution', async (expected, command) => {
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    try {
      const result = await execute({
        workspace: {
          workspaceId: 'builtin-option',
          projectPath: directory,
          workspacePath: directory,
        },
        invocation: { type: 'command', command, directory: '.' },
        environment: { SHELL: '/bin/bash' },
        captureEnvironment: true,
        onOutput: () => {},
      })
      expect(result).toMatchObject({
        exitCode: 0,
        environment: { OW_BUILTIN_OPTION: expected },
      })
    } finally {
      await execute.shutdown()
    }
  })
})
