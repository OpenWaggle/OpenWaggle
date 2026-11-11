/**
 * macOS only: the perf harness reads process environments with BSD `ps -E`, clones profiles with
 * `cp -c` and launches `.app` bundles, so `resolvePerfApp` refuses other platforms.
 *
 * Streaming gate of the v1 performance plan: the renderer while a long markdown answer streams
 * from a local fake provider (about 125 tokens/s), at a 4x CPU throttle by default. Reports the
 * renderer main thread's busy share from a Chrome trace and rAF frame times. The Electron build also
 * counted the `agent:event` traffic the main process pushed, through its Node inspector; the
 * Electrobun main process is a Bun Worker without one, so that count is gone.
 *
 *   bun run perf:streaming --app <before.app> --app <after.app> --runs 5 --cpu-throttle 4
 */
import { parseArgs } from 'node:util'
import type { CDPSession, Page } from '@playwright/test'
import {
  configureFakeProvider,
  FAKE_MODEL_REFERENCE,
  isTitleRequest,
  startFakeProvider,
} from './lib/fake-openai-provider'
import { resolvePerfApp } from './lib/perf-app'
import { compareApps, reportComparison } from './lib/perf-app-comparison'
import { exitWhenFlushed } from './lib/perf-results'
import { quantile } from './lib/perf-stats'
import { delay, withRunningApp } from './lib/running-app'
import { streamedAnswerTokens } from './lib/streamed-answer'
import { rendererMainThreadBusy, traceBounds } from './lib/trace-busy'

const DEFAULTS = { runs: 5, throttle: 4, tokens: 1_500, intervalMs: 8 }
const TIMEOUT_MS = 90_000
const SETTLE_AFTER_STREAM_MS = 2_000
const MODEL_SETTLE_MS = 2_000
const DECIMAL = 10
const LONG_FRAME_MS = 33
const VERY_LONG_FRAME_MS = 100
const P50 = 0.5
const P95 = 0.95
const P99 = 0.99
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'toplevel',
]
const METRICS = [
  'busyPercent',
  'frameP50Ms',
  'frameP95Ms',
  'frameP99Ms',
  'framesOver33Ms',
  'framesOver100Ms',
  'domNodes',
]

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    runs: { type: 'string' },
    'cpu-throttle': { type: 'string' },
    out: { type: 'string' },
  },
})

async function selectFakeModel(page: Page) {
  await page.evaluate(async (model) => {
    const holder: object = globalThis
    const api: unknown = 'api' in holder ? holder.api : null
    const call = (name: string, argument: unknown) => {
      const method: unknown =
        typeof api === 'object' && api !== null ? Reflect.get(api, name) : null
      return typeof method === 'function'
        ? Promise.resolve(Reflect.apply(method, api, [argument]))
        : Promise.resolve()
    }
    await call('setEnabledModels', [model])
    await call('updateSettings', { selectedModel: model })
  }, FAKE_MODEL_REFERENCE)
  await page.reload()
  await page.waitForSelector('[contenteditable]', { timeout: TIMEOUT_MS })
  await delay(MODEL_SETTLE_MS)
}

async function traced(cdp: CDPSession, during: () => Promise<void>) {
  const events: unknown[] = []
  cdp.on('Tracing.dataCollected', (payload) => events.push(...payload.value))
  const complete = new Promise<void>((resolve) =>
    cdp.once('Tracing.tracingComplete', () => resolve()),
  )
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: TRACE_CATEGORIES },
  })
  await during()
  await cdp.send('Tracing.end')
  await complete
  return events
}

function frameStats(frames: readonly number[]) {
  return {
    frameCount: frames.length,
    frameP50Ms: quantile(frames, P50),
    frameP95Ms: quantile(frames, P95),
    frameP99Ms: quantile(frames, P99),
    frameMaxMs: frames.reduce<number | null>((high, frame) => Math.max(high ?? 0, frame), null),
    framesOver33Ms: frames.filter((frame) => frame > LONG_FRAME_MS).length,
    framesOver100Ms: frames.filter((frame) => frame > VERY_LONG_FRAME_MS).length,
  }
}

async function measureStreaming(appPath: string, label: string | undefined, throttle: number) {
  const app = resolvePerfApp(appPath, label)
  const tokens = streamedAnswerTokens(DEFAULTS.tokens)
  let streamEnded: () => void = () => {}
  const ended = new Promise<void>((resolve) => {
    streamEnded = resolve
  })
  const provider = await startFakeProvider(async (request, stream) => {
    if (isTitleRequest(request)) return stream.text('Perf stream')
    for (const token of tokens) {
      stream.text(token)
      await delay(DEFAULTS.intervalMs)
    }
    streamEnded()
  })
  try {
    return await withRunningApp(
      app,
      {
        mode: 'cold',
        sessionListText: null,
        timeoutMs: TIMEOUT_MS,
        warmHostIdleMs: 0,
        prepareProfile: (profile) => configureFakeProvider(profile.agentDir, provider.baseUrl),
      },
      async ({ page }) => {
        await selectFakeModel(page)
        await page.evaluate(() => {
          Object.assign(globalThis, { __owFrames: [] })
          const holder: object = globalThis
          let last = performance.now()
          const tick = (now: number) => {
            const frames: unknown = '__owFrames' in holder ? holder.__owFrames : null
            if (Array.isArray(frames)) frames.push(now - last)
            last = now
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
        const trace = await traced(cdp, async () => {
          await page.evaluate(() => Object.assign(globalThis, { __owFrames: [] }))
          await page.locator('[contenteditable]').first().click()
          await page.keyboard.type('Please write a long answer with code.')
          await page.keyboard.press('Enter')
          await Promise.race([ended, delay(TIMEOUT_MS)])
          await delay(SETTLE_AFTER_STREAM_MS)
        })
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
        const frames: unknown = await page.evaluate(() => {
          const holder: object = globalThis
          const value: unknown = '__owFrames' in holder ? holder.__owFrames : null
          return value
        })
        const bounds = traceBounds(trace)
        return {
          app: app.label,
          throttle,
          providerRequests: provider.requests.length,
          ...rendererMainThreadBusy(trace, bounds.startUs, bounds.endUs),
          ...frameStats(
            Array.isArray(frames)
              ? frames.filter((frame): frame is number => typeof frame === 'number')
              : [],
          ),
          domNodes: await page.evaluate(() => document.getElementsByTagName('*').length),
        }
      },
    )
  } finally {
    await provider.close()
  }
}

async function main() {
  const runs = Number.parseInt(values.runs ?? String(DEFAULTS.runs), DECIMAL)
  const throttle = Number(values['cpu-throttle'] ?? DEFAULTS.throttle)
  const results = await compareApps({
    appPaths: values.app,
    labels: values.label,
    runs,
    runName: 'stream',
    measure: (appPath, label) => measureStreaming(appPath, label, throttle),
  })
  await reportComparison({
    results,
    metrics: METRICS,
    kind: 'streaming',
    details: { runs, throttle },
    outDirectory: values.out,
    fileName: `streaming-x${String(throttle)}.json`,
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
