import { existsSync } from 'node:fs'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createActionProcessRunner } from '../action-process'
import { createPreparationExecutor } from '../preparation-process'

it.each([
  { shell: '/bin/dash', command: `e$'va'l true` },
  { shell: '/bin/dash', command: String.raw`code="e\$'va'l true"; eval "$code"` },
  { shell: '/bin/zsh', command: `$"ev"al true` },
  { shell: '/bin/zsh', command: `code='$"ev"al true'; eval "$code"` },
])('keeps unsupported dollar quotes invalid in $shell: $command', async ({ shell, command }) => {
  if (!existsSync(shell)) return
  const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-unsupported-quotes-'))
  try {
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const result = await execute({
      workspace: {
        workspaceId: 'unsupported-quotes',
        projectPath: directory,
        workspacePath: directory,
      },
      environment: { SHELL: shell },
      captureEnvironment: true,
      onOutput: () => {},
      invocation: { type: 'command', command, directory: '.' },
    })
    expect(result.exitCode).not.toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.skipIf(!existsSync('/bin/dash'))('uses the target shell syntax for a sh symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ow-prepare-sh-symlink-'))
  try {
    const shell = join(directory, 'sh')
    await symlink('/bin/dash', shell)
    const execute = createPreparationExecutor(createActionProcessRunner('test'), directory, 'test')
    const result = await execute({
      workspace: {
        workspaceId: 'sh-symlink',
        projectPath: directory,
        workspacePath: directory,
      },
      environment: { SHELL: shell },
      captureEnvironment: true,
      onOutput: () => {},
      invocation: { type: 'command', command: `$"ev"al true`, directory: '.' },
    })
    expect(result.exitCode).not.toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
