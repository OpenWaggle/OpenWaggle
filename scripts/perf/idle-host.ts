/**
 * macOS only: the perf harness reads process environments with BSD `ps -E`, clones profiles with
 * `cp -c` and launches `.app` bundles, so `resolvePerfApp` refuses other platforms.
 *
 * "Idle Host with no window" gate of the v1 performance plan: after a normal session (the window
 * opened, one Run with the heavy-user MCP setup answered), the window closes and the Session Host
 * keeps running for its idle grace period with no client. Its footprint (alone and with its
 * children) and CPU use are sampled at fixed times after the last client left.
 *
 *   bun run perf:idle-host --app <before.app> --app <after.app> --runs 3
 */
import { parseArgs } from 'node:util'
import { sampleAppMemory } from './lib/app-memory'
import { startCliRun } from './lib/cli-run'
import {
  configureFakeProvider,
  FAKE_MODEL_REFERENCE,
  isTitleRequest,
  startFakeProvider,
} from './lib/fake-openai-provider'
import { HEAVY_USER_MCP_ENVIRONMENT, writeHeavyUserMcpConfig } from './lib/mcp-fixtures'
import { resolvePerfApp, stopProcessGroup } from './lib/perf-app'
import { profileHostPids, sampleProcesses } from './lib/perf-processes'
import { compareApps, reportComparison } from './lib/perf-app-comparison'
import { exitWhenFlushed } from './lib/perf-results'
import { delay, withRunningApp } from './lib/running-app'

const DEFAULT_RUNS = 3
const TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 120_000
/** Seconds after the window closed at which the Host is sampled; the grace period is 300 s. */
const SAMPLE_AFTER_SECONDS = [30, 120, 240]
const CPU_WINDOW_MS = 20_000
const MILLISECONDS_PER_SECOND = 1_000
const NANOSECONDS_PER_MILLISECOND = 1_000_000
const BYTES_PER_MEGABYTE = 1_048_576
const PERCENT = 100
const DECIMAL = 10

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    runs: { type: 'string' },
    out: { type: 'string' },
  },
})

function hostOnly(userData: string) {
  const samples = [...sampleProcesses(profileHostPids(userData)).values()]
  return {
    footprint: samples.reduce((total, sample) => total + sample.footprint, 0),
    cpuNs: samples.reduce((total, sample) => total + sample.cpuNs, 0),
  }
}

/** The Host's footprint, its tree's footprint, and its CPU share over a 20-second window. */
async function sampleIdleHost(userData: string, secondsAfterClose: number, appExecutable: string) {
  const before = hostOnly(userData)
  await delay(CPU_WINDOW_MS)
  const after = hostOnly(userData)
  const tree = sampleAppMemory({ guiPid: undefined, userData, appExecutable })
  return {
    secondsAfterClose,
    hostFootprintMb: Math.round(after.footprint / BYTES_PER_MEGABYTE),
    hostTreeFootprintMb: tree.footprintMb,
    hostTreeProcesses: tree.processCount,
    hostTreeByRole: tree.byRole,
    hostCpuPercent:
      Math.round(
        ((after.cpuNs - before.cpuNs) / NANOSECONDS_PER_MILLISECOND / CPU_WINDOW_MS) *
          PERCENT *
          PERCENT,
      ) / PERCENT,
  }
}

async function measureIdle(appPath: string, label: string | undefined) {
  const app = resolvePerfApp(appPath, label)
  const provider = await startFakeProvider(async (request, stream) =>
    stream.text(isTitleRequest(request) ? 'Idle Host' : 'The answer is 42.'),
  )
  try {
    return await withRunningApp(
      app,
      {
        mode: 'cold',
        sessionListText: null,
        timeoutMs: TIMEOUT_MS,
        warmHostIdleMs: 0,
        environment: HEAVY_USER_MCP_ENVIRONMENT,
        prepareProfile: async (profile) => {
          await configureFakeProvider(profile.agentDir, provider.baseUrl)
          await writeHeavyUserMcpConfig(profile)
        },
      },
      async ({ profile, launched, browser }) => {
        const run = startCliRun(app, profile, {
          prompt: 'What is the answer?',
          model: FAKE_MODEL_REFERENCE,
          environment: HEAVY_USER_MCP_ENVIRONMENT,
        })
        await Promise.race([run.exited, delay(RUN_TIMEOUT_MS)])
        await stopProcessGroup(run.launched.child)
        const attached = sampleAppMemory({
          guiPid: launched.child.pid,
          userData: profile.userData,
          appExecutable: app.executable,
        })
        await browser.close().catch(() => undefined)
        await stopProcessGroup(launched.child)
        const closedAt = Date.now()
        const samples = []
        for (const seconds of SAMPLE_AFTER_SECONDS) {
          const wait = closedAt + seconds * MILLISECONDS_PER_SECOND - CPU_WINDOW_MS - Date.now()
          if (wait > 0) await delay(wait)
          samples.push(await sampleIdleHost(profile.userData, seconds, app.executable))
        }
        const last = samples.at(-1)
        return {
          app: app.label,
          attachedFootprintMb: attached.footprintMb,
          idleHostFootprintMb: last?.hostFootprintMb ?? null,
          idleHostTreeFootprintMb: last?.hostTreeFootprintMb ?? null,
          idleHostCpuPercent: last?.hostCpuPercent ?? null,
          samples,
        }
      },
    )
  } finally {
    await provider.close()
  }
}

async function main() {
  const runs = Number.parseInt(values.runs ?? String(DEFAULT_RUNS), DECIMAL)
  const metrics = [
    'attachedFootprintMb',
    'idleHostFootprintMb',
    'idleHostTreeFootprintMb',
    'idleHostCpuPercent',
  ]
  const results = await compareApps({
    appPaths: values.app,
    labels: values.label,
    runs,
    runName: 'idle',
    measure: measureIdle,
  })
  await reportComparison({
    results,
    metrics,
    kind: 'idle-host',
    details: { runs },
    outDirectory: values.out,
    fileName: 'idle-host.json',
  })
}

main().then(
  () => exitWhenFlushed(typeof process.exitCode === 'number' ? process.exitCode : 0),
  (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    exitWhenFlushed(1)
  },
)
