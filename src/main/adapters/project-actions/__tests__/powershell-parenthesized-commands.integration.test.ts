import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { type ActionProcess, createActionProcessRunner } from '../action-process'
import { preparationCaptureInvocation } from '../preparation-shell-capture'

const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const powerShellAvailable =
  spawnSync(powerShell, ['-NoLogo', '-NonInteractive', '-Command', '$null']).status === 0
const native = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
const args = process.platform === 'win32' ? '/c exit 7' : "-c 'exit 7'"
let root: string
const live: ActionProcess[] = []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwaggle-powershell-paren-'))
})
afterEach(async () => {
  for (const process of live.splice(0)) await process.stop()
  await rm(root, { recursive: true, force: true })
})

it.skipIf(!powerShellAvailable)(
  'preserves the exit code of a parenthesized indexed native action',
  async () => {
    const runner = createActionProcessRunner('test')
    for (const target of ['($commands[0])', '(($commands[0]))']) {
      const child = await runner.start({
        invocation: {
          type: 'command',
          command: `$commands = @('${native}'); & ${target} ${args}`,
          cwd: root,
        },
        environment: { SHELL: powerShell },
        onOutput: () => {},
      })
      live.push(child)
      expect(await child.closed).toEqual({ exitCode: 7 })
    }
  },
)

it.skipIf(!powerShellAvailable)(
  'preserves native exits for inert interpolated command targets',
  async () => {
    const runner = createActionProcessRunner('test')
    const stem = process.platform === 'win32' ? 'cmd' : 'sh'
    const prefixed = process.platform === 'win32' ? '"$stem.exe"' : '"/bin/$stem"'
    for (const command of [
      `$exe = '${native}'; & "$exe" ${args}`,
      `$stem = '${stem}'; & ${prefixed} ${args}`,
      `$commands = @('${native}'); & "$($commands[0])" ${args}`,
    ]) {
      const child = await runner.start({
        invocation: { type: 'command', command, cwd: root },
        environment: { SHELL: powerShell },
        onOutput: () => {},
      })
      live.push(child)
      expect(await child.closed).toEqual({ exitCode: 7 })
    }
  },
)

it.skipIf(!powerShellAvailable)(
  'preserves native exits for environment-provider command targets',
  async () => {
    const runner = createActionProcessRunner('test')
    for (const target of ['$env:OW_NATIVE_EXE', '"$env:OW_NATIVE_EXE"']) {
      const child = await runner.start({
        invocation: {
          type: 'command',
          command: `$env:OW_NATIVE_EXE = '${native}'; & ${target} ${args}`,
          cwd: root,
        },
        environment: { SHELL: powerShell },
        onOutput: () => {},
      })
      live.push(child)
      expect(await child.closed).toEqual({ exitCode: 7 })
    }
  },
)

it.skipIf(!powerShellAvailable)(
  'preserves the native exit code of a parenthesized indexed Setup command',
  async () => {
    const destination = join(root, 'environment.json')
    const capture = await preparationCaptureInvocation(
      {
        type: 'command',
        cwd: root,
        command: `$env:OW_PAREN_SETUP = 'loaded'; $commands = @('${native}'); & ($commands[0]) ${args}`,
      },
      destination,
      powerShell,
      {},
    )
    if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
    const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(7)
    await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.skipIf(!powerShellAvailable)(
  'preserves the native exit code of an interpolated Setup command',
  async () => {
    const destination = join(root, 'interpolated-environment.json')
    const capture = await preparationCaptureInvocation(
      {
        type: 'command',
        cwd: root,
        command: `$env:OW_INTERPOLATED_SETUP = 'loaded'; $exe = '${native}'; & "$exe" ${args}`,
      },
      destination,
      powerShell,
      {},
    )
    if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
    const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(7)
    await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.skipIf(!powerShellAvailable)(
  'preserves the native exit code of an environment-provider Setup command',
  async () => {
    const destination = join(root, 'provider-environment.json')
    const capture = await preparationCaptureInvocation(
      {
        type: 'command',
        cwd: root,
        command: `$env:OW_PROVIDER_SETUP = 'loaded'; $env:OW_NATIVE_EXE = '${native}'; & $env:OW_NATIVE_EXE ${args}`,
      },
      destination,
      powerShell,
      {},
    )
    if (capture.invocation.type !== 'executable') throw new Error('Expected PowerShell wrapper')
    const result = spawnSync(capture.invocation.executable, capture.invocation.args, {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(7)
    await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  },
)

it.skipIf(!powerShellAvailable)(
  'does not reevaluate a side-effecting parenthesized command while classifying failure',
  async () => {
    const marker = join(root, 'calls.txt')
    const runner = createActionProcessRunner('test')
    const child = await runner.start({
      invocation: {
        type: 'command',
        command: `& ($(Add-Content -LiteralPath '${marker}' -Value called; '${native}')) ${args}`,
        cwd: root,
      },
      environment: { SHELL: powerShell },
      onOutput: () => {},
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 1 })
    expect((await readFile(marker, 'utf8')).trim()).toBe('called')
  },
)

it.skipIf(!powerShellAvailable)(
  'does not reevaluate a side-effecting interpolation while classifying failure',
  async () => {
    const marker = join(root, 'interpolation-calls.txt')
    const runner = createActionProcessRunner('test')
    const child = await runner.start({
      invocation: {
        type: 'command',
        command: `& "$(Add-Content -LiteralPath '${marker}' -Value called; '${native}')" ${args}`,
        cwd: root,
      },
      environment: { SHELL: powerShell },
      onOutput: () => {},
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 1 })
    expect((await readFile(marker, 'utf8')).trim()).toBe('called')
  },
)
