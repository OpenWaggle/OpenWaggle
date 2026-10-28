import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchApp, type PerfApp, stopProcessGroup } from './perf-app'
import { processTree, profileHostPids, sampleProcesses } from './perf-processes'
import { type PerfProfile, profileEnvironment, stopProfileHost } from './perf-profile'
import { log } from './perf-results'

const LOG_TAIL_LINES = 3
const WARM_MARKER = 'warmed.json'
/** Bumped when warming changes, so copies warmed the old way are warmed again. */
const WARM_METHOD = 'gui-attached-until-background-idle'
const IDLE_SAMPLE_MS = 5_000
const IDLE_CPU_PERCENT = 2
const IDLE_SAMPLES_NEEDED = 3
/**
 * The Host starts background work 5 s after a client attaches (A-F9); the window's own boot
 * requests come first. Idle is not trusted before this.
 */
const MINIMUM_ATTACHED_MS = 20_000
/** A large profile may not finish its background work within this; warming then stops anyway. */
const MAXIMUM_WARM_MS = 1_800_000
const NANOSECONDS_PER_MILLISECOND = 1_000_000
const PERCENT = 100
/** The queues a steady-state profile has drained; reported in the marker, not waited on. */
const BACKGROUND_QUEUES = [
  'session_transcript_embedding_queue',
  'session_discovery_embedding_queue',
  'session_resource_cleanup_queue',
  'session_lexical_discovery_deferrals',
]

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** CPU time of the profile's Host and its children, such as the embedding process. */
function hostTreeCpuNs(userData: string) {
  const pids = processTree(profileHostPids(userData)).map((entry) => entry.pid)
  return [...sampleProcesses(pids).values()].reduce((total, sample) => total + sample.cpuNs, 0)
}

/**
 * Waits until the Host tree has used under 2% of a core for three 5-second samples in a row,
 * no earlier than `MINIMUM_ATTACHED_MS` after the client attached. Returns whether it went idle.
 */
async function waitForIdleHost(userData: string, attachedAt: number) {
  const deadline = attachedAt + MAXIMUM_WARM_MS
  let quietSamples = 0
  let previous = hostTreeCpuNs(userData)
  while (Date.now() < deadline) {
    await delay(IDLE_SAMPLE_MS)
    const current = hostTreeCpuNs(userData)
    const percent = ((current - previous) / NANOSECONDS_PER_MILLISECOND / IDLE_SAMPLE_MS) * PERCENT
    previous = current
    quietSamples = percent < IDLE_CPU_PERCENT ? quietSamples + 1 : 0
    if (quietSamples >= IDLE_SAMPLES_NEEDED && Date.now() - attachedAt >= MINIMUM_ATTACHED_MS) return true
  }
  return false
}

/** Rows left in the Host's background queues, read after the Host stopped. */
function backgroundQueueRows(userData: string) {
  const database = path.join(userData, 'session-host', 'session-host.sqlite')
  const rows: Record<string, number | null> = {}
  for (const table of BACKGROUND_QUEUES) {
    try {
      const output = execFileSync('sqlite3', [database, `select count(*) from ${table}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      rows[table] = Number(output.trim())
    } catch {
      rows[table] = null
    }
  }
  return rows
}

/**
 * Opens the profile with the desktop window attached, as a user's next launch after an upgrade
 * does, and keeps it attached until the Host's background work (migrations, discovery, term
 * repair, semantic preparation) has gone idle. Since A-F9 that work runs only while a client is
 * attached, so a headless `host start` would leave all of it to the first measured launch. The
 * window and the Host are always stopped, even when warming fails.
 */
async function warmWithClientAttached(app: PerfApp, profile: PerfProfile) {
  const launched = launchApp(app, profileEnvironment(profile), ['--use-mock-keychain'])
  const attachedAt = Date.now()
  try {
    const exited = new Promise<'exited'>((resolve) => launched.child.once('exit', () => resolve('exited')))
    const idle = await Promise.race([waitForIdleHost(profile.userData, attachedAt), exited])
    if (idle === 'exited') {
      throw new Error(`The app exited while warming ${profile.root}: ${launched.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`)
    }
    return { backgroundIdle: idle, attachedMs: Date.now() - attachedAt }
  } finally {
    await stopProcessGroup(launched.child)
    await stopProfileHost(profile)
  }
}

function isCurrentWarmMarker(file: string) {
  if (!existsSync(file)) return false
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  return typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'method') === WARM_METHOD
}

/**
 * A copy of a generated profile that one build's Host has already opened once: its migrations,
 * recovery and background indexing are done, so every measured launch starts from the steady
 * state a user's profile is in. Made once per build label and reused.
 */
export async function warmTemplateFor(app: PerfApp, templateRoot: string) {
  const target = `${templateRoot}.warm-${app.label}`
  if (isCurrentWarmMarker(path.join(target, WARM_MARKER))) return target
  // A copy without a current marker is left over from an interrupted or older warm-up; start again.
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

  const attached = await warmWithClientAttached(app, profile)
  const warm = {
    app: app.label,
    method: WARM_METHOD,
    ...attached,
    warmedMs: Date.now() - startedAt,
    backgroundQueueRows: backgroundQueueRows(profile.userData),
  }
  await writeFile(path.join(target, WARM_MARKER), `${JSON.stringify(warm)}\n`)
  log(`warmed ${target}: ${JSON.stringify(warm)}`)
  return target
}
