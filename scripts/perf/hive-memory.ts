/**
 * "Memory, 6-Run Hive" gate of the v1 performance plan: the app's total physical footprint (GUI,
 * renderer, helpers, Session Host and every MCP process) while a Queen and five Workers each have
 * a Run active, with the heavy-user MCP setup (six servers per Session, four through `npx`).
 * A local fake provider scripts the Hive, so no model is called.
 *
 *   pnpm perf:hive-memory --app <before.app> --app <after.app> --runs 3
 */
import path from 'node:path'
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
import { log, measurementEnvironment, writeJsonResult } from './lib/perf-results'
import { median, summarizeRuns } from './lib/perf-stats'
import { delay, withRunningApp } from './lib/running-app'
import { createScriptedHive } from './lib/scripted-hive'

const DEFAULTS = { runs: 3, workers: 5, sleepSeconds: 100 }
const TIMEOUT_MS = 120_000
const ALL_ACTIVE_TIMEOUT_MS = 180_000
const SAMPLE_EVERY_MS = 3_000
const SAMPLE_COUNT = 20
const DRAIN_GRACE_MS = 120_000
const DECIMAL = 10
const ORDERS = 2
const USAGE_EXIT_CODE = 2
const METRICS = ['peakFootprintMb', 'medianFootprintMb', 'peakResidentMb', 'processCount', 'allActiveAfterMs']

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    runs: { type: 'string' },
    workers: { type: 'string' },
    out: { type: 'string' },
  },
})

async function sampleWhileActive(guiPid: number | undefined, userData: string) {
  const samples: AppMemorySample[] = []
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(sampleAppMemory(guiPid, userData))
    await delay(SAMPLE_EVERY_MS)
  }
  return samples
}

async function measureHive(appPath: string, label: string | undefined, workers: number) {
  const app = resolvePerfApp(appPath, label)
  const hive = createScriptedHive({ workers, sleepSeconds: DEFAULTS.sleepSeconds, model: FAKE_MODEL_REFERENCE })
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
        const active = await Promise.race([hive.allActive.then(() => true), delay(ALL_ACTIVE_TIMEOUT_MS).then(() => false)])
        const allActiveAfterMs = Date.now() - startedAt
        const samples = await sampleWhileActive(launched.child.pid, profile.userData)
        const settled = await Promise.race([run.exited, delay(DRAIN_GRACE_MS).then(() => 'timeout')])
        if (settled === 'timeout') await stopProcessGroup(run.launched.child)
        if (values.out) await writeJsonResult(values.out, `hive-provider-requests-${app.label}.json`, provider.requests)
        const peak = samples.reduce((best, sample) => (sample.footprintMb > best.footprintMb ? sample : best))
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
          samples: samples.map(({ at, footprintMb, residentMb, processCount }) => ({ at, footprintMb, residentMb, processCount })),
        }
      },
    )
  } finally {
    await provider.close()
  }
}

async function main() {
  const apps = values.app ?? []
  if (apps.length === 0) {
    process.stderr.write('Use --app <OpenWaggle.app> (repeatable)\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const runs = Number.parseInt(values.runs ?? String(DEFAULTS.runs), DECIMAL)
  const workers = Number.parseInt(values.workers ?? String(DEFAULTS.workers), DECIMAL)
  const indexed = apps.map((appPath, index) => ({ appPath, label: values.label?.[index] ?? path.basename(appPath) }))
  const results: Record<string, object[]> = Object.fromEntries(indexed.map((entry) => [entry.label, []]))
  for (let run = 0; run < runs; run += 1) {
    for (const entry of run % ORDERS === 0 ? indexed : [...indexed].reverse()) {
      try {
        const result = await measureHive(entry.appPath, entry.label, workers)
        results[entry.label]?.push(result)
        log(`${entry.label} hive ${String(run + 1)}: ${JSON.stringify({ ...result, samples: undefined })}`)
      } catch (error) {
        results[entry.label]?.push({ error: String(error) })
        log(`${entry.label} hive ${String(run + 1)} failed: ${String(error)}`)
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([label, entries]) => [label, summarizeRuns(entries, METRICS)]))
  const report = { kind: 'hive-memory', environment: measurementEnvironment(), runs, workers, summary, results }
  if (values.out) log(`Wrote ${await writeJsonResult(values.out, 'hive-memory.json', report)}`)
  process.stdout.write(`${JSON.stringify(summary, null, ORDERS)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})
