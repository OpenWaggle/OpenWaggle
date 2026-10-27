import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { resolveLocalSessionHostPaths } from '../../../src/main/session-host/local-session-paths'
import { launchApp, type PerfApp, stopProcessGroup } from './perf-app'
import { profileHostPids, sampleProcesses } from './perf-processes'
import { type PerfProfile, profileEnvironment, stopProfileHost } from './perf-profile'
import { log } from './perf-results'

const WARM_MARKER = 'warmed.json'
const LOG_TAIL_LINES = 3
/** The first start of a large profile backfills its semantic index and can take minutes. */
const HOST_START_TIMEOUT_MS = 900_000
const IDLE_SAMPLE_MS = 5_000
const IDLE_CPU_PERCENT = 2
const IDLE_SAMPLES_NEEDED = 3
/** A large unindexed profile may never go idle within this; warming then proceeds anyway. */
const MAXIMUM_WARM_MS = 1_800_000
const NANOSECONDS_PER_MILLISECOND = 1_000_000
const PERCENT = 100

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function hostCpuNs(userData: string) {
  const pids = profileHostPids(userData)
  return [...sampleProcesses(pids).values()].reduce((total, sample) => total + sample.cpuNs, 0)
}

/** Waits until the Host has used under 2% of a core for three 5-second samples in a row. */
async function waitForIdleHost(userData: string) {
  const deadline = Date.now() + MAXIMUM_WARM_MS
  let quietSamples = 0
  let previous = hostCpuNs(userData)
  while (quietSamples < IDLE_SAMPLES_NEEDED && Date.now() < deadline) {
    await delay(IDLE_SAMPLE_MS)
    const current = hostCpuNs(userData)
    const percent = ((current - previous) / NANOSECONDS_PER_MILLISECOND / IDLE_SAMPLE_MS) * PERCENT
    previous = current
    quietSamples = percent < IDLE_CPU_PERCENT ? quietSamples + 1 : 0
  }
}

function canConnect(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(endpoint)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Runs the profile's Host directly (as `host start` would launch it) until it accepts clients and
 * then goes idle, and returns how long it took to listen. `host start` itself gives up while a
 * large profile's first start is still preparing its semantic index.
 */
async function startHostUntilIdle(app: PerfApp, profile: PerfProfile) {
  const startedAt = Date.now()
  const host = launchApp(app, profileEnvironment(profile), ['--use-mock-keychain', 'session-host-internal'])
  try {
    const { endpoint } = resolveLocalSessionHostPaths({ userDataRoot: profile.userData })
    while (!(await canConnect(endpoint))) {
      if (Date.now() - startedAt > HOST_START_TIMEOUT_MS || host.child.exitCode !== null) {
        throw new Error(`The Host did not start while warming ${profile.root}: ${host.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`)
      }
      await delay(IDLE_SAMPLE_MS)
    }
    const listeningMs = Date.now() - startedAt
    await waitForIdleHost(profile.userData)
    return listeningMs
  } finally {
    await stopProfileHost(profile)
    await stopProcessGroup(host.child)
  }
}

/**
 * A copy of a generated profile that one build's Host has already opened once: its migrations,
 * recovery and background indexing are done, so every measured launch starts from the steady
 * state a user's profile is in. Made once per build label and reused.
 */
export async function warmTemplateFor(app: PerfApp, templateRoot: string) {
  const target = `${templateRoot}.warm-${app.label}`
  if (existsSync(path.join(target, WARM_MARKER))) return target
  // A copy without its marker is left over from an interrupted warm-up; start again.
  await rm(target, { recursive: true, force: true })
  execFileSync('cp', ['-c', '-R', templateRoot, target], { stdio: 'ignore' })
  const profile: PerfProfile = {
    root: target,
    userData: path.join(target, 'user-data'),
    home: path.join(target, 'home'),
    agentDir: path.join(target, 'home', '.pi', 'agent'),
    projectPath: path.join(target, 'projects', 'project-0'),
  }
  const startedAt = Date.now()

  // startHostUntilIdle never leaves its Host behind, even when warming fails.
  const listeningMs = await startHostUntilIdle(app, profile)
  const warm = { app: app.label, firstHostStartMs: listeningMs, warmedMs: Date.now() - startedAt }
  await writeFile(path.join(target, WARM_MARKER), `${JSON.stringify(warm)}\n`)
  log(`warmed ${target}: ${JSON.stringify(warm)}`)
  return target
}
