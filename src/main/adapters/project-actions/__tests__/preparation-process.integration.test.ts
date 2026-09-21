import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

describe.skipIf(process.platform === 'win32')('real preparation environment capture', () => {
  let directory = ''
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ow-prepare-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  it('captures successful shell exports, including an explicit exit, without publishing failed exports', async () => {
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const input = {
      workspace: { workspaceId: 'test', projectPath: directory, workspacePath: directory },
      environment: {},
      captureEnvironment: true,
      onOutput: () => {},
    }
    const succeeded = await execute({
      ...input,
      invocation: {
        type: 'command',
        command: "export OW_PREPARATION_VALUE='a value with spaces'; exit 0",
        directory: '.',
      },
    })
    expect(succeeded).toMatchObject({
      exitCode: 0,
      environment: { OW_PREPARATION_VALUE: 'a value with spaces' },
    })
    const failed = await execute({
      ...input,
      invocation: {
        type: 'command',
        command: 'export OW_FAILED_VALUE=bad; exit 9',
        directory: '.',
      },
    })
    expect(failed).toEqual({ exitCode: 9, environment: {} })
  })
})
