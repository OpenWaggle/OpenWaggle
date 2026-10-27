import { type Browser, chromium, type Page } from '@playwright/test'

const CDP_POLL_MS = 20
/** The shell counts as visible once it has this many buttons and this much text (Track A). */
const SHELL_MINIMUM_BUTTONS = 5
const SHELL_MINIMUM_TEXT_LENGTH = 20
const RENDERER_URL_PREFIX = 'openwaggle://app'
/**
 * tsx compiles this file with esbuild's keepNames, which wraps named functions in `__name(...)`.
 * Functions sent into the page carry those calls, so the page needs the helper too.
 */
export const PAGE_NAME_HELPER = 'globalThis.__name ??= (target) => target'
const LOCALHOST_CDP = 'http://127.0.0.1'

/** What the boot instrumentation watches for, besides the app shell itself. */
export interface BootConditions {
  /** Text that appears once the sidebar lists Sessions, such as a generated Session title. */
  readonly sessionListText: string | null
  /** Text shown while the chat surface still loads. */
  readonly loadingText: string
}

interface BootProbeConditions extends BootConditions {
  readonly shellMinimumButtons: number
  readonly shellMinimumTextLength: number
}

interface BootProbeState {
  readonly milestones: Record<string, number>
  lcp: number | null
  longTaskMs: number
}

export interface RendererBoot {
  readonly timeOrigin: number
  readonly instrumentedFromStart: boolean
  readonly milestones: Readonly<Record<string, number>>
  readonly firstContentfulPaint: number | null
  readonly largestContentfulPaint: number | null
  readonly domContentLoaded: number | null
  readonly longTaskMs: number
}

/**
 * Runs in the renderer before the app's scripts when the harness attached in time. It records,
 * on the renderer's clock, when the shell, the Session list and the chat surface first appear,
 * and the largest contentful paint. Checks run at most once per frame and stop when all are seen.
 */
function installBootProbe(conditions: BootProbeConditions) {
  if (Reflect.has(globalThis, '__owPerf')) return
  const state: BootProbeState = { milestones: {}, lcp: null, longTaskMs: 0 }
  Reflect.set(globalThis, '__owPerf', state)
  const mark = (name: string) => {
    if (state.milestones[name] === undefined) state.milestones[name] = performance.now()
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTaskMs += entry.duration
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // Observers are best effort; the milestones below do not depend on them.
  }
  let scheduled = false
  const check = () => {
    scheduled = false
    const body = document.body
    if (!body) return
    const text = body.innerText
    const shell =
      document.querySelectorAll('button').length > conditions.shellMinimumButtons &&
      text.length > conditions.shellMinimumTextLength
    if (shell) mark('shell')
    if (document.querySelector('[contenteditable]')) mark('composer')
    if (conditions.sessionListText && text.includes(conditions.sessionListText)) mark('sessionList')
    if (shell && !text.includes(conditions.loadingText)) mark('chatReady')
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(check)
  }
  new MutationObserver(schedule).observe(document, { subtree: true, childList: true, characterData: true })
}

async function waitForCdp(port: number, deadline: number) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${LOCALHOST_CDP}:${String(port)}/json/version`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, CDP_POLL_MS))
  }
  throw new Error(`No DevTools endpoint on port ${String(port)}.`)
}

function rendererPage(browser: Browser) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(RENDERER_URL_PREFIX))
}

/**
 * Attaches to the app's DevTools port as early as it opens and installs the boot probe for the
 * renderer page, which is usually created after the harness attaches.
 */
export async function connectRenderer(port: number, timeoutMs: number, boot: BootConditions) {
  const deadline = Date.now() + timeoutMs
  const conditions: BootProbeConditions = {
    ...boot,
    shellMinimumButtons: SHELL_MINIMUM_BUTTONS,
    shellMinimumTextLength: SHELL_MINIMUM_TEXT_LENGTH,
  }
  await waitForCdp(port, deadline)
  const browser = await chromium.connectOverCDP(`${LOCALHOST_CDP}:${String(port)}`)
  for (const context of browser.contexts()) {
    await context.addInitScript({ content: PAGE_NAME_HELPER })
    await context.addInitScript(installBootProbe, conditions)
  }
  let page = rendererPage(browser)
  while (!page && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CDP_POLL_MS))
    page = rendererPage(browser)
  }
  if (!page) throw new Error('The app never opened its renderer page.')
  await page.evaluate(PAGE_NAME_HELPER)
  const instrumentedFromStart = await page.evaluate(() => '__owPerf' in globalThis)
  if (!instrumentedFromStart) await page.evaluate(installBootProbe, conditions)
  return { browser, page, instrumentedFromStart }
}

export async function waitForMilestones(page: Page, names: readonly string[], timeoutMs: number) {
  await page.waitForFunction(
    (wanted) => {
      const state: unknown = Reflect.get(globalThis, '__owPerf')
      const milestones: unknown =
        typeof state === 'object' && state !== null ? Reflect.get(state, 'milestones') : null
      return (
        typeof milestones === 'object' &&
        milestones !== null &&
        wanted.every((name) => Reflect.has(milestones, name))
      )
    },
    names,
    { timeout: timeoutMs, polling: CDP_POLL_MS },
  )
}

export async function readRendererBoot(page: Page, instrumentedFromStart: boolean): Promise<RendererBoot> {
  const boot = await page.evaluate(() => {
    const probe: unknown = Reflect.get(globalThis, '__owPerf')
    const isState = (value: unknown): value is BootProbeState =>
      typeof value === 'object' && value !== null && 'milestones' in value
    const state = isState(probe) ? probe : null
    const paint = performance.getEntriesByName('first-contentful-paint')[0]
    const navigation = performance.getEntriesByType('navigation')[0]
    return {
      timeOrigin: performance.timeOrigin,
      milestones: state?.milestones ?? {},
      firstContentfulPaint: paint ? paint.startTime : null,
      largestContentfulPaint: state?.lcp ?? null,
      domContentLoaded:
        navigation && 'domContentLoadedEventEnd' in navigation
          ? Number(navigation.domContentLoadedEventEnd)
          : null,
      longTaskMs: state?.longTaskMs ?? 0,
    }
  })
  return { ...boot, instrumentedFromStart }
}
