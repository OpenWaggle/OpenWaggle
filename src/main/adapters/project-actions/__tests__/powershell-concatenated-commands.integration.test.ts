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
const stem = process.platform === 'win32' ? 'cmd' : 'sh'
const target = process.platform === 'win32' ? "($stem + '.exe')" : "('/bin/' + $stem)"
const failureArgs = process.platform === 'win32' ? '/c exit 7' : "-c 'exit 7'"
const successArgs = process.platform === 'win32' ? '/c exit 0' : "-c 'exit 0'"
let root: string
const live: ActionProcess[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwaggle-powershell-concat-'))
})
afterEach(async () => {
  for (const process of live.splice(0)) await process.stop()
  await rm(root, { recursive: true, force: true })
})

it.skipIf(!powerShellAvailable)(
  'retains native Action failure from an inert concatenated target',
  async () => {
    const runner = createActionProcessRunner('test')
    const child = await runner.start({
      invocation: {
        type: 'command',
        command: `$stem = '${stem}'; & ${target} ${failureArgs}`,
        cwd: root,
      },
      environment: { SHELL: powerShell },
      onOutput: () => {},
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 7 })
  },
)

it.skipIf(!powerShellAvailable)(
  'retains native Setup failure from an inert concatenated target',
  async () => {
    const destination = join(root, 'failed-environment.json')
    const capture = await preparationCaptureInvocation(
      {
        type: 'command',
        cwd: root,
        command: `$env:OW_CONCAT_SETUP = 'loaded'; $stem = '${stem}'; & ${target} ${failureArgs}`,
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
  'captures successful Setup after an inert concatenated target',
  async () => {
    const destination = join(root, 'successful-environment.json')
    const capture = await preparationCaptureInvocation(
      {
        type: 'command',
        cwd: root,
        command: `$env:OW_CONCAT_SETUP = 'loaded'; $stem = '${stem}'; & ${target} ${successArgs}`,
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
    expect(result.status).toBe(0)
    expect(JSON.parse(await readFile(destination, 'utf8'))).toMatchObject({
      OW_CONCAT_SETUP: 'loaded',
    })
  },
)

it.skipIf(!powerShellAvailable)(
  'does not evaluate a side-effecting target twice to classify failure',
  async () => {
    const marker = join(root, 'target-evaluation.txt')
    const prefix = process.platform === 'win32' ? '' : '/bin/'
    const runner = createActionProcessRunner('test')
    const child = await runner.start({
      invocation: {
        type: 'command',
        command: `$stem = '${stem}'; & ($(Add-Content -Path '${marker}' -Value touched; '${prefix}') + $stem) ${failureArgs}`,
        cwd: root,
      },
      environment: { SHELL: powerShell },
      onOutput: () => {},
    })
    live.push(child)
    expect(await child.closed).toEqual({ exitCode: 1 })
    expect((await readFile(marker, 'utf8')).trim()).toBe('touched')
  },
)
