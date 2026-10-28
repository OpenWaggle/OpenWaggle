import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareQaProfileRemoval, shutdownSessionHostForQa } from '../../qa/session-host-shutdown'
import { buildSafeElectronEnvironment } from '../../safe-electron-environment'
import { interruptCleanup } from './interrupt-cleanup'
import { processTree, profileHostPids } from './perf-processes'

/**
 * A throwaway OpenWaggle profile: its own user data, HOME and Pi agent directory, so a measured
 * app never reads or writes the user's real profile (decision 8 of the v1 performance plan).
 */
export interface PerfProfile {
  readonly root: string
  readonly userData: string
  readonly home: string
  readonly agentDir: string
  readonly projectPath: string
}

export interface PerfProfileOptions {
  readonly label: string
  /** A prepared user-data directory, cloned (APFS copy-on-write where possible) into the profile. */
  readonly templateUserData?: string
  /** A prepared HOME directory, cloned the same way. */
  readonly templateHome?: string
  /** The project the app opens; a fresh git repository when absent. */
  readonly projectPath?: string
}

function cloneDirectory(source: string, target: string) {
  try {
    execFileSync('cp', ['-c', '-R', source, target], { stdio: 'ignore' })
  } catch {
    execFileSync('cp', ['-R', source, target], { stdio: 'ignore' })
  }
}

function git(projectPath: string, args: readonly string[]) {
  execFileSync('git', [...args], { cwd: projectPath, stdio: 'ignore' })
}

export async function createGitProject(projectPath: string) {
  await mkdir(projectPath, { recursive: true })
  if (existsSync(path.join(projectPath, '.git'))) return projectPath
  git(projectPath, ['init', '-q', '-b', 'main'])
  git(projectPath, ['config', 'user.email', 'perf@example.com'])
  git(projectPath, ['config', 'user.name', 'Perf'])
  await writeFile(path.join(projectPath, 'README.md'), '# OpenWaggle performance fixture\n')
  git(projectPath, ['add', '.'])
  git(projectPath, ['commit', '-q', '-m', 'initial'])
  return projectPath
}

/** Profiles not yet disposed, with the call that unregisters each from the interrupt cleanup. */
const liveProfiles = new Map<string, () => void>()

export async function createPerfProfile(options: PerfProfileOptions): Promise<PerfProfile> {
  // The real path: Session authority compares resolved roots, and /tmp is /private/tmp on macOS.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), `owperf-${options.label}-`)))
  const userData = path.join(root, 'user-data')
  const home = path.join(root, 'home')
  if (options.templateUserData) cloneDirectory(options.templateUserData, userData)
  if (options.templateHome) cloneDirectory(options.templateHome, home)
  const agentDir = path.join(home, '.pi', 'agent')
  await mkdir(userData, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const projectPath = options.projectPath ?? (await createGitProject(path.join(root, 'project')))
  const profile = { root, userData, home, agentDir, projectPath }
  // An interrupted harness still stops the profile's Host and removes the profile.
  liveProfiles.set(
    root,
    interruptCleanup.register('profile', () => disposePerfProfile(profile, process.env.OWPERF_KEEP_PROFILE === '1')),
  )
  return profile
}

/**
 * The environment of a hidden automation launch against the profile. First-party extensions stay
 * on, so the measured Runs declare the same tools as a normal app's Runs.
 */
export function profileEnvironment(
  profile: PerfProfile,
  overrides: Readonly<Record<string, string>> = {},
) {
  // The measured Host keeps its scratch directories (and their sweeps) under this harness's own
  // temp directory, never under a temp directory another Host shares.
  const temporaryDirectory = os.tmpdir()
  return buildSafeElectronEnvironment({
    ELECTRON_ENABLE_LOGGING: '1',
    TMPDIR: temporaryDirectory,
    OPENWAGGLE_HOST_TMPDIR: temporaryDirectory,
    HOME: profile.home,
    USERPROFILE: profile.home,
    PI_CODING_AGENT_DIR: profile.agentDir,
    OPENWAGGLE_USER_DATA_DIR: profile.userData,
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1',
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_AUTOMATION_PROJECT_PATH: profile.projectPath,
    ...(process.env.OWPERF_LOG_LEVEL ? { OPENWAGGLE_LOG_LEVEL: process.env.OWPERF_LOG_LEVEL } : {}),
    // A stable V8 compile cache across launches of one series (boot shim, W2); without it every
    // throwaway profile starts with a cold cache, as the first launch after an update does.
    ...(process.env.OWPERF_COMPILE_CACHE_DIR
      ? { OPENWAGGLE_COMPILE_CACHE_DIR: process.env.OWPERF_COMPILE_CACHE_DIR }
      : {}),
    ...overrides,
  })
}

const FORCED_STOP_WAIT_MS = 5_000

function signalTree(pids: readonly number[], signal: NodeJS.Signals) {
  for (const entry of processTree(pids)) {
    try {
      process.kill(entry.pid, signal)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Stops the profile's own Host and its children (MCP servers) when it does not drain in time,
 * for example while a measured Run is still active. Only this profile's processes are signalled.
 */
async function forceStopProfileHost(userData: string) {
  const hostPids = profileHostPids(userData)
  if (hostPids.length === 0) return
  signalTree(hostPids, 'SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, FORCED_STOP_WAIT_MS))
  signalTree(hostPids, 'SIGKILL')
}

/**
 * How long the QA drain may take before the profile's Host is stopped by signal. A Host that is
 * still indexing or closing MCP servers can outlast it; SIGTERM still shuts it down cleanly.
 */
const HOST_DRAIN_TIMEOUT_MS = 10_000
const LOGGED_ERROR_CHARS = 120

/** Stops the profile's own Session Host, if one runs: the QA drain, then signals. */
export async function stopProfileHost(
  profile: Pick<PerfProfile, 'userData'>,
  whileOwnershipHeld: Parameters<typeof shutdownSessionHostForQa>[1] = async () => undefined,
) {
  try {
    await shutdownSessionHostForQa(profile.userData, whileOwnershipHeld, HOST_DRAIN_TIMEOUT_MS)
  } catch (error) {
    process.stderr.write(`Host drain did not finish (${String(error).slice(0, LOGGED_ERROR_CHARS)}); stopping the profile's Host.\n`)
    await forceStopProfileHost(profile.userData)
  }
}

export async function disposePerfProfile(profile: PerfProfile, keep = false) {
  liveProfiles.get(profile.root)?.()
  liveProfiles.delete(profile.root)
  await stopProfileHost(profile, async (ownership) =>
    keep ? undefined : prepareQaProfileRemoval(profile.userData, ownership),
  )
  if (!keep) await rm(profile.root, { recursive: true, force: true })
}
