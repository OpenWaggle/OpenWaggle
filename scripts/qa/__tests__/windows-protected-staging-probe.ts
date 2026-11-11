import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { buildSafeAppEnvironment } from '../../safe-app-environment'
import {
  snapshotWindowsProcessTree,
  terminateWindowsProcessTree,
  verifyWindowsProcessTreeExit,
  type WindowsProcessIdentity,
} from '../windows-process-tree'

const FIXTURE_TIMEOUT_MS = 45_000

async function terminateFixture(child: ChildProcess) {
  let snapshot: readonly WindowsProcessIdentity[] = []
  try {
    if (
      process.platform === 'win32' &&
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      snapshot = await snapshotWindowsProcessTree(child.pid)
    }
  } finally {
    child.kill('SIGKILL')
  }
  if (snapshot.length > 0 && child.pid !== undefined) {
    await terminateWindowsProcessTree(child.pid, snapshot, true)
    if (!(await verifyWindowsProcessTreeExit(snapshot))) {
      throw new Error('Protected-staging fixture process tree did not exit.')
    }
  }
}

async function runFixture(executable: string, fixturePath: string, directory: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [fixturePath, directory], {
      env: buildSafeAppEnvironment({ OPENWAGGLE_AUTOMATION: '1' }),
      windowsHide: true,
      stdio: 'ignore',
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void terminateFixture(child).then(
        () => reject(new Error(`Protected-staging fixture timed out; retained ${directory}.`)),
        () =>
          reject(
            new Error(`Protected-staging fixture cleanup was uncertain; retained ${directory}.`),
          ),
      )
    }, FIXTURE_TIMEOUT_MS)
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`Protected-staging fixture could not start; retained ${directory}.`))
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Protected-staging fixture failed; retained ${directory}.`))
      else resolve()
    })
  })
}

export async function probeWindowsProtectedStaging() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-protected-staging-蜂 '))
  await fs.mkdir(path.join(directory, 'profile'))
  // Bun, the app's runtime, runs the fixture source as the desktop main process does.
  const fixturePath = fileURLToPath(
    new URL('./fixtures/windows-protected-staging.fixture.ts', import.meta.url),
  )
  const executable = process.execPath
  await runFixture(executable, fixturePath, directory)
  const result: unknown = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'))
  assertMatching(
    {
      identity: { pid: P.integer, bun: P.string, node: P.string, uv: P.string },
      directorySharing: { held: { ok: P.boolean }, closed: { ok: P.boolean } },
      descriptor: { ok: P.boolean },
      protectedStaging: { ok: P.boolean, stage: P.string },
    },
    result,
  )
  console.info('[windows-protected-staging]', JSON.stringify(result))
  // Successful process close follows every owned helper exit in the fixture.
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 })
  return result
}
