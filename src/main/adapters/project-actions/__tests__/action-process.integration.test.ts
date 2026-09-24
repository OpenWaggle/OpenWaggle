import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { type ActionProcess, createActionProcessRunner } from '../action-process'

let root: string
const live: ActionProcess[] = []
const powerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const powerShellAvailable =
  spawnSync(powerShell, ['-NoLogo', '-NonInteractive', '-Command', '$null']).status === 0
const failedNative = process.platform === 'win32' ? '& cmd.exe /c exit 7' : '& /usr/bin/false'
const nativeExitSeven =
  process.platform === 'win32' ? '& cmd.exe /c exit 7' : "& /bin/sh -c 'exit 7'"
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwaggle-action-process-'))
})
afterEach(async () => {
  for (const process of live.splice(0)) await process.stop()
  await rm(root, { recursive: true, force: true })
})

it('runs a finite command through an owned PTY and retains its actual exit code and output', async () => {
  const runner = createActionProcessRunner('test')
  let output = ''
  const child = await runner.start({
    invocation: {
      type: 'executable',
      executable: process.execPath,
      args: ['-e', 'console.log("action evidence"); process.exitCode = 7'],
      cwd: root,
    },
    environment: {},
    onOutput: (chunk) => {
      output += chunk
    },
  })
  live.push(child)
  expect(await child.closed).toEqual({ exitCode: 7 })
  expect(output).toContain('action evidence')
})

it.skipIf(!powerShellAvailable)(
  'treats a handled earlier native failure as a successful PowerShell action',
  async () => {
    const runner = createActionProcessRunner('test')
    let output = ''
    const child = await runner.start({
      invocation: {
        type: 'command',
        command: `${failedNative}; Write-Output "handled"`,
        cwd: root,
      },
      environment: { SHELL: powerShell },
      onOutput: (chunk) => {
        output += chunk
      },
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 0 })
    expect(output).toContain('handled')
  },
)

it.skipIf(!powerShellAvailable)('retains a final native PowerShell exit code', async () => {
  const runner = createActionProcessRunner('test')
  const child = await runner.start({
    invocation: { type: 'command', command: nativeExitSeven, cwd: root },
    environment: { SHELL: powerShell },
    onOutput: () => {},
  })
  live.push(child)
  expect(await child.closed).toEqual({ exitCode: 7 })
})

it.skipIf(!powerShellAvailable)(
  'uses exit code one for a final PowerShell cmdlet failure',
  async () => {
    const runner = createActionProcessRunner('test')
    const child = await runner.start({
      invocation: { type: 'command', command: "Write-Error 'failed'", cwd: root },
      environment: { SHELL: powerShell },
      onOutput: () => {},
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 1 })
  },
)

it('stops the same owned service process and waits for its process tree to exit', async () => {
  const runner = createActionProcessRunner('test')
  const ready = Promise.withResolvers<void>()
  let output = ''
  const child = await runner.start({
    invocation: {
      type: 'executable',
      executable: process.execPath,
      args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
      cwd: root,
    },
    environment: {},
    onOutput: (chunk) => {
      output += chunk
      if (output.includes('ready')) ready.resolve()
    },
  })
  live.push(child)
  await ready.promise
  expect(() => process.kill(child.pid, 0)).not.toThrow()
  await child.stop()
  await child.closed
  expect(() => process.kill(child.pid, 0)).toThrow()
})

it('diagnoses a missing runner before launching a replacement', async () => {
  const runner = createActionProcessRunner('test')
  await expect(
    runner.validate(
      { type: 'executable', executable: 'openwaggle-nonexistent-test-runner', args: [], cwd: root },
      {},
    ),
  ).rejects.toThrow('Runner unavailable')
})
