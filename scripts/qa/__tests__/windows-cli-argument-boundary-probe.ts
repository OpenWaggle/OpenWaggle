import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { build } from 'vite'
import { buildSafeElectronEnvironment } from '../../safe-electron-environment'
import {
  snapshotWindowsProcessTree,
  terminateWindowsProcessTree,
  verifyWindowsProcessTreeExit,
  type WindowsProcessIdentity,
} from '../windows-process-tree'

const FIXTURE_TIMEOUT_MS = 20_000
export const WINDOWS_CLI_BOUNDARY_ARGUMENTS = [
  'access',
  'profiles',
  'create',
  'qa-boundary-profile',
  '--capability',
  'sessions:read',
  '--capability',
  'access:profiles',
  '--management-envelope-json',
  JSON.stringify({
    capabilities: ['sessions:read'],
    scope: { projectPaths: ['C:\\工蜂\\workspace with spaces'] },
    authorizationCeiling: 'ask-for-approval',
  }),
  '--text',
  'https://example.test/worker?role=queen',
  '--openwaggle-qa-argument-switch',
  '--json',
  '--',
  'preserved application terminator',
] as const

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
      throw new Error('CLI boundary fixture process tree did not exit.')
    }
  }
}

async function readFixtureEntry(directory: string) {
  const entry: unknown = JSON.parse(await fs.readFile(path.join(directory, 'entered.json'), 'utf8'))
  assertMatching(
    {
      identity: { pid: P.integer, electron: P.string, node: P.string, uv: P.string },
      arguments: P.array(P.string),
      chromiumApplicationSwitch: P.boolean,
    },
    entry,
  )
  return entry
}

async function runFixture(
  executable: string,
  fixturePath: string,
  directory: string,
  withBoundary: boolean,
) {
  const exit = await new Promise<{
    readonly code: number | null
    readonly pid: number | undefined
  }>((resolve, reject) => {
    const child = spawn(
      executable,
      [fixturePath, ...(withBoundary ? ['--'] : []), ...WINDOWS_CLI_BOUNDARY_ARGUMENTS],
      {
        env: buildSafeElectronEnvironment({
          OPENWAGGLE_AUTOMATION: '1',
          OPENWAGGLE_QA_CLI_BOUNDARY_DIR: directory,
        }),
        windowsHide: true,
        stdio: 'ignore',
      },
    )
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void terminateFixture(child).then(
        () => reject(new Error(`CLI boundary fixture timed out; retained ${directory}.`)),
        () =>
          reject(new Error(`CLI boundary fixture cleanup was uncertain; retained ${directory}.`)),
      )
    }, FIXTURE_TIMEOUT_MS)
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`CLI boundary fixture could not start; retained ${directory}.`))
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, pid: child.pid })
    })
  })
  try {
    return { ...exit, entry: await readFixtureEntry(directory) }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  return { ...exit, entry: null }
}

export async function probeWindowsCliArgumentBoundary() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-boundary-蜂 '))
  const rawDirectory = path.join(directory, 'raw')
  const boundedDirectory = path.join(directory, 'bounded')
  await Promise.all(
    [rawDirectory, boundedDirectory].map((probeDirectory) =>
      fs.mkdir(path.join(probeDirectory, 'profile'), { recursive: true }),
    ),
  )
  const fixturePath = path.join(directory, 'fixture.cjs')
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    resolve: {
      alias: { '@shared': fileURLToPath(new URL('../../../src/shared', import.meta.url)) },
    },
    ssr: { noExternal: true, external: ['electron'] },
    build: {
      ssr: fileURLToPath(
        new URL('./fixtures/windows-cli-argument-boundary.fixture.ts', import.meta.url),
      ),
      outDir: directory,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'fixture.cjs' } },
    },
  })
  const executable: unknown = createRequire(import.meta.url)('electron')
  if (typeof executable !== 'string')
    throw new Error('Node did not resolve the Electron executable.')
  const raw = await runFixture(executable, fixturePath, rawDirectory, false)
  const bounded = await runFixture(executable, fixturePath, boundedDirectory, true)
  console.info('[windows-cli-argument-boundary]', JSON.stringify({ raw, bounded }))
  // Both exact ChildProcess close events preceded profile removal; the fixture spawns no workers.
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 })
  return { raw, bounded }
}
