/**
 * macOS only: the perf harness reads process environments with BSD `ps -E`, clones profiles with
 * `cp -c` and launches `.app` bundles, so `resolvePerfApp` refuses other platforms.
 *
 * "Open a large Session" gate of the v1 performance plan: from clicking a multi-megabyte Session
 * in the sidebar until its last message is on screen, with every main-process IPC response and
 * pushed event counted (bytes are JSON characters). Runs on a generated large profile.
 *
 *   pnpm perf:session-open --app <before.app> --app <after.app> --template <large-profile> --runs 10
 *
 * `--mode cross-project` then opens a second large Session, which the generator puts in another
 * project, `--switch-delay` ms after the first one is on screen. The default, 5 s, lands the switch in the
 * Host's background work, which starts 5 s after the window attached; on the medium profile its
 * transcript term repair then runs about 2 s, on the large one minutes. That open is
 * `crossProjectOpenMs`, and the IPC totals then cover the switch alone (W12).
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
const CROSS_PROJECT_METRICS = ['crossProjectOpenMs', ...OPEN_METRICS]
const DEFAULT_SWITCH_DELAY_MS = 5_000
// Generated transcripts number their turns from 0; the large Sessions have 3,600 messages.
const LAST_TURN_TEXT = '[turn 3599]'
type OpenMode = 'first' | 'cross-project'

const { values } = parseArgs({
  options: {
    app: { type: 'string', multiple: true },
    label: { type: 'string', multiple: true },
    template: { type: 'string' },
    runs: { type: 'string' },
    out: { type: 'string' },
    mode: { type: 'string' },
    'switch-delay': { type: 'string' },
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

/**
 * Starts a per-frame check for the Session's last message and returns when it is on screen. Text
 * nodes that already showed it, from a Session opened before, do not count.
 */
async function openAndWait(page: Page, title: string, lastText: string) {
  await page.evaluate((wanted) => {
    const textNodes = () => {
      const nodes: Node[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.includes(wanted)) nodes.push(node)
      }
      return nodes
    }
    const shown = new WeakSet(textNodes())
    const startedAt = performance.now()
    Reflect.set(globalThis, '__owOpen', null)
    const check = () => {
      if (textNodes().some((node) => !shown.has(node))) Reflect.set(globalThis, '__owOpen', performance.now() - startedAt)
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

interface OpenOptions {
  readonly mode: OpenMode
  readonly switchDelayMs: number
}

async function measureOpen(
  appPath: string,
  label: string | undefined,
  template: string,
  manifest: ProfileManifest,
  options: OpenOptions,
) {
  const app = resolvePerfApp(appPath, label)
  const warm = await warmTemplateFor(app, template)
  const [title, otherProjectTitle] = manifest.largeSessions
  if (!title) throw new Error('The generated profile has no large Session.')
  if (options.mode === 'cross-project' && !otherProjectTitle) {
    throw new Error('The generated profile has no second large Session.')
  }
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
      const openMs = await openAndWait(page, title, LAST_TURN_TEXT)
      let crossProjectOpenMs: number | null = null
      if (options.mode === 'cross-project' && otherProjectTitle) {
        await delay(options.switchDelayMs)
        await inspector.evaluate(IPC_LOG_RESET)
        crossProjectOpenMs = await openAndWait(page, otherProjectTitle, LAST_TURN_TEXT)
      }
      await delay(SETTLE_AFTER_OPEN_MS)
      const ipc: unknown = JSON.parse(String(await inspector.evaluate(IPC_LOG_READ)))
      const dom = await page.evaluate(() => ({
        domNodes: document.getElementsByTagName('*').length,
        jsHeapBytes: Number(Reflect.get(Reflect.get(performance, 'memory') ?? {}, 'usedJSHeapSize') ?? 0),
      }))
      return {
        app: app.label,
        session: title,
        openMs,
        ...(options.mode === 'cross-project' ? { crossProjectSession: otherProjectTitle, crossProjectOpenMs } : {}),
        ...summarizeIpc(ipc),
        ...dom,
      }
    },
  )
}

function openOptions(): OpenOptions {
  const mode: OpenMode = values.mode === 'cross-project' ? 'cross-project' : 'first'
  if (values.mode !== undefined && values.mode !== mode) {
    process.stderr.write('--mode is first (default) or cross-project\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const switchDelayMs = Number.parseInt(values['switch-delay'] ?? String(DEFAULT_SWITCH_DELAY_MS), DECIMAL)
  return { mode, switchDelayMs }
}

async function main() {
  const apps = values.app ?? []
  if (apps.length === 0 || !values.template) {
    process.stderr.write('Use --app <OpenWaggle.app> (repeatable) --template <generated profile> (macOS only)\n')
    process.exit(USAGE_EXIT_CODE)
  }
  const template = path.resolve(values.template)
  const manifest = await readManifest(template)
  const runs = Number.parseInt(values.runs ?? String(DEFAULT_RUNS), DECIMAL)
  const { mode, switchDelayMs } = openOptions()
  const metrics = mode === 'cross-project' ? CROSS_PROJECT_METRICS : OPEN_METRICS
  const indexed = apps.map((appPath, index) => ({ appPath, label: values.label?.[index] ?? path.basename(appPath) }))
  const results: Record<string, object[]> = Object.fromEntries(indexed.map((entry) => [entry.label, []]))
  for (let run = 0; run < runs; run += 1) {
    const order = run % ORDERS === 0 ? indexed : [...indexed].reverse()
    for (const entry of order) {
      try {
        const result = await measureOpen(entry.appPath, entry.label, template, manifest, { mode, switchDelayMs })
        results[entry.label]?.push(result)
        log(`${entry.label} open ${String(run + 1)}: ${JSON.stringify({ ...result, channels: undefined })}`)
      } catch (error) {
        results[entry.label]?.push({ error: String(error) })
        log(`${entry.label} open ${String(run + 1)} failed: ${String(error)}`)
      }
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([label, entries]) => [label, summarizeRuns(entries, metrics)]))
  const report = { kind: 'session-open', mode, switchDelayMs, environment: measurementEnvironment(), runs, summary, results }
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
