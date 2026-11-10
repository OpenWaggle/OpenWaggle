/**
 * macOS only: the perf harness reads process environments with BSD `ps -E`, clones profiles with
 * `cp -c` and launches `.app` bundles, so `resolvePerfApp` refuses other platforms.
 *
 * "Memory, 6-Run Hive" gate of the v1 performance plan: the app's total physical footprint (GUI,
 * renderer, helpers, Session Host and every MCP process) while a Queen and five Workers each have
 * a Run active, with the heavy-user MCP setup (six servers per Session, four through `npx`).
 * A local fake provider scripts the Hive, so no model is called.
 *
 *   bun run perf:hive-memory --app <before.app> --app <after.app> --runs 3
 */
import { parseArgs } from 'node:util'
import { type AppMemorySample, sampleAppMemory } from './lib/app-memory'
import { startCliRun } from './lib/cli-run'
import {
  configureFakeProvider,
  FAKE_MODEL_REFERENCE,
  isTitleRequest,
  startFakeProvider,
} from './lib/fake-openai-provider'
import { HEAVY_USER_MCP_ENVIRONMENT, writeHeavyUserMcpConfig } from './lib/mcp-fixtures'
import { resolvePerfApp, stopProcessGroup } from './lib/perf-app'
import { compareApps, reportComparison } from './lib/perf-app-comparison'
import { writeJsonResult, exitWhenFlushed } from './lib/perf-results'
import { median } from './lib/perf-stats'
import { delay, withRunningApp } from './lib/running-app'
import { createScriptedHive } from './lib/scripted-hive'

const DEFAULTS = { runs: 3, workers: 5, sleepSeconds: 100 }
const TIMEOUT_MS = 120_000
const ALL_ACTIVE_TIMEOUT_MS = 180_000
const SAMPLE_EVERY_MS = 3_000
const SAMPLE_COUNT = 20
const DRAIN_GRACE_MS = 120_000
const DECIMAL = 10
const METRICS = [
  'peakFootprintMb',
  'medianFootprintMb',
  'peakResidentMb',
  'processCount',
  'allActiveAfterMs',
]

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    runs: { type: 'string' },
    workers: { type: 'string' },
    out: { type: 'string' },
  },
})

async function sampleWhileActive(
  guiPid: number | undefined,
  userData: string,
  appExecutable: string,
) {
  const samples: AppMemorySample[] = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(sampleAppMemory({ guiPid, userData, appExecutable }))
    await delay(SAMPLE_EVERY_MS)
  }
  return samples
}

async function measureHive(appPath: string, label: string | undefined, workers: number) {
  const app = resolvePerfApp(appPath, label)
  const hive = createScriptedHive({
    workers,
    sleepSeconds: DEFAULTS.sleepSeconds,
    model: FAKE_MODEL_REFERENCE,
  })
  const provider = await startFakeProvider(async (request, stream) =>
    isTitleRequest(request) ? stream.text('Memory Hive') : hive.respond(request, stream),
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
      async ({ profile, launched }) => {
        const startedAt = Date.now()
        const run = startCliRun(app, profile, {
          prompt: 'Spawn five Workers for the memory measurement.',
          model: FAKE_MODEL_REFERENCE,
          yolo: true,
          environment: HEAVY_USER_MCP_ENVIRONMENT,
        })
        const active = await Promise.race([
          hive.allActive.then(() => true),
          delay(ALL_ACTIVE_TIMEOUT_MS).then(() => false),
        ])
        const allActiveAfterMs = Date.now() - startedAt
        const samples = await sampleWhileActive(
          launched.child.pid,
          profile.userData,
          app.executable,
        )
        const settled = await Promise.race([
          run.exited,
          delay(DRAIN_GRACE_MS).then(() => 'timeout'),
        ])
        if (settled === 'timeout') await stopProcessGroup(run.launched.child)
        if (values.out) {
          await writeJsonResult(
            values.out,
            `hive-provider-requests-${app.label}.json`,
            provider.requests,
          )
        }
        const peak = samples.reduce((best, sample) =>
          sample.footprintMb > best.footprintMb ? sample : best,
        )
        return {
          app: app.label,
          workers,
          allActive: active,
          activeSessions: hive.sleeping.size,
          allActiveAfterMs,
          peakFootprintMb: peak.footprintMb,
          medianFootprintMb: median(samples.map((sample) => sample.footprintMb)),
          peakResidentMb: peak.residentMb,
          processCount: peak.processCount,
          peakByRole: peak.byRole,
          providerRequests: provider.requests.length,
          samples: samples.map(({ at, footprintMb, residentMb, processCount }) => ({
            at,
            footprintMb,
            residentMb,
            processCount,
          })),
        }
      },
    )
  } finally {
    await provider.close()
  }
}

async function main() {
  const runs = Number.parseInt(values.runs ?? String(DEFAULTS.runs), DECIMAL)
  const workers = Number.parseInt(values.workers ?? String(DEFAULTS.workers), DECIMAL)
  const results = await compareApps({
    appPaths: values.app,
    labels: values.label,
    runs,
    runName: 'hive',
    measure: (appPath, label) => measureHive(appPath, label, workers),
    describe: (result) => ({ ...result, samples: undefined }),
  })
  await reportComparison({
    results,
    metrics: METRICS,
    kind: 'hive-memory',
    details: { runs, workers },
    outDirectory: values.out,
    fileName: 'hive-memory.json',
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
