/**
 * "Open a large Session" gate of the v1 performance plan: from clicking a multi-megabyte Session
 * in the sidebar until its last message is on screen, with every main-process IPC response and
 * pushed event counted (bytes are JSON characters). Runs on a generated large profile.
 *
 *   pnpm perf:session-open --app <before.app> --app <after.app> --template <large-profile> --runs 10
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { Page } from '@playwright/test'
import { IPC_LOG_INSTALL, IPC_LOG_READ, IPC_LOG_RESET } from './lib/main-inspector'
import { resolvePerfApp } from './lib/perf-app'
import { log, measurementEnvironment, writeJsonResult, exitWhenFlushed } from './lib/perf-results'
import { summarizeRuns } from './lib/perf-stats'
import { delay, withRunningApp } from './lib/running-app'
import { summarizeIpc } from './lib/ipc-summary'
import { warmTemplateFor } from './lib/warm-template'

const DEFAULT_RUNS = 10
const TIMEOUT_MS = 90_000
const SETTLE_AFTER_OPEN_MS = 3_000
const DECIMAL = 10
const ORDERS = 2
const USAGE_EXIT_CODE = 2
const OPEN_METRICS = ['openMs', 'invokeBytes', 'invokeCount', 'pushedBytes', 'domNodes', 'jsHeapBytes']

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    template: { type: 'string' },
    runs: { type: 'string' },
    out: { type: 'string' },
  },
})

interface ProfileManifest {
  readonly largeSessions: readonly string[]
  readonly sessionListText: string
}

async function readManifest(template: string): Promise<ProfileManifest> {
  const parsed: unknown = JSON.parse(await readFile(path.join(template, 'profile.json'), 'utf8'))
  const large: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'largeSessions') : null
  const listText: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'sessionListText') : null
  if (!Array.isArray(large) || typeof listText !== 'string') throw new Error('Not a generated profile.')
  return { largeSessions: large.filter((title): title is string => typeof title === 'string'), sessionListText: listText }
}

/** Starts a per-frame check for the Session's last message and returns when it is on screen. */
async function openAndWait(page: Page, title: string, lastText: string) {
  await page.evaluate((wanted) => {
    const startedAt = performance.now()
    Reflect.set(globalThis, '__owOpen', null)
    const check = () => {
      if (document.body.textContent?.includes(wanted)) Reflect.set(globalThis, '__owOpen', performance.now() - startedAt)
      else requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }, lastText)
  await page.getByText(title, { exact: true }).first().click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(() => typeof Reflect.get(globalThis, '__owOpen') === 'number', undefined, { timeout: TIMEOUT_MS })
  const openMs: unknown = await page.evaluate(() => {
    const value: unknown = Reflect.get(globalThis, '__owOpen')
    return value
  })
  return typeof openMs === 'number' ? Math.round(openMs) : null
}

async function measureOpen(appPath: string, label: string | undefined, template: string, manifest: ProfileManifest) {
  const app = resolvePerfApp(appPath, label)
  const warm = await warmTemplateFor(app, template)
  const title = manifest.largeSessions[0]
  if (!title) throw new Error('The generated profile has no large Session.')
  // Generated transcripts number their turns from 0; the large Sessions have 3,600 messages.
  const lastText = '[turn 3599]'
  return withRunningApp(
    app,
    {
      mode: 'cold',
      templateUserData: path.join(warm, 'user-data'),
      templateHome: path.join(warm, 'home'),
      sessionListText: manifest.sessionListText,
      timeoutMs: TIMEOUT_MS,
      warmHostIdleMs: 0,
      mainInspector: true,
    },
    async ({ page, inspector }) => {
      if (!inspector) throw new Error('The main-process inspector did not attach.')
      await inspector.evaluate(IPC_LOG_INSTALL)
      await inspector.evaluate(IPC_LOG_RESET)
      const openMs = await openAndWait(page, title, lastText)
      await delay(SETTLE_AFTER_OPEN_MS)
      const ipc: unknown = JSON.parse(String(await inspector.evaluate(IPC_LOG_READ)))
      const dom = await page.evaluate(() => ({
        domNodes: document.getElementsByTagName('*').length,
        jsHeapBytes: Number(Reflect.get(Reflect.get(performance, 'memory') ?? {}, 'usedJSHeapSize') ?? 0),
      }))
      return { app: app.label, session: title, openMs, ...summarizeIpc(ipc), ...dom }
    },
  )
}

async function main() {
  const apps = values.app ?? []
  if (apps.length === 0 || !values.template) {
    process.stderr.write('Use --app <OpenWaggle.app> (repeatable) --template <generated profile>\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const template = path.resolve(values.template)
  const manifest = await readManifest(template)
  const runs = Number.parseInt(values.runs ?? String(DEFAULT_RUNS), DECIMAL)
  const indexed = apps.map((appPath, index) => ({ appPath, label: values.label?.[index] ?? path.basename(appPath) }))
  const results: Record<string, object[]> = Object.fromEntries(indexed.map((entry) => [entry.label, []]))
  for (let run = 0; run < runs; run += 1) {
    const order = run % ORDERS === 0 ? indexed : [...indexed].reverse()
    for (const entry of order) {
      try {
        const result = await measureOpen(entry.appPath, entry.label, template, manifest)
        results[entry.label]?.push(result)
        log(`${entry.label} open ${String(run + 1)}: ${JSON.stringify({ ...result, channels: undefined })}`)
      } catch (error) {
        results[entry.label]?.push({ error: String(error) })
        log(`${entry.label} open ${String(run + 1)} failed: ${String(error)}`)
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([label, entries]) => [label, summarizeRuns(entries, OPEN_METRICS)]))
  const report = { kind: 'session-open', environment: measurementEnvironment(), runs, summary, results }
  if (values.out) log(`Wrote ${await writeJsonResult(values.out, 'session-open.json', report)}`)
  process.stdout.write(`${JSON.stringify(summary, null, ORDERS)}\n`)
}

main().then(
  () => exitWhenFlushed(typeof process.exitCode === 'number' ? process.exitCode : 0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    exitWhenFlushed(1)
  },
)
