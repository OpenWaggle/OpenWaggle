/**
 * Generates the large measurement profile (decision 8 of the v1 performance plan): about 1,800
 * Sessions and 300,000 transcript nodes, most of them archived as in a long-used profile, plus a
 * few multi-megabyte Sessions. Measurements clone it instead of touching anyone's real profile.
 *
 *   pnpm perf:generate-profile --app <OpenWaggle.app> --out <dir>
 *
 * The app only creates the empty Session Host database (its schema and migrations); the Sessions
 * are then written with the same fixture writer the QA seeds use, with the Host stopped.
 */
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getDatabasePath, type SeedSessionInput, seedSessions } from '../support/session-fixtures'
import {
  createRandom,
  GENERATED_SESSION_TITLE_PREFIX,
  sessionTitle,
  transcript,
} from './lib/large-profile-content'
import { launchApp, resolvePerfApp, stopProcessGroup } from './lib/perf-app'
import { createGitProject, type PerfProfile, profileEnvironment, stopProfileHost } from './lib/perf-profile'
import { log, exitWhenFlushed } from './lib/perf-results'

const DEFAULTS = {
  sessions: 1_800,
  nodes: 300_000,
  largeSessions: 4,
  largeSessionNodes: 3_600,
  unarchived: 40,
  projects: 12,
  averageBytes: 1_200,
  largeAverageBytes: 3_000,
  seed: 20_261_027,
}
const BATCH_SIZE = 25
/** Ordinary lengths are a quarter of the average plus a spread of up to one and a half averages. */
const BASE_SHARE_DIVISOR = 4
const SPREAD_DIVISOR = 2
const MINIMUM_MESSAGES = 2
const DECIMAL = 10
const HOUR_MS = 3_600_000
const HOST_START_TIMEOUT_MS = 60_000
const JSON_INDENT = 2
const USAGE_EXIT_CODE = 2
const LOG_TAIL_LINES = 5

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    out: { type: 'string' },
    sessions: { type: 'string' },
    nodes: { type: 'string' },
  },
})

function count(raw: string | undefined, fallback: number) {
  return raw === undefined ? fallback : Number.parseInt(raw, DECIMAL)
}

async function createDatabase(profile: PerfProfile, appPath: string) {
  const app = resolvePerfApp(appPath)
  const started = launchApp(app, profileEnvironment(profile), ['--use-mock-keychain', 'host', 'start'])
  const exited = new Promise<number | null>((resolve) => started.child.once('exit', resolve))
  const timeout = new Promise<number>((resolve) => setTimeout(() => resolve(-1), HOST_START_TIMEOUT_MS))
  const code = await Promise.race([exited, timeout])
  await stopProcessGroup(started.child)
  if (code !== 0) throw new Error(`host start failed: ${started.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`)
  await stopProfileHost(profile)
}

function plannedSessions(projects: readonly string[]) {
  const random = createRandom(DEFAULTS.seed)
  const sessions = count(values.sessions, DEFAULTS.sessions)
  const nodes = count(values.nodes, DEFAULTS.nodes)
  const largeNodes = DEFAULTS.largeSessions * DEFAULTS.largeSessionNodes
  const ordinaryAverage = Math.max(1, Math.round((nodes - largeNodes) / (sessions - DEFAULTS.largeSessions)))
  const now = Date.now()
  return Array.from({ length: sessions }, (_, index) => {
    const large = index > 0 && index <= DEFAULTS.largeSessions
    const spread = random(ordinaryAverage + ordinaryAverage / SPREAD_DIVISOR)
    const messageCount = large ? DEFAULTS.largeSessionNodes : Math.max(MINIMUM_MESSAGES, Math.round(ordinaryAverage / BASE_SHARE_DIVISOR + spread))
    const updatedAt = now - index * HOUR_MS
    return {
      index,
      messageCount,
      updatedAt,
      averageBytes: large ? DEFAULTS.largeAverageBytes : DEFAULTS.averageBytes,
      archived: index >= DEFAULTS.unarchived,
      projectPath: projects[index % projects.length] ?? projects[0] ?? null,
    }
  })
}

async function main() {
  if (!values.app || !values.out) {
    process.stderr.write('Use --app <OpenWaggle.app> --out <directory> [--sessions N] [--nodes N]\n')
    process.exit(USAGE_EXIT_CODE)
  }
  await mkdir(values.out, { recursive: true })
  const root = await realpath(values.out)
  const profile: PerfProfile = {
    root,
    userData: path.join(root, 'user-data'),
    home: path.join(root, 'home'),
    agentDir: path.join(root, 'home', '.pi', 'agent'),
    projectPath: path.join(root, 'projects', 'project-0'),
  }
  await mkdir(profile.agentDir, { recursive: true })
  const projects = await Promise.all(
    Array.from({ length: DEFAULTS.projects }, (_, index) =>
      createGitProject(path.join(root, 'projects', `project-${String(index)}`)),
    ),
  )
  await createDatabase(profile, values.app)
  const random = createRandom(DEFAULTS.seed + 1)
  const plan = plannedSessions(projects)
  for (let start = 0; start < plan.length; start += BATCH_SIZE) {
    const batch: SeedSessionInput[] = plan.slice(start, start + BATCH_SIZE).map((session) => ({
      title: sessionTitle(session.index),
      updatedAt: session.updatedAt,
      archived: session.archived,
      projectPath: session.projectPath,
      messages: transcript({
        sessionIndex: session.index,
        messageCount: session.messageCount,
        averageBytes: session.averageBytes,
        endsAt: session.updatedAt,
        random,
      }),
    }))
    await seedSessions(profile.userData, batch)
    log(`seeded ${String(Math.min(start + BATCH_SIZE, plan.length))}/${String(plan.length)} Sessions`)
  }
  const manifest = {
    sessions: plan.length,
    nodes: plan.reduce((total, session) => total + session.messageCount, 0),
    unarchived: plan.filter((session) => !session.archived).length,
    largeSessions: plan.filter((session) => session.messageCount === DEFAULTS.largeSessionNodes).map((session) => sessionTitle(session.index)),
    projects: projects.length,
    databaseBytes: (await stat(getDatabasePath(profile.userData))).size,
    sessionListText: GENERATED_SESSION_TITLE_PREFIX,
  }
  await writeFile(path.join(root, 'profile.json'), `${JSON.stringify(manifest, null, JSON_INDENT)}\n`)
  log(JSON.stringify(manifest))
}

main().then(
  () => exitWhenFlushed(typeof process.exitCode === 'number' ? process.exitCode : 0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    exitWhenFlushed(1)
  },
)
