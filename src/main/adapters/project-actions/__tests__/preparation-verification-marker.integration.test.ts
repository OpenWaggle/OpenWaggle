import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe.skipIf(process.platform === 'win32')('Setup export verification', () => {
  it.each(['__ow_mark_export', '__ow_capture_exec final'])(
    'rejects a call to the former %s helper before an unrecognized dynamic exec',
    async (helper) => {
      if (!existsSync('/bin/bash')) return
      const directory = await mkdtemp(join(tmpdir(), 'ow-setup-marker-'))
      const execute = createPreparationExecutor(
        createActionProcessRunner('test'),
        directory,
        'test',
      )
      try {
        await expect(
          execute({
            workspace: { workspaceId: 'marker', projectPath: directory, workspacePath: directory },
            invocation: {
              type: 'command',
              command: `${helper}; export OW_READY=after; runner=exec; "$runner" /usr/bin/true`,
              directory: '.',
            },
            environment: { SHELL: '/bin/bash' },
            captureEnvironment: true,
            onOutput: () => {},
          }),
        ).rejects.toThrow('without a verified environment export')
      } finally {
        await execute.shutdown()
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
