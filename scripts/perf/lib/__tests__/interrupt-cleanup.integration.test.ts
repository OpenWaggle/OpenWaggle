import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * R6 P2-4, end to end: Ctrl-C on a harness reaches only its own process group, so the harness
 * itself must stop the app it launched in another group and remove its throwaway profile.
 */
const HARNESS = path.join(import.meta.dirname, 'fixtures', 'interrupted-harness.ts')
const TSX = path.join(import.meta.dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'tsx')
const SIGINT_EXIT_CODE = 130
const TEST_TIMEOUT_MS = 60_000

/** Whatever a failing run left behind: the stand-in app's group and the profile. */
const leftovers: { pid: number; root: string }[] = []
afterEach(async () => {
  for (const { pid, root } of leftovers.splice(0)) {
    if (isAlive(pid)) process.kill(-pid, 'SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})

function isAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.skipIf(process.platform === 'win32')('an interrupted perf harness', () => {
  it(
    'stops the app group it launched and removes its profile',
    async () => {
      const harness = spawn(TSX, [HARNESS], { stdio: ['ignore', 'pipe', 'pipe'] })
      const started = await new Promise<{ pid: number; root: string }>((resolve, reject) => {
        let output = ''
        harness.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8')
          const line = output.split('\n').find((candidate) => candidate.startsWith('{'))
          if (line) resolve(JSON.parse(line))
        })
        harness.once('exit', (code) => reject(new Error(`harness exited early with ${String(code)}`)))
      })
      leftovers.push(started)
      expect(isAlive(started.pid)).toBe(true)
      expect(existsSync(started.root)).toBe(true)

      const exited = new Promise<number | null>((resolve) => harness.once('exit', (code) => resolve(code)))
      harness.kill('SIGINT')

      expect(await exited).toBe(SIGINT_EXIT_CODE)
      expect(isAlive(started.pid)).toBe(false)
      expect(existsSync(started.root)).toBe(false)
    },
    TEST_TIMEOUT_MS,
  )
})
