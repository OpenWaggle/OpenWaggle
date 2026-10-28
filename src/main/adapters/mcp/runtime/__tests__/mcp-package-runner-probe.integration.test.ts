import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getSafeChildEnv } from '../../../../env'
import { createExecProbe } from '../mcp-package-runner-probe'

/**
 * A stand-in for `npx` that hangs: it starts a child (as npx starts `node`, or an install) that
 * outlives it unless its tree is stopped, writes that child's pid, and never answers.
 */
const HANGING_RUNNER = `
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
writeFileSync(process.argv[2], String(child.pid))
setInterval(() => {}, 1000)
`

const PROBE_TIMEOUT_MS = 1_000
const EXIT_POLL_MS = 50
const EXIT_WAIT_MS = 5_000

const directories: string[] = []
const spawnedPids: number[] = []

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    if (isAlive(pid)) process.kill(pid, 'SIGKILL')
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function exited(pid: number) {
  const deadline = Date.now() + EXIT_WAIT_MS
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, EXIT_POLL_MS))
  }
  return false
}

/** What the probe's child needs to start, on each platform. */
function probeEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getSafeChildEnv()).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]],
    ),
  )
}

/*
 * Review V1 P3-1: on a probe timeout only the probe's root process (`cmd.exe` on Windows, `npx`
 * elsewhere) was killed, and `npx`'s `node` and any install it started ran on for the Host's life.
 * This runs on Windows too, through `cmd.exe` and `taskkill /T`.
 */
describe('package runner probe timeout', () => {
  it('stops everything the hung probe started, not only its root process', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-runner-probe-'))
    directories.push(directory)
    const runner = path.join(directory, 'hanging-runner.js')
    const pidFile = path.join(directory, 'grandchild.pid')
    writeFileSync(runner, HANGING_RUNNER)

    const probe = createExecProbe({ timeoutMs: PROBE_TIMEOUT_MS })
    await expect(
      probe({
        command: process.execPath,
        args: [runner, pidFile],
        cwd: directory,
        env: probeEnvironment(),
      }),
    ).rejects.toThrow(/timed out/u)

    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    spawnedPids.push(grandchild)
    expect(await exited(grandchild)).toBe(true)
  })

  it('answers with what a probe that exits prints', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-runner-probe-'))
    directories.push(directory)
    const probe = createExecProbe({ timeoutMs: EXIT_WAIT_MS })

    await expect(
      probe({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("resolved")'],
        cwd: directory,
        env: probeEnvironment(),
      }),
    ).resolves.toBe('resolved')
  })
})
