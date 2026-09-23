import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe.skipIf(process.platform === 'win32')('preparation shell fallback', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-shell-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('uses a capture-capable fallback after an unsupported configured shell', async () => {
    const unsupported = join(directory, 'tcsh')
    await writeFile(unsupported, '#!/bin/sh\nprintf unsupported > unsupported-ran\nexit 9\n', {
      mode: 0o700,
    })
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    try {
      const result = await execute({
        workspace: {
          workspaceId: 'shell-fallback',
          projectPath: directory,
          workspacePath: directory,
        },
        invocation: {
          type: 'command',
          command: 'export OW_FALLBACK=yes; exit 0',
          directory: '.',
        },
        environment: { SHELL: unsupported },
        captureEnvironment: true,
        onOutput: () => {},
      })
      expect(result).toMatchObject({ exitCode: 0, environment: { OW_FALLBACK: 'yes' } })
      expect(existsSync(join(directory, 'unsupported-ran'))).toBe(false)
    } finally {
      await execute.shutdown()
    }
  })
})
